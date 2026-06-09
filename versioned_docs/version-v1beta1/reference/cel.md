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
| `{mount.<key>}` | Mount coordinates: `bucket`, `prefix`, `backend`. Only present when agent `mount` is non-`none`. |
| `{auth.<provider>}` | Auth tokens from the configured auth provider |
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

The runtime MUST support the following macros in middleware `assert`, `transform`, and `invoke` steps, and in CEL tool expressions:

### `review(user: str)`

Pauses execution and requires the specified user to approve or deny the action. The task is suspended until the review completes.

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

## Mount I/O Functions (CEL Tool Expressions Only)

When an agent's `mount` scope is non-`none`, the following functions are available in CEL tool `expression` fields. They are **not** available in middleware, bindings, or guardrails. See [Mount](../resources/mount) for the full mount architecture.

### `mount.read(path: string) -> string`

Reads the contents of a file from the agent's scoped mount storage. The path is relative to the agent's resolved `mount.prefix`.

```yaml
execute:
  cel:
    expression: mount.read("_memory/" + input.key)
```

### `mount.write(path: string, content: string) -> string`

Writes content to a file in the agent's scoped mount storage. Returns the written content.

```yaml
execute:
  cel:
    expression: mount.write("_memory/" + input.key, input.value)
```

> **Note:** Paths containing `../` are rejected.

## LLM Capability Script Functions

The LLM capability script is the most restricted CEL environment — it is authored by the LLM at runtime and is **untrusted**. The LLM cannot access `context`, `settings`, `auth`, or any other privileged variables. The only functions available are the agent's declared capabilities and the built-in functions below.

### `<capability_name>(args: map) -> any`

Invokes a capability with the given arguments. The capability name is the function name derived from the agent's capability configuration (see [Task Context — Capability Keys](../capabilities/task-context#capability-keys)).

```cel
github_file_read_chunk({"path": "README.md", "start_line": 1, "end_line": 50})
```

### `file(path: string)`

References a file in the agent's mount storage without exposing its raw contents to the LLM. The MIME type is inferred from the file extension. Available only when the agent's `mount` scope is non-`none`.

The LLM sees a summary description of the file (e.g., `report.pdf (application/pdf, 1.2MB)`) rather than the binary content. The reference can be passed as a capability argument so that tools can operate on the file directly.

```cel
# Pass a file reference to a tool capability
post_attachment({"document": file("reports/summary.pdf")})
```

## CEL Context Variables by Scope

| Variable / Function | Middleware | Guardrail | CEL tool | Binding | LLM script |
|---|---|---|---|---|---|
| `context` / `c` | ✅ | ✅ | ✅ | ✅ | |
| `input` / `i` | ✅ (before+after) | ✅ (before) | ✅ | | |
| `output` / `o` | ✅ (after) | ✅ (after) | | | |
| `now` | ✅ | ✅ | ✅ | | |
| `c.cap` | ✅ | ✅ | ✅ | ✅ | |
| `review()` | ✅ | | ✅ | | |
| `mount.read()` | | | ✅ | | |
| `mount.write()` | | | ✅ | | |
| `file()` | | | | | ✅ |
| `<capability>()` | | | | | ✅ |

## Error Message Interpolation

`error_message` fields in middleware steps use `{expression}` interpolation (not raw CEL):

```yaml
- assert: "output.rows > 0"
  error_message: "Query returned no results for filter: {input.filter}"
  on_fail: block
```

Available in `after` steps: `{output}` references the current tool result.
Available in `before` steps: `{output}` is not available.

