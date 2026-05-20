---
id: cel
sidebar_position: 1
title: CEL Reference
description: CEL expressions, macros, and interpolation syntax used throughout the Common Agent Specification.
---

# CEL Reference

[Common Expression Language (CEL)](https://github.com/google/cel-spec) is used throughout the Common Agent Specification for middleware assertions, guardrails, bindings, transforms, and CEL tool expressions.

## Interpolation Syntax

Tool spec fields support `{expression}` interpolation for embedding values into strings. This is NOT raw CEL — it is a lightweight template syntax:

```yaml
# In tool parameters / headers / URLs:
url: "https://api.example.com/repos/{settings.github.owner}/{parameters.repo}"
headers:
  Authorization: "Bearer {settings.api_key}"
body:
  message: "Task completed by {context.agent.name}"
```

Interpolation roots available in tool specs:

| Root | Description |
|---|---|
| `{settings.<key>}` | Namespace-level tool settings |
| `{parameters.<key>}` | LLM-provided or binding-provided parameters |
| `{session.<key>}` | Session state (stateful_session runtimes only) |
| `{auth.<provider>}` | Auth tokens from the runtime's token manager |
| `{context.<path>}` | Task context fields |

## CEL Expressions

Full CEL expressions are used in:
- Middleware `assert`, `transform` fields
- Middleware `condition` field (filter gate)
- Capability `bindings` values
- Agent `guardrails` steps
- CEL tool `expression` field
- Agent `exposes` values

### Standard CEL

CEL is a strongly-typed expression language. Common patterns:

```cel
# Boolean guards
context.user.id != ""
output.status_code >= 200 && output.status_code < 300
size(input.message) < 50000

# String operations
context.agent.namespace.startsWith("prod-")
context.user.email.endsWith("@example.com")

# Map/list access
context.input[0].ticket_id
context.capabilities.zendesk_fetch_ticket.outputs[0].status

# Arithmetic
context.llm.tokens.total < 100000

# Ternary
context.user.email != "" ? context.user.email : "unknown"
```

### `now` variable

The `now` variable is a UTC ISO 8601 timestamp string available in all middleware and CEL tool expressions:

```cel
now   # e.g. "2026-05-20T03:45:00Z"
```

## Async Macros

The runtime MUST support the following macros in middleware `assert`, `transform`, and `invoke` steps:

### `review(user: str)`

Pauses execution and requires the specified user to approve or deny the action. The runtime yields the task until the review completes.

```yaml
# Require the task owner to review before a write capability executes
- assert: review(context.user.id)
  match: write_file
  on_fail: block

# Require a specific admin to review high-risk operations
- assert: review("admin@example.com")
  condition: "input.amount > 10000"
  on_fail: lock_task
```

## CEL Context Variables by Scope

| Variable | Middleware `before` | Middleware `after` | Guardrail `before` | Guardrail `after` | CEL tool | Binding |
|---|---|---|---|---|---|---|
| `context` / `c` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `input` / `i` | ✅ | ✅ | ✅ | | ✅ | |
| `output` / `o` | | ✅ | | ✅ | | |
| `now` | ✅ | ✅ | ✅ | ✅ | ✅ | |
| `c.cap` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## Error Message Interpolation

`error_message` fields in middleware steps use `{expression}` interpolation (not raw CEL):

```yaml
- assert: "output.rows > 0"
  error_message: "Query returned no results for filter: {input.filter}"
  on_fail: block
```

Available in `after` steps: `{output}` references the current tool result.
Available in `before` steps: `{output}` is not available.
