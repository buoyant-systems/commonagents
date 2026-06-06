---
id: agent
sidebar_position: 1
title: Agent
description: Full specification of the Agent manifest format for the Common Agent Specification.
---

# Agent

An agent pairs a system prompt with a set of capabilities, defining what an LLM can do, what constraints apply, and how it interacts with the outside world.

An agent is defined by a YAML file with the following schema:

```yaml
kind: "commonagents.info/v1beta2/agent"
namespace: str
name: str
description: str
prompt: str

model: str | None
priority: int | None
mount: "none" | "task" | "agent" | "workspace"   # default: "none"

limits:
  max_turns: int | None
  max_prompt_tokens: int | None
  max_completion_tokens: int | None
  max_age: str | None        # duration string, e.g. "2h", "30m"
  max_tool_calls: int | None

parameters:
  type: "object"
  properties: dict[str, ParameterSchema]

capabilities:
  <key>: "*" | Capability

    # The string literal "*" indicates unrestricted access: all sub-capabilities
    # visible to the LLM, no middleware, and no bindings. An empty object {} is
    # NOT valid and MUST be rejected.
    #
    # Capability (object with at least one field):
    #     include: list[str] | None
    #     bindings: dict[str, str] | None
    #     event_timeout: str | None
    #     before_first: list[MiddlewareStep] | None
    #     before: list[MiddlewareStep] | None
    #     after: list[MiddlewareStep] | None

model_capabilities: list[str] | None

guardrails:
  before: list[MiddlewareStep] | None
  after: list[MiddlewareStep] | None

exposes:
  <key>: CEL_EXPRESSION | None
```

## Fields

### Identity

1. **`kind`** — Identifies this manifest as an Agent. Must be `"commonagents.info/v1beta2/agent"`.
2. **`namespace`** — Identifies the namespace this agent belongs to.
3. **`name`** — Identifies the agent uniquely within its namespace.
4. **`description`** — A human-readable description of the agent's purpose.
5. **`prompt`** — The system instruction provided to the LLM. The runtime MAY augment this with additional context.

   Supports `{expression}` interpolation evaluated at task execution time. Available roots:

   | Root | Description |
   |---|---|
   | `context` | The full [task context](../capabilities/task-context) |
   | `runtime` | Runtime metadata: `runtime.version`, `runtime.dashboard_url`, `runtime.api_root` |
   | `now` | UTC ISO 8601 timestamp string |

   Example: `"You are helping {context.user.email} with their support tickets."`


### Model & Priority

7. **`model`** — When present, specifies the model the runtime should use for this agent.
8. **`priority`** — When present, specifies the scheduling priority for tasks created from this agent.
9. **`mount`** — Controls the agent's access to the workspace mount. Defaults to `"none"` when absent. See [Mount](mount).
   - `"none"` — no mount access. `mount.*` template variables and `mount.read()`/`mount.write()` CEL functions are not available.
   - `"task"` — mount prefix is scoped to the individual task.
   - `"agent"` — mount prefix is scoped to the agent (shared across tasks).
   - `"workspace"` — mount prefix is scoped to the entire workspace.

### Limits

10. **`limits`** — When present, defines resource limits for tasks created from this agent. When a limit is exceeded, the runtime terminates the task with reason `limit_exceeded`.
    - `max_turns` — maximum number of LLM turns.
    - `max_prompt_tokens` — cumulative prompt token limit across all LLM calls.
    - `max_completion_tokens` — cumulative completion token limit.
    - `max_age` — wall-clock duration limit (e.g. `"2h"`, `"30m"`).
    - `max_tool_calls` — total number of capability invocations.

### Parameters

11. **`parameters`** — When present, defines the structured input this agent accepts. The schema itself is static — no interpolation. Uses [`ParameterSchema`](../reference/parameters) semantics:
    - A property **without** a `default` is required — the caller must supply a value.
    - A property **with** a `default` is optional — the default is used when the value is absent.
    - `require_binding: true` — a **validation constraint**: the parent agent invoking this sub-agent must supply a binding for this parameter. Without a binding the configuration is invalid. It is the binding that hides the parameter from the LLM.
    - `message` is a **well-known key** of type `list[ContentPart]`. It is the primary conversational content for a task turn. `message` does not need to be declared in the schema — it is implicitly part of every input. However, `message` MUST be present on every input, either provided explicitly by the caller or resolved from a `default` declared in the schema. If `message` is absent and no default is declared, the input is invalid. An agent MAY declare `message` in its schema solely to specify a `default` value.

### Capabilities

A **capability** is anything the LLM can invoke during a task, or that can send inbound events to the task. Capabilities come in three forms:

- **Tool actions** — outbound functions backed by a real execution backend (HTTP, CEL, MCP, etc.). The LLM never sees the raw tool — only its individual named actions, presented as callable functions.
- **Tool events** — inbound signals from external platforms. When a tool is declared as a capability, all of its events are automatically subscribed. Events inject input into the task using the tool's `message` template, scoped by the agent's bindings. See [Events](../capabilities/events).
- **Agent delegation** — another agent exposed as a capability. When invoked, the runtime creates an autonomous child task that runs its own conversation loop and returns its output as a capability result. From the LLM's perspective this is indistinguishable from a tool action.

