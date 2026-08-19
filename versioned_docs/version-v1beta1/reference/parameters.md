---
id: parameters
sidebar_position: 2
title: Parameter Pipeline
description: How values reach a tool capability — parameters from bindings and LLM generation, configuration and credentials from connections — and how those values control event routing.
---

# Parameter Pipeline

The parameter pipeline describes how values reach a tool capability at execution time, and how those values control event routing. Understanding this pipeline is essential for writing secure tools that prevent prompt injection and enforce data integrity.

Two independent surfaces supply a capability:

| Surface | Declared in the manifest | Supplied by | Model-visible |
|---|---|---|---|
| **Parameters** | Yes — `parameters` schemas on the tool, its actions and its events | LLM generation, or an agent binding evaluated against task context | Yes, unless bound |
| **Connections** | No — a provider is *named* at the point of use, never declared | The runtime, which resolves the named provider into configuration and credentials | Never |

The separation is the point: a tool manifest is portable because it carries no secrets and no deployment-specific configuration. It names a provider and reads what it needs off whatever the runtime resolves that name to.

## Parameter Hierarchy

A tool has three levels of parameters, each with distinct scope:

| Level | Field | Scope |
|---|---|---|
| **Root** | `tool.parameters` | Universal — available to ALL actions (in `execute` interpolation) AND ALL events (in `receive.filter`). Only parameters that apply across the entire tool belong here. |
| **Per-action** | `action.parameters` | Specific to one action — additional inputs the LLM provides when invoking that action. |
| **Per-event** | `event.parameters` | Specific to one event — additional filter inputs scoped to that event's `receive.filter`. |

