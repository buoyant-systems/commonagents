---
id: tool-runtimes
sidebar_position: 3
title: Tool Runtimes
description: The available execution backends for tool actions and event receive runtimes in the Common Agent Specification.
---

# Tool Runtimes

A tool declares its execution behaviour through two kinds of runtimes:

- **Action runtimes** — declared in an action's `execute` block. Determines how an outbound action invocation is executed (HTTP, CEL, filesystem, MCP, etc.).
- **Receive runtimes** — declared in an event's `receive` block. Determines how inbound events are delivered to the runtime.

Both follow the same pattern: the runtime type is identified by which sub-key is present in the block.

---

## Action Runtimes

Every tool action must declare exactly one runtime backend in its `execute` block.

### Runtime Interface

All runtimes MUST implement a three-phase lifecycle:

1. **Initialize** — Called once per tool per task on first action invocation. Returns an initialized runtime state with interpolated configuration and any session data.
2. **Invoke** — Called for each individual action execution. Returns a `CapabilityResult`. Operational errors (e.g. HTTP 5xx) MUST be reported via `CapabilityResult`, not as infrastructure errors. Only unreachable hosts, TLS errors, or configuration bugs are infrastructure errors.
3. **Teardown** — Called when the task completes or the runtime state is evicted. Performs cleanup (e.g. closing sessions). Stateless runtimes implement this as a no-op.

The runtime MUST distinguish:
- **Infrastructure errors** — configuration bugs, unreachable endpoints. These terminate the task.
- **Operational errors** — HTTP 5xx, tool-level failures. These are reported back to the LLM for potential recovery.

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

```yaml
stateless_http:
  method: GET | POST | PUT | PATCH | DELETE
  url: str               # supports {parameter} interpolation
  headers: dict[str, str] | None
  body: object | None    # serialised to JSON
  response_path: str | None  # JSONPath to extract from response
```

**Example:**
```yaml
execute:
  stateless_http:
    method: POST
    url: "https://api.example.com/v1/messages"
    headers:
      Authorization: "Bearer {settings.api_key}"
      Content-Type: "application/json"
    body:
      text: "{parameters.message}"
      channel: "{parameters.channel}"
```

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

### `openapi`

Derives actions from an OpenAPI specification. The runtime fetches the spec URL and automatically generates action schemas and execution logic.

```yaml
execute:
  openapi:
    url: str   # URL pointing to an OpenAPI 3.x specification
```

The runtime MUST derive parameters from the OpenAPI spec's operation definitions.

### `filesystem`

Reads and writes files on a virtual filesystem. The filesystem backend and its configuration are declared at the tool level.

```yaml
# Tool-level config
filesystem:
  local:
    root: str            # Root path for all operations
  # OR
  github:
    owner: str
    repo: str
    default_branch: str | None

# Action shorthand (auto-generates name, description, execute block)
actions:
  - filesystem: "read_chunk"   # Well-known action name
  - filesystem: "write_file"
  - filesystem: "list_dir"
```

Well-known filesystem action names include: `read_chunk`, `write_file`, `list_dir`, `search`, `delete_file`, and others as defined by the runtime.

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
