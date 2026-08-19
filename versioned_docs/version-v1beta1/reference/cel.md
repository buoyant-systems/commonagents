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
url: "{connection('github').base_url}/repos/{parameters.owner}/{parameters.repo}"
headers:
  Authorization: "Bearer {connection('github').service_auth().token}"
body:
  message: "Task completed by {context.agent.name}"
```

Interpolation roots available in tool specs:

| Root | Description |
|---|---|
| `{parameters.<key>}` | LLM-provided or binding-provided parameters |
| `{connection('<provider>').<key>}` | A non-secret field of a named provider connection. See [Connections](parameters.md#connections). |
| `{connection('<provider>').user_auth(scopes?).token}` | A credential for the user responsible for the task — the tool acts as them. The runtime injects the identity; the author never passes one. |
| `{connection('<provider>').service_auth(selector?).token}` | A credential for the deployment's own machine identity, optionally selecting one target resource. Both accessors also expose the connection's named public and secret fields. |
| `{session.<key>}` | Session state (stateful_session runtimes only) |
| `{mount.<key>}` | Implementation-defined mount values. This specification defines none; see [Mount](../resources/mount.md). Present only when the agent's `mount` list is non-empty. |
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
context.agent.name.startsWith("prod_")
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

When an agent's `mount` list is non-empty, the following functions are available in CEL tool `expression` fields. They are **not** available in middleware, bindings, or guardrails. See [Mount](../resources/mount.md) for the full mount architecture.

Every reference these functions take or return is a URI whose scheme is the file's root — `"workspace://report.pdf"`, `"agent://skill.md"`, `"task://output.png"`. Because `//` opens a line comment in CEL, a reference MUST be written as a quoted string literal.

### `mount.read(ref: string) -> handle`

Stats a file in the agent's mount and returns a lazy handle (`{file, mime_type, size_bytes, hash}`). Content is never fetched into the expression; a handle in the action's result becomes a context attachment.

```yaml
execute:
  cel:
    expression: mount.read("agent://_memory/" + input.key)
```

### `mount.write(ref: string, content: string | handle) -> handle`

Writes a file and returns its handle. `content` is a string, or a handle for a server-side copy. The two references MAY name different roots, which is how a file moves between mount scopes.

```yaml
execute:
  cel:
    expression: mount.write("agent://_memory/" + input.key, input.value)
```

### `mount.list() -> list[string]`

Lists the agent's files as sorted reference URIs, across every enabled root.

> **Note:** A reference with no scheme, or naming a root the agent did not enable, is an error naming the roots that are available. A remainder containing `../` is rejected.

## LLM Capability Script Functions

The LLM capability script is the most restricted CEL environment — it is authored by the LLM at runtime and is **untrusted**. The LLM cannot access `context`, `connection()`, `mount.*` or any other privileged variable or function. The only functions available are the agent's declared capabilities and the built-in functions below.

### `<capability_name>(args: map) -> any`

Invokes a capability with the given arguments. The capability name is the function name derived from the agent's capability configuration (see [Task Context — Capability Keys](../capabilities/task-context.md#capability-keys)).

```cel
github_file_read_chunk({"path": "README.md", "start_line": 1, "end_line": 50})
```

### File references

A file is referenced by its URI, as an ordinary quoted string. There is no function to call: the reference resolves at a capability parameter declared `type: file`, and nowhere else — the schema, never the value shape, decides what is a file.

The LLM sees a summary description of the file (e.g. `report.pdf (application/pdf, 1.2MB)`) rather than the binary content, so passing one to a capability lets a tool operate on the file without its bytes entering the conversation.

```cel
# Pass a file reference to a tool capability
post_attachment({"document": "workspace://reports/summary.pdf"})
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
| `mount.list()` | | | ✅ | | |
| `<capability>()` | | | | | ✅ |

`connection()` is absent from every column: it belongs to tool execution templates alone, and is not available in any of these environments.

## Error Message Interpolation

`error_message` fields in middleware steps use `{expression}` interpolation (not raw CEL):

```yaml
- assert: "output.rows > 0"
  error_message: "Query returned no results for filter: {input.filter}"
  on_fail: block
```

Available in `after` steps: `{output}` references the current tool result.
Available in `before` steps: `{output}` is not available.

