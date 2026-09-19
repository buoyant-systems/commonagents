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
| `errored` | The task halted on an unrecoverable error — an unreachable endpoint, an invalid configuration, or, where the implementation ends a task at a resource limit rather than holding it, an exhausted limit. A runtime records error detail internally; how much of it is exposed, and to whom, is implementation-defined. |
| `restricted` | The task was permanently locked by a middleware step's `on_error: lock_task`. |
| `abandoned` | The task was waiting for something only a person could supply — an approval, an authorisation, a credential, more budget — and nobody supplied it before the task's idle lifespan elapsed. Neither a failure of the work nor a completion of it: nothing went wrong, and nothing was finished. |

`terminal_reason` MUST be `null` for any non-terminal task.

Operational errors — HTTP failures, individual tool-level errors — are reported back to the LLM as capability results and do **not** terminate the task.

## Context Object

The **task context** is the subset of a running task's state that is available to CEL expressions in middleware assertions, guardrails, agent prompt interpolation, capability bindings, and CEL tool expressions. It is exposed as the `context` variable (aliased as `c`).

## Structure

```yaml
context:
  agent:
    name: str              # The agent processing this task
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

Capabilities are keyed by their **name** — what an agent's author writes to reach one, here and in a middleware call. A name is the resource, an optional qualifer, and (for a tool) the action, joined with dots:

| | name | depth |
|---|---|---|
| Tool, no qualifer | `github_file.read_chunk` | 2 |
| Tool, with qualifer | `qualifer.github_file.read_chunk` | 3 |
| Delegation, no qualifer | `research_agent` | 1 |
| Delegation, with qualifer | `agent://qualifer.research_agent` | 2 + scheme |

**Depth says which kind is named.** A tool always carries its action and an agent never has one, so in the common case nothing else has to be written to tell them apart. An agent may therefore reference a tool and an agent of one name: `fetcher.read` and `fetcher` are different names.

Two segments is the one depth both kinds could claim, and the tool takes priority. That is why a delegation of with an additional qualifier carries the scheme: `scope.research_agent` already means the tool `scope` and its action `research_agent`.

### The `agent://` scheme

`agent://` may always be written on a delegation. It is required in two places, and both are the same question — whether the bare form would name something else:

- **A delegation with a qualifier**, always, because otherwise this would be an unqualifed tool.
- **A delegation whose path a tool has claimed** — a tool `fetcher` keeps its actions under `fetcher`, so the delegation of that name is `agent://fetcher`.

Writing the scheme when it is not needed gives you a name that cannot move later.

### Reading a record

This object is **nested on the name**: `context.capabilities.github_file.read_chunk.outputs`, `context.capabilities.research_agent.task_ids`. The nesting is the name, so an author who can write a capability can read its record.

A record's arrays are in invocation order and aligned: index 0 is the first invocation, and the last element is the latest.

`agent://` cannot appear in a CEL path, so a delegation whose name carries it is read by its whole name as a key: `context.capabilities["agent://fetcher"]`.

**Every delegation reads under that key**, including one whose name does not require the scheme: `context.capabilities["agent://research_agent"]` and `context.capabilities.research_agent` are the same record. That is what makes the long form the spelling you can rely on — it goes on reading if a tool later claims the short path.

What the LLM writes to CALL a capability is derived from this name and may be shorter — see [CEL reference](../reference/cel.md). An author is never shown that spelling.

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
context.capabilities.github_file.read_chunk.count_successful > 0

# Output from the first invocation of a capability
context.capabilities.zendesk.fetch_ticket.outputs[0]

# Output from the latest invocation
c.cap.zendesk.fetch_ticket.outputs.last()

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