All three levels share a single **allow list namespace** keyed by parameter name. See [Action Allow List](#action-allow-list) below.

## ParameterSchema

All three levels use the same `ParameterSchema` format:

```yaml
properties:
  <name>:
    type: string | number | boolean | object | array
    description: str
    default: any | None        # presence determines required/optional
    require_binding: bool      # default: false
    format: str | None         # e.g. "uri", "date-time"
    enum: list[any] | None
    # ... standard JSON Schema properties
```

### Required vs Optional

- A property **without** a `default` field is **required** — it must be provided by the LLM or a binding before execution.
- A property **with** a `default` field is **optional** — the runtime backfills the default if the value is absent.

### `require_binding: true`

`require_binding: true` is a **tool-side validation constraint**. When set:
- The API server rejects any agent that references this tool without providing a binding for the parameter.
- If no binding is configured, the configuration is invalid and the runtime MUST error.

Note: it is the **binding** (not this flag) that:
- Hides the parameter from the LLM-facing schema.
- Seals the action allow list entry so it cannot be expanded by LLM action calls.

A binding can exist without `require_binding: true` — the parameter is still hidden and the allow list entry is still sealed. `require_binding: true` only adds the validation guarantee that the binding is not accidentally omitted.

Parameters with `require_binding: true` are well-suited for use in event filters: the constraint guarantees a binding is always present, and the binding ensures the value is reliably agent-controlled and the allow list entry is sealed from task start.

## Parameter Sources

A capability parameter can originate from four sources, in priority order (highest wins):

```
1. Agent Bindings      ← highest priority, always wins; hides parameter from LLM
2. Middleware Bindings ← overrides capability-level bindings in invoke steps
3. LLM Generation      ← blocked for parameters that have an agent binding
4. Default Value       ← from the parameter schema's default field
```

Connections are not on this list, because a connection is not a parameter source: it is a separate surface a template reads at the point of use, so its value never becomes an argument. Both surfaces are available to a tool, and although nothing stops a secret being declared as a parameter and supplied by a binding, a connection is the preferred mechanism as it supports dynamically signing tokens and keeps authentication out of the domain layer. See [Connections](#connections).

## Action Allow List

The allow list is maintained **per-tool, per-task**, keyed by **parameter name**. It is a flat namespace — root, per-action, and per-event parameters all share the same allow list if they share a name.

**Growing the allow list:**
- Every time the LLM calls an action on a tool, ALL resolved parameter values (root + per-action) are added to the allow list set for their parameter name.
- A name accumulates multiple values over a task if the LLM calls actions with different values.

**Using the allow list in event filters:**
- `receive.filter` expressions that reference `parameters.*` are resolved against the allow list.
- The filter passes if the payload value is a member of the allow list set for that name.
- If a parameter's allow list is empty (no action has been called with that name yet), events referencing it are **discarded**.

**Sealing the allow list:**
- A parameter with an agent-defined binding has its allow list entry **sealed** at task start. The runtime MUST NOT append to it from action calls.
- `require_binding: true` is a validation constraint that ensures a binding is present — it is not itself what seals the entry.

**Per-action / per-event sync:**
- If a per-action parameter and a per-event parameter share the same name, they are the same allow list entry. This is how tool authors link specific action inputs to specific event filters — through naming.

## Interpolation

After parameters are resolved, their values are interpolated into tool spec fields using `{variable.key}` syntax. See [CEL Reference](cel.md#interpolation-syntax) for the full interpolation roots.

```yaml
# parameters.repo and parameters.path are resolved from the LLM or a binding;
# the host and the credential are read off the named connection.
url: "{connection('github').base_url}/repos/{parameters.repo}/contents/{parameters.path}"
headers:
  Authorization: "Bearer {connection('github').service_auth().token}"
```

Event `message` templates use `{event.payload.*}` interpolation — referencing the raw inbound payload directly. There is no extraction alias layer.

## Connections

A **connection** is a named provider a tool reads configuration and credentials from. `connection('github')` NAMES a provider and stops there: the manifest never says which credential answers that name, who owns it, or how it is stored. Resolution happens at execution time, and what it resolves to is implementation-defined.

A tool may take any value as a parameter, secrets included; a connection is the preferred mechanism for every secret a tool needs. Because it resolves at the moment of use, a connection can mint a credential — refresh an OAuth token, sign a JWT, exchange a federated identity — rather than replay one fixed when the agent was configured, and the tool's parameter surface stays free of authentication.

`connection('<provider>')` returns a **public handle** — the connection's non-secret fields and nothing else. Read a field directly off it:

```yaml
stateless_http:
  base_url: "{connection('acme').base_url}"
  headers:
    X-Project: "{connection('acme').project_id}"
```

A handle NEVER carries a credential. Credentials come only from its two member accessors, both of which return a value carrying `token` — the bearer token — alongside the connection's named public and secret fields:

| Accessor | The tool acts as | Argument |
|---|---|---|
| `.user_auth(scopes?)` | The human responsible for the task | An optional list of scopes the call needs |
| `.service_auth(selector?)` | The deployment itself — a machine identity | An optional provider-specific selector naming the target resource (an installation, tenant or organisation) |

- Acting as the user — `"Bearer {connection('google').user_auth().token}"`
- Acting as the user, narrowed to the scopes this call needs — `"Bearer {connection('google').user_auth(['drive.readonly']).token}"`
- Acting as the deployment, against one installation — `"Bearer {connection('github_app').service_auth('buoyant-systems').token}"`
- A named secret field rather than the bearer token — `"{connection('github').service_auth().webhook_secret}"`

### Rules

1. **A connection is never declared in a manifest.** There is no schema to write and no value to fill in. Which credential answers a provider name, at which scope, who may add it, and how it is rotated are all implementation-defined.
2. **The provider name MUST be a literal string.** A computed name would let runtime data — ultimately, the model — choose which credential a call is made with, and would make the set of providers a manifest needs impossible to determine without running it.
3. **`.user_auth()` has no user identity argument.** It takes an optional scope list and nothing else — the runtime injects the identity of the user responsible for the task. Whose credential a call spends is therefore never selectable from the manifest, and never from a value the model produced.
4. **`connection()` and its accessors are confined to tool execution templates** — the `execute` blocks, the top-level runtime configuration blocks, and an event's `receive` fields (`subscribe`/`unsubscribe` calls, `poll` calls, and the webhook `secret`). They MUST NOT be available in agent prompts, bindings, middleware expressions, guardrails, or LLM-authored capability scripts.
5. **Resolution failure MUST NOT degrade into an unauthenticated call.** If no connection resolves for the named provider, or `.user_auth()` has no grant from the acting user, the capability MUST NOT execute. Whether the runtime fails the invocation or holds the task until an administrator adds the connection (or the user grants consent) is implementation-defined; externally, a held task is [`phase: processing`](../capabilities/task-status.md) like any other non-progressing task.

### Choosing a mechanism

| The value is | Where it comes from |
|---|---|
| An API key or bearer token | `{connection('p').service_auth().token}` |
| A token scoped to the person the agent is acting for | `{connection('p').user_auth().token}` |
| Non-secret provider config — base URL, project, region, tenant | A public field: `{connection('p').base_url}` |
| A shared secret that is not the bearer token, e.g. a webhook HMAC key | A named secret field: `{connection('p').service_auth().webhook_secret}` |
| A fact about the calling user that the tool needs — their id, their email | A parameter bound to `context.user.id` or `context.user.email` |
| Structured input from the caller | The agent's `parameters` schema, bound via `context.input[0].<key>` |
| Something the model should reason about | A plain parameter, LLM-generated |

Who the agent acts as is not in this table, because nothing supplies it. The row above reads `context.user` and passes it to a tool as data; it does not choose whose identity is there, and that identity is the one `.user_auth()` returns.

## Pipeline Example

```yaml
# Tool manifest
parameters:
  properties:
    # Root: applies to all actions + all events
    repo_id:
      type: string
      require_binding: true    # validation constraint: binding MUST be provided

stateless_http:
  base_url: "https://api.github.com"
  headers:
    # Resolved per execution; never declared, never model-visible
    Authorization: "Bearer {connection('github').service_auth().token}"

actions:
  - name: create_issue
    parameters:
      properties:
        # Per-action: LLM provides this; also populates allow list for 'assignee'
        assignee:
          type: string
          description: "GitHub login of the assignee."

events:
  - name: issue_assigned
    parameters:
      properties:
        # Per-event: shares 'assignee' allow list with create_issue action
        # Events only route for assignees the LLM has previously specified
        assignee:
          type: string
    receive:
      webhook:
        secret: "{connection('github').service_auth().webhook_secret}"
        filter: >
          event.payload.action == 'assigned'
          && event.payload.repository.id == parameters.repo_id
          && event.payload.assignee.login == parameters.assignee

# Agent manifest
capabilities:
  my_tool:
    bindings:
      repo_id: "context.input[0].repo_id"   # sealed — allow list immutable
      # assignee: not bound → starts empty; grows as LLM calls create_issue
```

Execution flow for this example:
1. `repo_id` → sealed from binding at task start. `issue_assigned` events for this repo are routable from the beginning, scoped to `repo_id` only.
2. The `github` connection resolves at the first execution. Nothing about it appears in the LLM-facing schema, and no agent configuration references it.
3. `assignee` → allow list starts empty. `issue_assigned` events for any assignee are **discarded**.
4. LLM calls `create_issue` with `assignee: "alice"` → allow list for `assignee` becomes `{"alice"}`.
5. `issue_assigned` events for Alice now route, once their signature verifies against the resolved webhook secret. Events for other assignees are **discarded**.
6. LLM calls `create_issue` with `assignee: "bob"` → allow list becomes `{"alice", "bob"}`. Events for either now route.
