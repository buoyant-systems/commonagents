---
id: task-context
sidebar_position: 1
title: Task Context
description: Task lifecycle states, termination conditions, and the task context object available to CEL expressions.
---

# Task Context

## Task Lifecycle

A task is a stateful, persistent conversation session. It does not terminate when the agent responds — instead it returns to an **idle** phase and waits for further input.

### Phases

A task's `status.phase` is one of:

| Phase | Meaning |
|---|---|
| `idle` | Between turns, waiting for the next input message. |
| `processing` | Mid-turn — actively executing, or yielded on one or more asynchronous operations. |
| `terminal` | Finished permanently. `status.terminal_reason` is set and the task MUST NOT be mutated further. |

An `idle` task may accept new input. Exactly how long a runtime keeps an idle task open before completing it is implementation-defined — a runtime may keep it open indefinitely or enforce an inactivity lifespan.

### Termination

When `phase` is `terminal`, `status.terminal_reason` explains why. It is one of:

| `terminal_reason` | Meaning |
|---|---|
| `completed` | The task was finished by an explicit, positive action — never as a side effect of ordinary processing. A task that has simply delivered its output goes `idle`, not `terminal`. |
| `errored` | The task halted on an unrecoverable error — an unreachable endpoint, an invalid configuration, or an exceeded resource limit (`max_turns`, `max_prompt_tokens`, `max_completion_tokens`, `max_age`, `max_tool_calls`). A runtime records error detail internally; how much of it is exposed, and to whom, is implementation-defined. |
| `restricted` | The task was permanently locked by a guardrail or middleware `lock_task` outcome. |

`terminal_reason` MUST be `null` for any non-terminal task.

Operational errors — HTTP failures, individual tool-level errors — are reported back to the LLM as capability results and do **not** terminate the task.

## Context Object

The **task context** is the subset of a running task's state that is available to CEL expressions in middleware assertions, guardrails, agent prompt interpolation, capability bindings, and CEL tool expressions. It is exposed as the `context` variable (aliased as `c`).

## Structure

```yaml
context:
  agent:
    name: str              # The agent processing this task
    namespace: str         # The namespace
    started_at: str        # UTC ISO 8601 task creation timestamp

  user:
    id: str                # Implementation-specific user identifier
    email: str | None      # User email, if available

  llm:
    model: str             # Resolved model string, e.g. "gemini/gemini-2.5-flash"
    tokens:
      total: int
      prompt: int
      completion: int

  _history:
    turns: list[str]       # Ordered list of turn types: "input", "llm", "capability"
    turn_count: int

  input: list[TaskIO]      # Conversational inputs (user messages + agent parameters)
  output: list[TaskIO]     # Agent outputs so far

  capabilities:
    _meta:
      invocations: list[str]    # Ordered function names, one per invocation
      count: int
      delegation_count: int
    <function>:                 # Keyed by function name (see below)
      count_successful: int
      count_errored: int
      count_restricted: int
      timestamps: list[str]
      inputs: list[object]
      outputs: list[object]
      successful: list[bool]
      errored: list[bool]
      restricted: list[bool]
      task_ids: list[str] | None  # Present for sub-agent delegations only
```

## TaskIO

`input` and `output` are lists of [TaskIO](./task-io.md) objects — the human-facing shape of one conversational message: the well-known `message`, `received_at` and `committed_at` keys plus dynamic keys from the agent's `parameters` schema (input entries) or `exposes` schema (output entries).

Each input entry carries its own snapshot of `message` and parameter values. CEL bindings reference them via:

```cel
context.input[0].ticket_id
context.input[0].project_name
```

## Capability Keys

Capabilities are keyed by their **function name** — the exact identifier the LLM uses when invoking the capability. Derived as follows:

- **Single-capability tool** — sanitized agent capability reference (e.g. agent ref `slack-post` → key `slack_post`)
- **Multi-capability tool** — sanitized ref + sanitized capability name (e.g. ref `github-file`, capability `read-chunk` → key `github_file_read_chunk`)
- **Sub-agent delegation** — sanitized agent name (e.g. agent `research-agent` → key `research_agent`)

Sanitization replaces hyphens with underscores to produce valid CEL identifiers.

## Accessing Context in CEL

### Shorthand aliases

```cel
c          # alias for context
c.cap      # alias for context.capabilities
i          # alias for input  (middleware only)
o          # alias for output (after-middleware only)
```

### Common patterns

```cel
# User identity
context.user.id
context.user.email

# Agent input parameters
context.input[0].ticket_id
context.input[0].repo_name

# First output message text
context.output[0].message[0].text

# Whether a capability succeeded at least once
context.capabilities.github_file_read_chunk.count_successful > 0

# Output from the most recent invocation of a capability
context.capabilities.zendesk_fetch_ticket.outputs[0]

# Total token usage
context.llm.tokens.total

# Number of turns
context.llm.tokens.total > 5000 && context._history.turn_count > 8
```

## Available Scopes

The `context` variable is available in:

| Scope | Variables |
|---|---|
| Middleware `before` steps | `context`, `input`, `now` |
| Middleware `after` steps | `context`, `input`, `output`, `now` |
| Guardrail `before` steps | `context`, `input`, `now` |
| Guardrail `after` steps | `context`, `output`, `now` |
| Agent `bindings` | `context` |
| CEL tool `expression` | `context`, `input`, `now`, `mount.read()`, `mount.write()` |
| Agent prompt interpolation | `context` |
| LLM capability script | `<capability>()`, `file()` — no `context` access |

See [CEL Reference](../reference/cel.md) for the full list of available functions and macros.
