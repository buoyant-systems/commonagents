---
id: tool
sidebar_position: 2
title: Tool
description: Full specification of the Tool manifest format for the Common Agent Specification.
---

# Tool

A tool declares one or more executable actions and the execution backend that powers each one — it is the mechanism through which an agent interacts with external systems. A tool may also declare inbound events: signals from external platforms that resume a task when they arrive.

A tool is defined by a YAML file with the following schema:

```yaml
kind: "commonagents.info/v1beta2/tool"
name: str
description: str

synchronous: bool           # default: false

parameters: JSON_SCHEMA | None

actions:
  - name: str
    description: str
    parameters: JSON_SCHEMA | None
    execute:
      cel: object | None
      stateless_http: object | None
      stateful_session: object | None
      openapi: object | None
      mcp: object | None
      kubernetes_job: object | None

events:
  - name: str
    description: str | None
    message: str
    timeout: str | None         # duration string — default subscription duration
    max_timeout: str | None     # duration string — hard cap on subscription duration
    parameters: JSON_SCHEMA | None
    receive:
      webhook:
        filter: CEL | None
        secret: str | None      # {expression} resolving to the HMAC secret
      subscription: object | None
      poll: object | None

# Optional top-level shared runtime config blocks
stateless_http: object | None
stateful_session: object | None
openapi: object | None
mcp: object | None
```

## Fields

### Identity

