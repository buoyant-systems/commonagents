---
id: tool-runtimes
sidebar_position: 3
title: Tool Runtimes
description: The available execution backends for tool actions and event receive runtimes in the Common Agent Specification.
---

# Tool Runtimes

A tool declares its execution behaviour through two kinds of runtimes:

- **Action runtimes** — declared in an action's `execute` block. Determines how an outbound action invocation is executed (HTTP, CEL, MCP, etc.).
- **Receive runtimes** — declared in an event's `receive` block. Determines how inbound events are delivered to the runtime.

Both follow the same pattern: the runtime type is identified by which sub-key is present in the block.

---

## Action Runtimes

Every tool action must declare exactly one runtime backend in its `execute` block.

### Runtime Interface

All runtimes MUST implement a three-phase lifecycle:

1. **Initialize** — Called once per tool per task on first action invocation. Returns an initialized state with interpolated configuration and any session data.
2. **Invoke** — Called for each individual action execution. Returns the action result. Recoverable errors (e.g. HTTP 5xx, tool-level failures) are reported back to the LLM so it can retry or adapt. Only unrecoverable errors (unreachable endpoints, invalid configuration) terminate the task.
3. **Teardown** — Called when the task completes or the state is evicted. Performs cleanup (e.g. closing sessions). Stateless runtimes implement this as a no-op.

The runtime MUST distinguish:
- **Unrecoverable errors** — invalid configuration, unreachable endpoints. These terminate the task.
- **Recoverable errors** — HTTP failures, tool-level errors. These are reported back to the LLM for potential recovery.

### `cel`

