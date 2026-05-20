---
id: agent
sidebar_position: 1
title: Agent
description: Full specification of the Agent manifest format for the Common Agent Specification.
---

# Agent

An agent is defined by a YAML file with the following schema:

```yaml
kind: "commonagents.info/v1/agent"
namespace: str
name: str
description: str
prompt: str
default_message: str | None

model: str | None
priority: int | None
memory: "agent" | "user" | "task" | "none"   # default: "task"

limits:
  max_turns: int | None
  max_prompt_tokens: int | None
  max_completion_tokens: int | None
  max_age: str | None        # Go duration string, e.g. "2h", "30m"
  max_tool_calls: int | None

parameters:
  type: "object"
  properties: dict[str, ParameterSchema]

capabilities:
  <key>: "*" | Capability

model_capabilities: list[str] | None

guardrails:
  before: list[MiddlewareStep] | None
  after: list[MiddlewareStep] | None

exposes:
  <key>: CEL_EXPRESSION | None
```

## Fields

### Identity

1. **`kind`** — Identifies this manifest as an Agent. A manifest with a different `kind` value is not defined by this specification.
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

6. **`default_message`** — When present, used as the input message when no message is provided at task creation.

### Model & Priority

7. **`model`** — When present, specifies the model the runtime should use for this agent.
8. **`priority`** — When present, specifies the scheduling priority for tasks created from this agent.
9. **`memory`** — Controls the scope of LLM memory. Defaults to `"task"` when absent.
   - `"agent"` — memory persists across all tasks for this agent.
   - `"user"` — memory persists per agent+user combination.
   - `"task"` — memory is scoped to the individual task.
   - `"none"` — memory functionality is not exposed to the LLM.

### Limits

10. **`limits`** — When present, defines resource limits for tasks created from this agent. When a limit is exceeded, the runtime terminates the task with reason `limit_exceeded`.
    - `max_turns` — maximum number of LLM turns.
    - `max_prompt_tokens` — cumulative prompt token limit across all LLM calls.
    - `max_completion_tokens` — cumulative completion token limit.
    - `max_age` — wall-clock duration limit as a Go `time.Duration` string (e.g. `"2h"`, `"30m"`).
    - `max_tool_calls` — total number of capability invocations.

### Parameters

11. **`parameters`** — When present, defines the structured input this agent accepts at task creation. The schema itself is static — no interpolation. Uses [`ParameterSchema`](../reference/parameters) semantics:
    - A property **without** a `default` is required — the caller must supply a value.
    - A property **with** a `default` is optional — the default is used when the value is absent.
    - `allow_from_llm: false` — the runtime does not expose this parameter to the LLM; it must be supplied by a binding.
    - `message` is a reserved parameter name and may not be used.

### Capabilities

A **capability** is an action the LLM can invoke during a task. Capabilities come in two forms:

- **Tool capabilities** — functions backed by a real execution backend (HTTP, CEL, filesystem, MCP, etc.). The LLM never sees the raw tool — only its individual named capabilities, presented as callable functions.
- **Agent delegation** — another agent exposed as a capability. When invoked, the runtime creates an autonomous child task that runs its own conversation loop and returns its output as a capability result. From the LLM's perspective this is indistinguishable from a tool call.

12. **`capabilities`** — Defines the capabilities available to the LLM for this agent. Each key references a tool or another agent. Each value is either `"*"` or a `Capability` object.

    **`"*"` (wildcard)** — All sub-capabilities are visible to the LLM, with no middleware and no bindings.

    **`Capability` object:**

    ```yaml
    include: list[str] | None
    bindings: dict[str, str] | None
    before_first: list[MiddlewareStep] | None
    before: list[MiddlewareStep] | None
    after: list[MiddlewareStep] | None
    ```

    - **`include`** — When present, only the named sub-capabilities are visible to the LLM. An explicit empty list `[]` hides all sub-capabilities. No interpolation.
    - **`bindings`** — Each value is a full **CEL expression** (not `{...}` interpolation) evaluated at invocation time. Available roots: `context`, `runtime`, `now`. See [Bindings](../capabilities/bindings).
    - **`before_first`** — Middleware steps evaluated before the first invocation of this capability in a task only.
    - **`before`** — Middleware steps evaluated before every invocation.
    - **`after`** — Middleware steps evaluated after every invocation, before the result is returned to the LLM.

    See [Middleware](../capabilities/middleware) for the full step specification.

### Sub-Agent Delegation

When a capability key references another agent, the runtime presents it to the LLM as a function with a single string `message` parameter. When invoked, a child task is created that runs autonomously; its output or error is returned to the parent as a capability result.

### Model Capabilities

13. **`model_capabilities`** — When present, these identifiers are injected into the LLM API request as provider-specific built-in tools.

    Well-known values:
    - `"web-search"` — Enables LLM-native web search grounding.

    A model capability name may not duplicate a key in the `capabilities` map.

### Guardrails

14. **`guardrails`** — When present, defines middleware steps evaluated at the agent's input/output boundary. `before` steps are evaluated when the agent receives input; `after` steps are evaluated before the agent responds. Uses the same middleware step field semantics as capability middleware. See [Middleware](../capabilities/middleware).

### Exposes

15. **`exposes`** — When present, the runtime appends these key-value pairs to the response returned to the caller. Each value is a **full CEL expression** evaluated against the task context. Available roots: `context`, `input`, `output`, `now`, `runtime`. See [Task Context](../capabilities/task-context).

## Example

```yaml
kind: "commonagents.info/v1/agent"
namespace: "engineering"
name: "code-reviewer"
description: "Reviews pull requests and suggests improvements."
prompt: |
  You are an expert software engineer helping {context.user.email}.
  Review the provided pull request diff and give constructive feedback.
  Focus on correctness, maintainability, and security. Be concise.

model: "gemini/gemini-2.5-flash"
memory: task

limits:
  max_turns: 10
  max_age: "30m"

capabilities:
  github-file:
    include: [read_chunk]
    bindings:
      repo: "context.input[0].repo"
  slack-notify:
    before:
      - assert: "context.user.id != ''"
        error_message: "User identity required to post to Slack."

guardrails:
  before:
    - assert: "size(input[0].message) < 50000"
      error_message: "Pull request diff too large to review."
```
