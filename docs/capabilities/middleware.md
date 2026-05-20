---
id: middleware
sidebar_position: 1
title: Middleware
description: Middleware steps — assert, invoke, transform — that gate capability execution.
---

# Middleware

The specification provides two layers of policy enforcement, both invisible to the LLM — steps do not consume turns or appear in conversation history.

**Capability middleware** runs before and/or after individual capability invocations. It is declared on an agent's capability configuration and gates what the LLM can call and what it receives back. It can assert preconditions, invoke side-effect capabilities (such as an audit log), or transform the capability result before the LLM sees it.

**Guardrails** are the same mechanism applied at the agent's input/output boundary rather than around individual capabilities. They gate what the agent receives as input and what it sends as output, across the entire conversation. Guardrails enforce organisation-level policies — content filters, input size limits, output redaction — independently of which tools the agent uses.

A `MiddlewareStep` defines a single action within either layer. Steps are placed in ordered `before`, `before_first`, and `after` lists and MUST be executed sequentially.

```yaml
MiddlewareStep:
  # Exactly one of assert, invoke, or transform MUST be set.
  assert: str | None       # CEL expression that must be truthy
  invoke: str | None       # "tool-name:capability_name"
  transform: str | None    # CEL expression whose result replaces the output

  # Filters
  match: str | None        # Only fire for this specific sub-capability name
  condition: str | None    # CEL gate — skip step if falsy

  # Failure output
  error_message: str | None   # {expression} template returned to LLM on failure

  # Failure policy
  on_fail: "block" | "continue" | "lock_task" | None

  # Invoke-only
  bindings: dict[str, str] | None
```

## Actions

A step has **exactly one** action. Validation MUST reject steps with more than one action set, or no action set.

### Assert

Evaluates a CEL expression. If truthy — the step passes. If falsy — the step fails.

```yaml
- assert: "output.status_code >= 200 && output.status_code < 300"
  error_message: "API call failed with status {output.status_code}."
  on_fail: block
```

### Invoke

Calls another tool capability directly. The invoked capability executes via its tool runtime; no middleware is evaluated on the invoked capability itself. The result is recorded on the task context at `capabilities.<compiled_function_name>`.

```yaml
- invoke: "audit-log:record_event"
  bindings:
    event_type: "'capability_executed'"
    user_id: "context.user.id"
```

### Transform

Evaluates a CEL expression whose return value **replaces** what the LLM sees. The original tool result is always preserved on `context.capabilities`.

```yaml
# Redact secrets before the LLM sees the result
- transform: "{'id': output.id, 'status': output.status, '_note': 'Credentials redacted.'}"

# Add context for the LLM
- transform: "output.put('_note', 'This config applies to new tasks only.')"
```

## Filters

- **`match`** — If set, the step only fires for the specific sub-capability matching this name. Applies within multi-capability tool contexts.
- **`condition`** — If set, the step is skipped entirely when this CEL expression evaluates to falsy. No events are emitted for skipped steps.

## Failure Policy (`on_fail`)

**For capability middleware** (`before` / `after` / `before_first`):

| Value | Effect |
|---|---|
| `"block"` (default) | Returns the error to the LLM as if the tool failed. Remaining steps are short-circuited. For `before` steps, the capability itself does NOT execute. |
| `"continue"` | Skip the failing step and continue the pipeline. |
| `"lock_task"` | Permanently halt the task. |

**For guardrail middleware** (`guardrails.before` / `guardrails.after`):

| Value | Effect |
|---|---|
| `"lock_task"` (default) | Permanently halt the task. |
| `"continue"` | Skip the failing step and continue. |
| `"block"` | **NOT valid** for guardrails. MUST be rejected. |

## Error Message

`error_message` is a template string using `{expression}` interpolation (same syntax as tool parameters — NOT raw CEL). Returned to the LLM when a step fails and `on_fail` is `block`.

- In `after` steps, `{output}` references the current tool result.
- In `before` steps, `{output}` is not available.

## CEL Context

All middleware steps have access to:

| Variable | Description |
|---|---|
| `context` / `c` | The task context — agent, user, capabilities, middleware, input, output |
| `input` / `i` | The LLM-provided arguments for the triggering capability |
| `output` / `o` | The capability result (only available in `after` steps) |
| `now` | UTC ISO 8601 timestamp of the current time |
| `c.cap` | Shorthand for `context.capabilities` |

See [Task Context](task-context) and [CEL Reference](../reference/cel) for full variable documentation.

## Assertion Macros

- **`review(user: str)`** — Requires the input or output to be reviewed by the specified user before proceeding. This is an asynchronous operation; the runtime MUST yield processing until the review completes.

```yaml
# Require the task owner to approve before a file is written
- assert: review(context.user.id)
  match: write_file
  on_fail: block
```

## Validation Rules

1. Exactly one of `assert`, `invoke`, `transform` must be set.
2. `bindings` may only be set on `invoke` steps.
3. `on_fail: "block"` MUST NOT be set on guardrail middleware steps.
4. `transform` expressions must be valid CEL.
5. `error_message` templates must contain valid `{expression}` interpolations.