1. **`kind`** — Identifies this manifest as a Tool. Must be `"commonagents.info/v1beta2/tool"`.
2. **`name`** — Identifies the tool. A name identifies one resource (see [Concepts](../concepts.md#references-and-versions)).
3. **`description`** — A human-readable description of the tool's purpose.

### Execution Mode

4. **`synchronous`** — Controls action execution mode. When `true`, actions execute synchronously. When `false` or absent (default), the runtime may execute actions asynchronously and yield the task while waiting for results.

### Parameters

5. **`parameters`** — When present, defines parameters shared across all actions **and** all events. All root parameters are available as `parameters.*` inside event `receive.filter` CEL expressions — the tool author may reference any of them when writing routing conditions.

   - A property **without** a `default` is required — the caller must supply a value.
   - A property **with** a `default` is optional — the default is used when the value is absent.
   - `require_binding: true` — a **validation constraint**: any agent using this tool must supply a binding for this parameter. Without a binding the configuration is invalid. It is the **binding** (not this flag) that hides the parameter from the LLM and seals its allow list entry. Parameters used in event `receive.filter` expressions are good candidates for `require_binding: true`, because it ensures the binding (and therefore the routing value) is always present.

   See [Parameter Pipeline](../reference/parameters.md) for how values flow from bindings and LLM generation through to interpolation, and how a tool reaches configuration and credentials through [connections](../reference/parameters.md#connections).

### Actions

6. **`actions`** — Defines the outbound actions this tool exposes. Each action has:
   - A `name` and `description` identifying it to the LLM.
   - An optional `parameters` schema (same semantics as the tool-level parameters).
   - Exactly one runtime backend declared in the `execute` block.

   The runtime presents individual actions — not the tool itself — to the LLM as callable functions.

### Events

7. **`events`** — When present, defines inbound events this tool can receive. Events are the inbound counterpart to actions.

   When an agent declares a tool as a capability, all of the tool's events are automatically subscribed.

   Each event has:

   - **`name`** — unique identifier within the tool.
   - **`description`** — optional; shown in the UI but **not surfaced to the LLM**.
   - **`message`** — string template using `{event.payload.*}` interpolation from the raw event payload. Produces the input injected into the task when this event arrives.
   - **`timeout`** — optional duration string (e.g. `"24h"`, `"168h"`). Defines the default subscription duration for this event — how long a task remains subscribed after its last activity. When the timeout expires, the subscription is removed but the task is not deleted or errored. If absent, the event has no default timeout. Agents MAY override this value via the capability's `timeout` field.
   - **`max_timeout`** — optional duration string. The hard maximum subscription duration for this event. Agent-specified timeouts are clamped to this value. If absent, there is no hard cap. When both `timeout` and `max_timeout` are set, `max_timeout` MUST be ≥ `timeout`. A runtime MAY also enforce its own maximum timeout independent of the tool declaration.
   - **`parameters`** — JSON Schema defining additional parameters specific to this event's `receive.filter`. These are populated by agent bindings. They share the same allow list namespace as root and per-action parameters: if a per-event parameter shares a name with a per-action parameter, LLM action calls that resolve that name also populate the per-event parameter's allow list entry.
   - **`receive`** — the inbound delivery mechanism. Exactly one sub-type key is present. The sub-type's optional `filter` CEL field references `parameters.*` resolved against the tool-wide action allow list. The `webhook` sub-type additionally supports an optional `secret` field — an `{expression}` resolving to an HMAC secret, typically a named secret field on a connection (`{connection('github').service_auth().webhook_secret}`). When present, the runtime validates the inbound webhook signature before evaluating the filter. See [Tool Runtimes](tool-runtimes.md#receive-runtimes) and [Events](../capabilities/events.md).

### Runtime Backends

Each action specifies its execution backend via the `execute` block. Exactly one backend key is present per action.

The following interpolation roots are available in **all** execution spec string fields (URLs, headers, body values, etc.) unless noted otherwise:

| Root | Description |
|---|---|
| `{parameters.<key>}` | LLM-provided or binding-resolved parameter values |
| `{connection('<provider>').<key>}` | A non-secret field of a named provider connection — base URL, project, region, tenant |
| `{connection('<provider>').user_auth(scopes?).<key>}` | A credential for the user responsible for the task; `.token` is the bearer token. The runtime injects the user's identity |
| `{connection('<provider>').service_auth(selector?).<key>}` | A credential for the deployment's own machine identity; `.token` is the bearer token. The optional selector names one target resource |
| `{session.<key>}` | Session state extracted by `stateful_session` (deferred until session is created) |
| `{runtime.version}` | Runtime version string |
| `{runtime.dashboard_url}` | Runtime dashboard URL |
| `{runtime.api_root}` | Runtime API root URL |
| `{agent.<key>}` | Agent metadata: `agent.name` |
| `{mount.<key>}` | Implementation-defined mount values. This specification defines none; see [Mount](mount.md). Present only when the agent's `mount` list is non-empty. |

The `connection(...)` roots are available in tool execution templates alone, and are where a tool SHOULD obtain its credentials and deployment configuration rather than declaring them as parameters. See [Connections](../reference/parameters.md#connections) for the resolution and failure rules.

The `cel` backend is the exception: its `expression` field is a **full CEL expression**, not `{...}` interpolation (see below).

#### `cel`

```yaml
execute:
  cel:
    expression: str   # Full CEL expression — NOT {expression} interpolation
```

The `expression` field is a full CEL expression evaluated against the middleware scope. Available roots: `context`, `input`, `now`, `runtime`. Returns a JSON-serialisable value. See [CEL Reference](../reference/cel.md).

#### `stateless_http`

```yaml
execute:
  stateless_http:
    method: str        # {expression} interpolation supported
    url: str           # {expression} interpolation supported
    headers: map       # values support {expression} interpolation
    body: object       # string values support {expression} interpolation
```

#### `stateful_session`

The `create`, `initialize`, and `teardown` HTTP call fields all support `{expression}` interpolation. The `execute` sub-block also supports full interpolation. `{session.<key>}` references are deferred until after the session is created.

#### `kubernetes_job`

`namespace` and all string values within `spec` support `{expression}` interpolation.

#### `openapi` / `mcp`

These backends derive their execution spec from an external source. Interpolation is not applicable to the `url` or command fields.

### Top-Level Runtime Blocks

When top-level runtime configuration blocks are present (e.g. `stateless_http`, `mcp`), they serve as shared configuration that individual action `execute` blocks inherit. The same interpolation roots apply.

## Example

### Tool with Actions Only

```yaml
kind: "commonagents.info/v1beta2/tool"
name: "github_file"
description: "Reads and writes files in a GitHub repository."

parameters:
  properties:
    owner:
      type: string
      description: "The repository owner."
      require_binding: true
    repo:
      type: string
      description: "The repository name."
      require_binding: true
    path:
      type: string
      description: "The file path within the repository."
    branch:
      type: string
      description: "The branch to read from or write to."
      default: "main"

stateless_http:
  base_url: "{connection('github').base_url}"
  headers:
    Authorization: "Bearer {connection('github').service_auth().token}"

actions:
  - name: read_file
    description: "Reads the contents of a file."
    execute:
      stateless_http:
        method: GET
        url: "/repos/{parameters.owner}/{parameters.repo}/contents/{parameters.path}"
        headers:
          Accept: "application/vnd.github.v3.raw"

  - name: write_file
    description: "Creates or updates a file."
    parameters:
      properties:
        content:
          type: string
          description: "The new file content."
    execute:
      stateless_http:
        method: PUT
        url: "/repos/{parameters.owner}/{parameters.repo}/contents/{parameters.path}"
        body:
          message: "Update {parameters.path}"
          content: "{parameters.content}"
          branch: "{parameters.branch}"
```

The manifest holds no token and no host. `owner` and `repo` are supplied by the agent that uses the tool (`require_binding: true` makes those bindings mandatory), and the credential and base URL are read off the `github` connection at execution time.

### Tool with Actions and Events

```yaml
kind: "commonagents.info/v1beta2/tool"
name: "github_pr"
description: "Creates and manages GitHub Pull Requests."

parameters:
  properties:
    owner:
      type: string
      require_binding: true
    repo:
      type: string
      require_binding: true

actions:
  - name: create_pr
    description: "Opens a new pull request."
    parameters:
      properties:
        title: { type: string }
        body:  { type: string }
        head:  { type: string }
        base:  { type: string }
    execute:
      stateless_http:
        method: POST
        url: "https://api.github.com/repos/{parameters.owner}/{parameters.repo}/pulls"
        headers:
          Authorization: "Bearer {connection('github').service_auth(parameters.owner).token}"

  - name: list_prs
    description: "Lists open pull requests."
    execute:
      stateless_http:
        method: GET
        url: "https://api.github.com/repos/{parameters.owner}/{parameters.repo}/pulls"
        headers:
          Authorization: "Bearer {connection('github').service_auth(parameters.owner).token}"

events:
  - name: comment
    description: "A comment was posted on a pull request."
    timeout: "72h"
    max_timeout: "168h"
    message: >
      {event.payload.comment.user.login} commented on
      PR #{event.payload.issue.number}: {event.payload.comment.body}
    receive:
      webhook:
        secret: "{connection('github').service_auth().webhook_secret}"
        filter: >
          event.payload.action == 'created'
          && has(event.payload.issue.pull_request)
          && event.payload.repository.owner.login == parameters.owner
          && event.payload.repository.name == parameters.repo

  - name: review
    description: "A review was submitted on a pull request."
    timeout: "72h"
    max_timeout: "168h"
    message: >
      {event.payload.review.user.login} submitted a
      {event.payload.review.state} review on PR
      #{event.payload.pull_request.number}: {event.payload.review.body}
    receive:
      webhook:
        secret: "{connection('github').service_auth().webhook_secret}"
        filter: >
          event.payload.action == 'submitted'
          && event.payload.repository.owner.login == parameters.owner
          && event.payload.repository.name == parameters.repo
```