Evaluates a [CEL](https://github.com/google/cel-spec) expression and returns its result as the action output.

```yaml
execute:
  cel:
    expression: str   # Must evaluate to a JSON-serialisable object
```

The CEL expression has access to `context`, `input`, and `now`. See [CEL Reference](../reference/cel).

**Example:**
```yaml
- name: format_date
  description: "Returns the current UTC date."
  execute:
    cel:
      expression: "{'date': now, 'namespace': context.agent.namespace}"
```

### `stateless_http`

Issues HTTP requests with no cross-request session state. Each action invocation is independent.

Each action's `execute` block:

```yaml
execute:
  stateless_http:
    method: GET | POST | PUT | PATCH | DELETE
    url: str               # supports {parameter} interpolation; MAY be a relative path (see base_url)
    headers: dict[str, str] | None
    json: object | None    # structured request body, serialised to JSON by the runtime
                           # (sets Content-Type: application/json). Interpolated values are escaped.
    body: str | None       # raw string request body, interpolated as-is. Mutually exclusive with json.
    response_path: str | None  # JSONPath to extract from response
```

Use `json` for structured request bodies — the runtime serialises the object and escapes interpolated `{parameter}` values, so a value containing quotes or newlines is safe. Use `body` only when a pre-formatted raw string is required. `json` and `body` MUST NOT both be set on the same action.

**Shared configuration.** A tool MAY declare a top-level `stateless_http` block (a sibling of `actions`) whose values apply to every action:

```yaml
stateless_http:
  base_url: str | None            # prepended to every action url that is a relative path
  headers: dict[str, str] | None  # merged into every action's headers
```

When an action `url` is a relative path, the runtime prepends `base_url`; a `url` that already starts with `http://` or `https://` is used unchanged. This lets a tool declare its host, common prefix, and auth header once and give each action a short relative path.

**Example (shared `base_url` + a `json` body):**
```yaml
actions:
  - name: send_message
    execute:
      stateless_http:
        method: POST
        url: /v1/messages          # resolves against base_url
        json:
          text: "{parameters.message}"
          channel: "{parameters.channel}"
stateless_http:
  base_url: "https://api.example.com"
  headers:
    Authorization: "Bearer {settings.api_key}"
```

#### Files and the mount

Both HTTP runtimes move file content directly between the agent's [mount](mount) and a remote API — the bytes never pass through the model's context or the persisted task result, only a `file` reference does (see [Content](../capabilities/content)). An agent MUST have a non-`none` `mount` scope for either direction; without one the runtime returns an operational error to the LLM.

**Download — write a response body to the mount.** Set `response: file` on an action's `execute.stateless_http` to declare that the response body is a file. Whether an endpoint returns a file is decided by the schema — response `Content-Type` is never sniffed.

```yaml
execute:
  stateless_http:
    method: GET
    url: /files/{parameters.file_id}/content
    response: file        # stream the body into the mount instead of returning it inline
```

Instead of an inline result, the action returns a file **handle** — `{ file, mime_type, size_bytes, hash }` — where `file` is a `file:{name}` reference token and `hash` is the backend-certified content hash. The body never enters the tool result and the download attaches nothing to the model's context. The file keeps the server's `Content-Disposition` name when present (a re-download overwrites it); an unnamed response is named `downloaded_<unique8><ext>`. The handle chains like any file result: into a later action's `type: file` parameter, into a CEL tool's `mount.*` functions, or positionally in an LLM script. Without `response: file` the body is always an inline result.

**Upload — stream a mount file to a remote API.** Add an `upload` block to an action's `execute.stateless_http` to send a mount file to a remote API using a resumable, chunked protocol. The action's own `method`/`url`/`json`/`headers` define the *session-creation* request; the `upload` block drives the transfer that follows.

```yaml
execute:
  stateless_http:
    method: POST                       # 1. session-creation request
    url: /upload/sessions
    json: { name: "{parameters.filename}" }
    upload:
      extract:                         # 2. where the upload URL is in the creation response
        json: str | None               #    JMESPath on the response body, OR
        header: str | None             #    a response header name — exactly one
      content: "{parameters.file}"     # 3. a `type: file` parameter carrying the file to upload
      chunk_size: int                  # 4. bytes per chunk
      response: file | None            # 5. optional: treat the completion response as a file
      headers: dict[str, str] | None   #    headers sent ONLY on the chunk PUTs
```

The runtime: (1) issues the session-creation request; (2) extracts the upload URL from that response via `upload.extract` (exactly one of `json` or `header`); (3) resolves `upload.content` — a `{parameters.*}` reference to a `type: file` parameter — to the file's bytes on the mount; (4) PUTs the content to the upload URL in `chunk_size` byte ranges with `Content-Range: bytes {start}-{end}/{total}` headers, continuing while the API answers `308` or `202` and completing on `200`/`201`; (5) returns the completion response as the action result — or, when `upload.response: file` is set, streams that response back into the mount as a new file handle, so an "upload a file, get a file back" API (e.g. a document converter) chains like any file producer.

Chunk PUTs use **only** `upload.headers` — they deliberately do not inherit tool- or action-level headers, because APIs disagree on what a chunk request needs (e.g. Google Drive requires `Authorization` on chunks; OneDrive's pre-authorised upload URL rejects it). Total size and per-chunk / total upload timeouts are bounded by runtime configuration.

### `stateful_session`

Maintains a remote session across multiple action invocations within a task. The runtime establishes the session on first invocation (Initialize) and tears it down when the task ends.

Session-scoped variables extracted from the session are available as `{session.<key>}` during interpolation.

```yaml
stateful_session:
  create:                # HTTP call to establish the session
    method: POST
    url: str
    body: object | None
  extract:               # Fields to extract from the create response into session state
    <session_key>: str   # JSONPath expression
  execute:               # HTTP call for each action invocation
    method: str
    url: str             # may reference {session.<key>}
    body: object | None
  destroy:               # HTTP call to tear down the session
    method: DELETE
    url: str
```

A stateful-session `execute` block supports the same file handling as `stateless_http`: `response: file` streams the response body into the agent's mount and returns a file handle, and an `upload` block streams a mount file to a remote API. See [Files and the mount](#files-and-the-mount).

### `openapi`

Derives actions from an OpenAPI specification. The runtime fetches the spec URL and automatically generates action schemas and execution logic.

```yaml
execute:
  openapi:
    url: str   # URL pointing to an OpenAPI 3.x specification
```

The runtime MUST derive parameters from the OpenAPI spec's operation definitions.

### `mcp`

Bridges to a [Model Context Protocol](https://modelcontextprotocol.io) server. The MCP server exposes its own set of tools; the runtime proxies action invocations to the MCP server.

```yaml
mcp:
  transport: "stdio" | "sse"
  command: str | None       # for stdio transport
  args: list[str] | None
  url: str | None           # for sse transport
  env: dict[str, str] | None
```

### `kubernetes_job`

Runs a Kubernetes Job and returns its output. The runtime submits the Job spec to the cluster, waits for completion, and returns the result.

```yaml
execute:
  kubernetes_job:
    namespace: str           # Kubernetes namespace to create the job in
    spec: KUBERNETES_JOB_SPEC
```

---

## Receive Runtimes

Every tool event must declare exactly one receive runtime in its `receive` block. The correct runtime is inferred from which sub-key is present — the same pattern as `execute` for actions.

Each receive sub-type accepts an optional `filter` field: a CEL expression that controls whether a raw platform payload is routed to this event definition. Inside `filter`, `parameters.*` references are resolved against the **action allow list** — a per-tool, per-task flat namespace keyed by parameter name:

- All root and per-action parameter values resolved from LLM action calls are added to the allow list.
- Per-event parameters are also part of the same namespace — if they share a name with a per-action parameter, they share the allow list entry.
- A parameter with an agent-defined binding has its allow list entry **sealed** at task start — fixed to the binding value, it cannot grow from action calls. `require_binding: true` is a validation constraint that ensures a binding is present; it does not itself seal the entry.
- If a referenced parameter's allow list is empty, the filter fails and the event is **discarded**.

### `webhook`

The external platform is configured to POST events to a fixed AgentMesh endpoint. The runtime listens passively — no registration or renewal is required.

```yaml
receive:
  webhook:
    filter: str | None   # CEL routing discriminator; references parameters.* from agent bindings
```

Webhook signing secrets are server configuration, not manifest configuration.

**Example:**
```yaml
events:
  - name: comment
    message: "{event.author} commented: {event.body}"
    receive:
      webhook:
        filter: >
          event.payload.action == 'created'
          && has(event.payload.issue.pull_request)
          && event.payload.repository.owner.login == parameters.owner
          && event.payload.repository.name == parameters.repo
    parameters:
      author:    "event.payload.comment.user.login"
      body:      "event.payload.comment.body"
      pr_number: "string(event.payload.issue.number)"
```

### `subscription`

The runtime actively registers a push channel with the external platform. Channels are typically time-limited and must be renewed. This is structurally parallel to `stateful_session` for actions: `subscribe` maps to `create`, and `unsubscribe` maps to `destroy`.

```yaml
receive:
  subscription:
    filter: str | None     # CEL routing discriminator (optional)
    subscribe:             # HTTP call to register the push channel
      method: str
      url: str
      headers: dict | None
      body: object | None
    unsubscribe:           # HTTP call to deregister the push channel
      method: str
      url: str
      headers: dict | None
      body: object | None
```

The following interpolation roots are available in `subscribe` and `unsubscribe` fields:

| Root | Description |
|---|---|
| `{parameters.*}` | Root tool parameters (populated from agent bindings) |
| `{auth.<provider>()}` | Auth provider tokens |
| `{runtime.api_root}` | The runtime's public-facing webhook base URL |
| `{subscription.id}` | Runtime-generated unique subscription identifier |
| `{subscription.expires_at_ms}` | Subscription expiry as Unix milliseconds |
| `{subscribe.*}` | Response fields from the `subscribe` call (available in `unsubscribe` only) |

**Example:**
```yaml
events:
  - name: edit
    message: "Document '{event.title}' was edited by {event.editor}"
    receive:
      subscription:
        filter: "event.payload.document_id == parameters.document_id"
        subscribe:
          method: POST
          url: "https://www.googleapis.com/drive/v3/changes/watch"
          headers:
            Authorization: "Bearer {auth.google()}"
          json:
            id: "{subscription.id}"
            type: "web_hook"
            address: "{runtime.api_root}/v1/webhooks/events/google_docs"
            expiration: "{subscription.expires_at_ms}"
            resourceId: "{parameters.document_id}"
        unsubscribe:
          method: POST
          url: "https://www.googleapis.com/drive/v3/channels/stop"
          headers:
            Authorization: "Bearer {auth.google()}"
          json:
            id: "{subscription.id}"
            resourceId: "{subscribe.resource_id}"
    parameters:
      editor:         "event.payload.editor_email"
      title:          "event.payload.document_title"
      change_summary: "event.payload.change_description"
```

### `poll`

The runtime periodically fetches the external endpoint and detects new items. This is the fallback mode for platforms that don't support push delivery.

```yaml
receive:
  poll:
    filter: str | None     # CEL routing discriminator (optional)
    method: str
    url: str               # supports {parameter} interpolation
    headers: dict | None
    detect: str            # CEL expression returning a list of new items from the response
```

The `detect` field is a CEL expression evaluated against the poll response. It must return a list — each item in the list produces one event activation. The `poll.last_fetched_at` variable is available in `detect` to identify items newer than the last poll.

**Example:**
```yaml
events:
  - name: new_item
    message: "New feed item: {event.title} — {event.url}"
    receive:
      poll:
        method: GET
        url: "https://example.com/feed/{parameters.feed_id}"
        headers:
          Authorization: "Bearer {settings.api_key}"
        detect: "response.items.filter(i, i.published_at > poll.last_fetched_at)"
    parameters:
      title: "item.title"
      url:   "item.url"
```
