---
id: parameters
sidebar_position: 2
title: Parameter Pipeline
description: How parameters flow from settings through bindings, LLM generation, and interpolation in tool capabilities.
---

# Parameter Pipeline

The parameter pipeline describes how values reach a tool capability at execution time, and how those values control event routing. Understanding this pipeline is essential for writing secure tools that prevent prompt injection and enforce data integrity.

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
    format: str | None         # e.g. "password", "uri", "date-time"
    enum: list[any] | None
    # ... standard JSON Schema properties
```

### Required vs Optional

- A property **without** a `default` field is **required** — it must be provided by the LLM or a binding before execution.
- A property **with** a `default` field is **optional** — the runtime backfills the default if the value is absent.

### `require_binding: true`

When set to `true`, the runtime MUST:
- Reject any LLM-generated value for this parameter.
- Require the value to be provided by an [agent binding](../capabilities/bindings) or a middleware binding.
- Return an error to the LLM if the parameter is missing and no binding is configured.

This is the primary mechanism for enforcing that security-critical parameters (user IDs, account numbers, resource identifiers) cannot be influenced by prompt injection.

For the action allow list: `require_binding: true` **seals** the allow list for that parameter name — it is fixed to the binding value and cannot be expanded by LLM action calls.

All root tool parameters are available as `parameters.*` inside event `receive.filter` CEL expressions. Parameters with `require_binding: true` are well-suited for use in filters because their values are always binding-enforced — making them reliable and immutable routing conditions.

## Parameter Sources

A capability parameter can originate from four sources, in priority order (highest wins):

```
1. Agent Bindings      ← highest priority, always wins
2. Middleware Bindings ← overrides capability-level bindings in invoke steps
3. LLM Generation     ← blocked if require_binding: true
4. Default Value      ← from the parameter schema's default field
```

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
- `require_binding: true` on any parameter at any level fixes the allow list to the binding value. The runtime MUST NOT append to it from action calls.

**Per-action / per-event sync:**
- If a per-action parameter and a per-event parameter share the same name, they are the same allow list entry. This is how tool authors link specific action inputs to specific event filters — through naming.

## Interpolation

After parameters are resolved, their values are interpolated into tool spec fields using `{variable.key}` syntax. See [CEL Reference](cel#interpolation-syntax) for the full interpolation roots.

```yaml
# parameters.path resolved from LLM, settings.github.token from settings
url: "https://api.github.com/repos/{settings.github.owner}/{parameters.repo}/contents/{parameters.path}"
headers:
  Authorization: "Bearer {settings.github.token}"
```

Event `message` templates use `{event.payload.*}` interpolation — referencing the raw inbound payload directly. There is no extraction alias layer.

## Settings

Settings are namespace-level configuration values declared in the tool's `settings` schema. They are:
- Configured by namespace administrators, not provided by the LLM.
- The runtime MUST NOT allow the LLM to set any key declared in `settings`.
- Referenced in tool fields via `{settings.<key>}`.

```yaml
settings:
  properties:
    api_key:
      title: "API Key"
      format: "password"   # masked in UIs
    base_url:
      title: "API Base URL"
      default: "https://api.example.com"
```

## Auth Tokens

The `{auth.<provider>}` interpolation root injects tokens generated by the runtime's pluggable authentication system. Auth providers are configured at the server level, not in the tool manifest.

```yaml
headers:
  Authorization: "Bearer {auth.oauth2}"
```

## Pipeline Example

```yaml
# Tool manifest
parameters:
  properties:
    # Root: applies to all actions + all events
    repo_id:
      type: string
      require_binding: true    # sealed to binding value; allow list immutable

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
        filter: >
          event.payload.action == 'assigned'
          && event.payload.repository.id == parameters.repo_id
          && event.payload.assignee.login == parameters.assignee

# Agent manifest
capabilities:
  my-tool:
    bindings:
      repo_id: "context.input[0].repo_id"   # sealed — allow list immutable
      # assignee: not bound → starts empty; grows as LLM calls create_issue
```

Execution flow for this example:
1. `repo_id` → sealed from binding at task start. `issue_assigned` events for this repo are routable from the beginning, scoped to `repo_id` only.
2. `assignee` → allow list starts empty. `issue_assigned` events for any assignee are **discarded**.
3. LLM calls `create_issue` with `assignee: "alice"` → allow list for `assignee` becomes `{"alice"}`.
4. `issue_assigned` events for Alice now route. Events for other assignees are **discarded**.
5. LLM calls `create_issue` with `assignee: "bob"` → allow list becomes `{"alice", "bob"}`. Events for either now route.