12. **`capabilities`** — Defines the capabilities available to this agent. Each key references a tool or another agent. Each value is either `"*"` or a `Capability` object.

    **`"*"` (wildcard)** — All actions are visible to the LLM and all events are subscribed, with no middleware and no bindings.

    **`Capability` object:**

    ```yaml
    include: list[str] | None
    bindings: dict[str, str] | None
    event_timeout: str | None        # duration string — overrides tool event timeout
    before_first: list[MiddlewareStep] | None
    before: list[MiddlewareStep] | None
    after: list[MiddlewareStep] | None
    ```

    - **`include`** — When present, only the named actions **and events** are active. Actions not in the list are hidden from the LLM; events not in the list are not subscribed. An explicit empty list `[]` hides all actions and subscribes to no events. No interpolation.
    - **`bindings`** — Each value is a full **CEL expression** (not `{...}` interpolation) evaluated at invocation time. Available roots: `context`, `runtime`, `now`. Binding values populate `parameters.*` which the tool's event `receive.filter` expressions can reference to scope which events are routed to this agent. See [Bindings](../capabilities/bindings).
    - **`event_timeout`** — optional duration string (e.g. `"24h"`, `"48h"`). Overrides the tool's per-event `timeout` for all events on this capability. The effective timeout is clamped to the tool's `max_timeout` when one is declared. If absent, the tool's `timeout` is used as the default. See [Events — Subscription Lifecycle](../capabilities/events#subscription-lifecycle).
    - **`before_first`** — Middleware steps evaluated before the first invocation of this capability in a task only.
    - **`before`** — Middleware steps evaluated before every action invocation **and** before every incoming event activation. When evaluated for an event, the `event` variable is available in CEL scope. Use `!has(event) || <condition>` for assertions that should only apply to events. See [Events](../capabilities/events).
    - **`after`** — Middleware steps evaluated after every action invocation, before the result is returned to the LLM. Also evaluated after each incoming event is formatted, before it is committed as input. Use `has(event)` to apply transforms only to event-originated turns.

    See [Middleware](../capabilities/middleware) for the full step specification.

### Sub-Agent Delegation

When a capability key references another agent, the runtime presents it to the LLM as a function with a single string `message` parameter. When invoked, a child task is created that runs autonomously; its output or error is returned to the parent as a capability result.

### Model Capabilities

13. **`model_capabilities`** — When present, these identifiers are injected into the LLM API request as provider-specific built-in tools.

    Well-known values:
    - `"web-search"` — Enables LLM-native web search grounding.
    - `"image-generation"` — Enables LLM-native image generation. **Requires** a non-`none` `mount` — generated media is written to mount storage.
    - `"audio-generation"` — Enables LLM-native audio generation. **Requires** a non-`none` `mount`.
    - `"video-generation"` — Enables LLM-native video generation. **Requires** a non-`none` `mount`.

    A model capability name may not duplicate a key in the `capabilities` map.

### Guardrails

14. **`guardrails`** — When present, defines middleware steps evaluated at the agent's input/output boundary. `before` steps are evaluated when the agent receives input; `after` steps are evaluated before the agent responds. Uses the same middleware step field semantics as capability middleware. See [Middleware](../capabilities/middleware).

### Exposes

15. **`exposes`** — When present, the runtime appends these key-value pairs to the response returned to the caller. Each value is a **full CEL expression** evaluated against the task context. Available roots: `context`, `input`, `output`, `now`, `runtime`. See [Task Context](../capabilities/task-context).

## Example

```yaml
kind: "commonagents.info/v1beta2/agent"
namespace: "engineering"
name: "coder-agent"
description: "An autonomous software engineer that responds to PR feedback."
prompt: |
  You are an expert software engineer helping {context.user.email}.
  Open pull requests, push commits, and address review feedback.

model: "gemini/gemini-2.5-flash"
mount: agent     # mount.read()/mount.write() enabled, prefix scoped to agent

limits:
  max_turns: 20
  max_age: "2h"

capabilities:
  github-file:
    bindings:
      owner: "buoyant-systems"
      repo:  "agent-mesh"

  github-pr:
    bindings:
      owner: "buoyant-systems"
      repo:  "agent-mesh"
    event_timeout: "48h"   # override tool default (72h), clamped to tool max (168h)
    include: [create_pr, comment, review]   # expose create_pr action; subscribe to comment + review events
    before:
      - assert: "context.capabilities['github_pr'].count_successful < 20"
        error_message: "Action limit reached for this session."
      - assert: "!has(event) || event.author != 'agentmesh-bot'"
        error_message: "Ignoring bot events."

guardrails:
  before:
    - assert: "size(input[0].message) < 50000"
      error_message: "Input too large."
```
