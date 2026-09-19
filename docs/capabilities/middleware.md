---
id: middleware
sidebar_position: 1
title: Middleware
description: Middleware steps — assert and transform — that gate capability calls and an agent's input and output.
---

# Middleware

The specification provides two layers of policy enforcement, both invisible to the LLM — steps consume no turns and appear in no conversation history, except through what they return.

**Capability middleware** runs before and/or after the LLM's calls to a capability. It is declared on an agent's capability configuration.

**Guardrails** are the same mechanism at the agent's input/output boundary: they gate what the agent receives and what it sends, across the entire conversation.

Middleware runs only for the LLM's calls and the task's own input and output. A capability called from middleware runs no middleware of its own.

```yaml
MiddlewareStep:
  # Exactly one of assert or transform MUST be set.
  assert: str | None         # CEL expression that must be truthy
  transform: str | None      # CEL expression whose value replaces what flows through

  # Filters
  match: str | None          # Only fire for this action name
  condition: str | None      # CEL gate — skip step if falsy

  deny_message: str | None   # assert only — {expression} template returned on denial
  on_error: "fail_call" | "lock_task" | "ignore" | None
```

Steps are placed in ordered `before`, `before_first`, and `after` lists and MUST be executed sequentially.

## Assert

A truthy value passes; a falsy value **denies** (see [Denial](#denial)).

## Transform

The value replaces what flows through the pipeline, and subsequent steps run with it.

| List | The value replaces | Seen as |
|---|---|---|
| Capability `before` / `before_first` | The arguments the LLM provided | `input` |
| Guardrail `before` | The arriving input: its `message` and parameters | `input` |
| Capability `after` | The capability's result | `output` |
| Guardrail `after` | The model's response | `output` |

A `before` transform MUST NOT set a parameter the agent binds. The transformed input is validated as the original would have been.

```yaml
- transform: "input.put('email', '[redacted]')"                  # before
- transform: "{'id': output.id, 'status': output.status}"        # after
```

## Calling Capabilities

`assert` and `transform` expressions MAY call the agent's capabilities by name — `crm.search({'query': 'acme'})`, or `analyst.send('…')` for a sub-agent. A call is a value, dispatched where the expression consumes it.

1. Its value is the result, or `{error}` when the call failed. A failed call does not fail the step.
2. It MAY reach a capability the agent's `include` list hides from the LLM.
3. Its arguments are exactly those passed: [bindings](bindings.md) apply only to the LLM's calls.
4. It is recorded on the task context as the LLM's calls are.
5. A wait it meets holds the step. A call already completed MUST NOT be dispatched again.
6. `condition` and `deny_message` MUST NOT call capabilities.

## Answering Early

`answer(value)` ends a `before` or `before_first` pipeline with `value` as the answer. It MUST be a transform's whole value, or a branch of a conditional in that position.

The remaining `before` steps do not run, and neither does what the pipeline guards; the answer passes through the `after` list. For a capability, the capability is not called and the answer is the call's successful result. For a guardrail, no generation runs: the input commits and the answer is the turn's output.

```yaml
- transform: "answer(crm.search({'query': 'acme'}))"
```

## Denial

A denial returns `deny_message` in place of what the pipeline guards, and nothing after it runs.

| List | Effect |
|---|---|
| Capability `before` / `before_first` | The capability is not called; the LLM receives the message as the call's error. |
| Capability `after` | The LLM receives the message as the call's error instead of the result. |
| Guardrail `before` | The input is refused: recorded, never shown to the model. The turn's output is the message. Both carry [`error`](task-io.md): `denied_by_input_guardrail`. |
| Guardrail `after` | The response is withheld, and the message replaces it. The turn's output is the message, with `error: denied_by_output_guardrail`. |

For an event activation, a denial discards the event instead: nothing is committed.

`deny_message` is an `{expression}` template. Absent, the implementation supplies the message.

```yaml
- assert: "float(input.amount) <= 500.00 || review(context.user.id)"
  deny_message: "Refund of {input.amount} was not approved."
```

## Errors (`on_error`)

A step **errors** when an expression cannot be evaluated. A failed capability call is not an error of the step.

| Value | Effect |
|---|---|
| `"fail_call"` (default) | The error is returned as a denial's message is. |
| `"lock_task"` | The task halts permanently, with `terminal_reason: restricted`. |
| `"ignore"` | The step is skipped. Discouraged on an `assert`, which then lets through what it could not check; an implementation SHOULD warn of it. |

## CEL Context

| Variable | Description |
|---|---|
| `context` / `c` | The task context |
| `input` / `i` | Capability middleware: the LLM's arguments, as transformed. Guardrail `before`: the arriving input |
| `output` / `o` | `after` steps only: the result, or the response, as transformed |
| `now` | UTC ISO 8601 timestamp of the current time |
| `c.cap` | Shorthand for `context.capabilities` |

See [Task Context](task-context.md) and [CEL Reference](../reference/cel.md) for full variable documentation.

## Assertion Macros

- **`review(user: str)`** — Requires the input or output to be reviewed by the specified user before proceeding. The runtime MUST yield processing until the review completes.

## Validation Rules

1. Exactly one of `assert`, `transform` must be set.
2. `deny_message` may only be set on `assert` steps.
3. `on_error` must be one of `fail_call`, `lock_task`, `ignore`.
4. Expressions must be valid CEL, and every capability they call must be one the agent declares.
5. `answer()` may only appear as described in [Answering Early](#answering-early).
