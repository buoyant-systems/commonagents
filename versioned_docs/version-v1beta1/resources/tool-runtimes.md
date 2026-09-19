---
id: tool-runtimes
sidebar_position: 3
title: Tool Runtimes
description: The available execution backends for tool actions and event receive runtimes in the Common Agent Specification.
---

# Tool Runtimes

A tool declares its execution behaviour through two kinds of runtimes:

- **Action runtimes** — declared in an action's `execute` block. Determines how an outbound action invocation is executed (HTTP, CEL, MCP, etc.).
- **Receive runtimes** — declared in an event's `receive` block. Determines how an inbound event reaches the task.

Both follow the same pattern: the runtime type is identified by which sub-key is present in the block.

---

## Action Runtimes

Every tool action must declare exactly one runtime backend in its `execute` block.

### Errors

Every runtime MUST distinguish two kinds of failure:

- **Unrecoverable** — invalid configuration, unreachable endpoints. These terminate the task.
- **Recoverable** — HTTP failures, tool-level errors. These are reported back to the LLM so it can retry or adapt.

Most runtimes hold nothing between invocations, so each action execution stands alone. `stateful_session` is the exception: it holds a live connection, and declares how long for.

### `cel`

Evaluates a [CEL](https://github.com/google/cel-spec) expression and returns its result as the action output.

```yaml
execute:
  cel:
    expression: str   # Must evaluate to a JSON-serialisable object
```

The CEL expression has access to `context`, `input`, and `now`. See [CEL Reference](../reference/cel.md).

**Example:**
```yaml
- name: format_date
  description: "Returns the current UTC date."
  execute:
    cel:
      expression: "{'date': now, 'agent': context.agent.name}"
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
    response_path: str | None  # JMESPath to extract from response
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
    Authorization: "Bearer {connection('example').service_auth().token}"
```

#### Files and the mount

`stateless_http` moves file content directly between the agent's [mount](mount.md) and a remote API — the bytes never pass through the model's context or the persisted task result, only a `file` reference does (see [Content](../capabilities/content.md)). An agent's `mount` MUST include `task` for either direction: a downloaded file is placed by the runtime rather than by the tool, so it resides in the task scope ([Mount](mount.md)).

**Download — write a response body to the mount.** Set `response: file` on an action's `execute.stateless_http` to declare that the response body is a file. Whether an endpoint returns a file is decided by the schema — response `Content-Type` is never sniffed.

```yaml
execute:
  stateless_http:
    method: GET
    url: /files/{parameters.file_id}/content
    response: file        # stream the body into the mount instead of returning it inline
```

Instead of an inline result, the action returns a file **handle** — `{ file, mime_type, size_bytes, hash }` — where `file` is a `{root}://{name}` reference and `hash` is the backend-certified content hash. The body never enters the tool result and the download attaches nothing to the model's context. The file keeps the server's `Content-Disposition` name when present (a re-download overwrites it); an unnamed response is named `downloaded_<unique8><ext>`. The handle chains like any file result: into a later action's `type: file` parameter, into a CEL tool's `mount.*` functions, or positionally in an LLM script. Without `response: file` the body is always an inline result.

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

Maintains a **live connection** to a remote across multiple action invocations — a browser over CDP, a sandbox over gRPC, a shell over a websocket. That connection is the state this runtime holds, and the only reason to reach for it. Data that merely travels between calls is not state: parameters carry it, and `stateless_http` needs none of this.

A `start` hook establishes the session, an `end` hook releases it, and a `connection` block declares the one connection they bracket — its URL, how long it is held, and what the protocol permits.

A tool that also needs a durable resource behind its connection — a browser context whose cookies outlive any one connection — does not declare it here. It exposes minting one as an ordinary stateless action, and the agent invokes it and binds the result in, because whether that resource is per-task, per-user or shared is a decision about the agent rather than about the remote's API.

```yaml
# Tool level. Each hook is a list, run in order.
stateful_session:
  start:                            # establishes the session
    - method: str
      url: str
      headers: dict[str, str] | None
      body: object | None
      extract: dict[str, str] | None    # session key -> JMESPath over the response
  end: [ ... ]                      # releases it; no extract

  connection:                       # declared once, because there is one
    url: str                        # ws:// wss:// grpc:// grpcs://; usually {session.<key>}
    headers: dict[str, str] | None  # sent on the handshake
    lifespan: active_processing | message_scope | task_scope    # default: active_processing
    reconnect: auto | llm_driven                                # default: auto
```

```yaml
# Action level — what to send, never where.
execute:
  stateful_session:
    body: object | None             # the frame to send
```

An action declares what to send; the destination is `connection.url`, resolved once after `start` and shared by every action of the tool. One connection per session is therefore structural rather than a rule.

Both hooks are optional, and each request MUST succeed before the next runs. `start` runs on the first invocation of any of the tool's actions within the span and again whenever the span has no session, so it MAY run several times and MUST tolerate that. `extract` is meaningful only on `start`; its values keep the type the remote answered with, are what the connection, the actions and `end` address the session by, MUST survive the task being resumed elsewhere, and MUST NOT be projected to the LLM.

- **`lifespan`** — how long a session lasts: while **this tool** is actively progressing (the default, released whenever its calls stop progressing — external auth, a review, a capacity backoff), to the end of the [message](../glossary.md), or to the end of the task. `active_processing` is per tool: another tool still working does not hold this one's session open. `active_processing` is the default because a yield has no bound the runtime controls.
- **`reconnect`** — who re-establishes a session whose connection was lost. `auto` (default) means its state outlives the connection, so the runtime redials underneath and the LLM is not told. `llm_driven` means its state died with the connection, so the loss is reported and the LLM's next call runs `start` again. Under `llm_driven` the abandoned session's `end` runs; under `auto` there is nothing to close, because the session is still there. Either way a request already on the wire is never re-sent, and the failed call is reported to the LLM rather than retried.

How the runtime dials, holds and redials is otherwise its own business. A connection it cannot recover leaves the span without a session, which the next invocation re-establishes by running `start` again.

`end` runs on a session the runtime gives up on: a span that ended, a `llm_driven` connection that went, or one a dead process left behind, which a task reconciles from persisted session state when it resumes. A connection lost under `auto` is not giving up — the session survives it — but that session is still closed by its span's end if nothing dials again first. What none of this covers is a task nothing ever resumes, for which the backstop is the remote's own expiry.

File handling belongs to `stateless_http` alone: an action over a held connection has no HTTP response body to stream. See [Files and the mount](#files-and-the-mount).

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

An action names the tool to proxy to:

```yaml
execute:
  mcp:
    tool_name: str
```

The server itself is declared once, in a top-level `mcp` block (a sibling of `actions`):

```yaml
mcp:
  transport: "stdio" | "sse"
  command: str | None       # for stdio transport
  args: list[str] | None
  url: str | None           # for sse transport
  env: dict[str, str] | None
  lifespan: active_processing | message_scope | task_scope   # default: task_scope
```

`lifespan` means what it means for `stateful_session`, and defaults differently: an MCP session is a handshake rather than a metered seat, so it is held for the task unless an author says otherwise.

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

The external platform is configured to POST events to a fixed endpoint the runtime exposes. The runtime listens passively — no registration or renewal is required.

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

The runtime actively registers a push channel with the external platform. Channels are typically time-limited and must be renewed. This is structurally parallel to `stateful_session` for actions — `subscribe` establishes and `unsubscribe` releases — but a subscription is always task-scoped.

```yaml
receive:
  subscription:
    filter: str | None     # CEL routing discriminator (optional)
    subscribe:             # HTTP call to register the push channel
      method: str
      url: str
      headers: dict | None
      json: object | None    # structured body; mutually exclusive with body
      body: str | None
    unsubscribe:           # HTTP call to deregister the push channel
      method: str
      url: str
      headers: dict | None
      json: object | None    # structured body; mutually exclusive with body
      body: str | None
```

The following interpolation roots are available in `subscribe` and `unsubscribe` fields:

| Root | Description |
|---|---|
| `{parameters.*}` | Root tool parameters (populated from agent bindings) |
| `{connection('<provider>').service_auth().token}` | A credential for the deployment's machine identity; `.user_auth()` for the acting user's. See [Connections](../reference/parameters.md#connections) |
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
            Authorization: "Bearer {connection('google').user_auth().token}"
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
            Authorization: "Bearer {connection('google').user_auth().token}"
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
          Authorization: "Bearer {connection('example').service_auth().token}"
        detect: "response.items.filter(i, i.published_at > poll.last_fetched_at)"
    parameters:
      title: "item.title"
      url:   "item.url"
```
