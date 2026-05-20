---
id: tool-runtimes
sidebar_position: 3
title: Tool Runtimes
description: The available execution backends for tool capabilities in the Common Agent Specification.
---

# Tool Runtimes

Every tool capability must declare exactly one runtime backend in its `execute` block. The runtime backend determines how the capability is executed.

## Runtime Interface

All runtimes MUST implement a three-phase lifecycle:

1. **Initialize** — Called once per tool per task on first capability invocation. Returns an initialized runtime state with interpolated configuration and any session data.
2. **Invoke** — Called for each individual capability execution. Returns a `CapabilityResult`. Operational errors (e.g. HTTP 5xx) MUST be reported via `CapabilityResult`, not as infrastructure errors. Only unreachable hosts, TLS errors, or configuration bugs are infrastructure errors.
3. **Teardown** — Called when the task completes or the runtime state is evicted. Performs cleanup (e.g. closing sessions). Stateless runtimes implement this as a no-op.

The runtime MUST distinguish:
- **Infrastructure errors** — configuration bugs, unreachable endpoints. These terminate the task.
- **Operational errors** — HTTP 5xx, tool-level failures. These are reported back to the LLM for potential recovery.

## `cel`

Evaluates a [CEL](https://github.com/google/cel-spec) expression and returns its result as the capability output.

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

## `stateless_http`

Issues HTTP requests with no cross-request session state. Each capability invocation is independent.

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

## `stateful_session`

Maintains a remote session across multiple capability invocations within a task. The runtime establishes the session on first invocation (Initialize) and tears it down when the task ends.

Session-scoped variables extracted from the session are available as `{session.<key>}` during interpolation.

```yaml
stateful_session:
  create:                # HTTP call to establish the session
    method: POST
    url: str
    body: object | None
  extract:               # Fields to extract from the create response into session state
    <session_key>: str   # JSONPath expression
  execute:               # HTTP call for each capability invocation
    method: str
    url: str             # may reference {session.<key>}
    body: object | None
  destroy:               # HTTP call to tear down the session
    method: DELETE
    url: str
```

## `openapi`

Derives capabilities from an OpenAPI specification. The runtime fetches the spec URL and automatically generates capability schemas and execution logic.

```yaml
execute:
  openapi:
    url: str   # URL pointing to an OpenAPI 3.x specification
```

The runtime MUST derive parameters from the OpenAPI spec's operation definitions.

## `filesystem`

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

# Capability shorthand (auto-generates name, description, execute block)
capabilities:
  - filesystem: "read_chunk"   # Well-known action name
  - filesystem: "write_file"
  - filesystem: "list_dir"
```

Well-known filesystem action names include: `read_chunk`, `write_file`, `list_dir`, `search`, `delete_file`, and others as defined by the runtime.

## `mcp`

Bridges to a [Model Context Protocol](https://modelcontextprotocol.io) server. The MCP server exposes its own set of tools; the runtime proxies capability invocations to the MCP server.

```yaml
mcp:
  transport: "stdio" | "sse"
  command: str | None       # for stdio transport
  args: list[str] | None
  url: str | None           # for sse transport
  env: dict[str, str] | None
```

## `kubernetes_job`

Runs a Kubernetes Job and returns its output. The runtime submits the Job spec to the cluster, waits for completion, and returns the result.

```yaml
execute:
  kubernetes_job:
    namespace: str           # Kubernetes namespace to create the job in
    spec: KUBERNETES_JOB_SPEC
```
