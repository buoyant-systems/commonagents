---
id: mount
sidebar_position: 7
title: Mount
description: Workspace-level cloud storage configuration for agents in the Common Agent Specification.
---

# Mount

A mount defines workspace-level cloud storage configuration. It is **not** a tool runtime — it is shared infrastructure that multiple parts of the system use to read and write persistent data.

When an agent has a non-`none` mount scope, the following features become available:

- **Template variables** — `{mount.bucket}`, `{mount.prefix}`, `{mount.backend}` are available for `{expression}` interpolation in **all** tool runtime execute blocks (HTTP URLs, headers, bodies, MCP config, etc.) and agent bindings.
- **CEL I/O functions** — `mount.read()` and `mount.write()` are available in CEL tool expressions.
- **LLM file references** — the `file()` function becomes available in the LLM capability script environment, allowing the LLM to reference files in mount storage without exposing their raw contents.
- **Multimedia output** — when `model_capabilities` includes `image-generation`, `audio-generation`, or `video-generation`, the runtime writes LLM-generated media to mount storage. Agents with these model capabilities **require** a non-`none` mount.

## Schema

```yaml
name: str

path_prefixes:
  workspace: str       # e.g. "/{namespace}/"
  agent: str           # e.g. "/{namespace}/{agent}/"
  task: str            # e.g. "/{namespace}/{agent}/{task}/"

# Exactly ONE backend must be specified:
gcs:
  bucket: str
  sa: str | None       # Service account for workload identity

s3:                     # STUB — not implemented in this release
  bucket: str
  profile: str | None
  region: str | None
```

## Fields

1. **`name`** — Identifies this mount within the workspace.
2. **`path_prefixes`** — Templates for each scope level. The runtime substitutes `{namespace}`, `{agent}`, and `{task}` tokens during resolution. The resolved prefix is exposed as `mount.prefix` based on the agent's `mount` scope.
3. **Backend** — Exactly one backend block must be specified.

## Scope Resolution

The agent's `mount` field (`none`, `task`, `agent`, `workspace`) determines which `path_prefixes` template is used to compute `mount.prefix`:

| Agent `mount` value | `mount.prefix` source | Example result |
|--------------------|-----------------------|----------------|
| `none` | N/A — mount features not available | — |
| `task` | `path_prefixes.task` | `/myworkspace/coder/abc123/` |
| `agent` | `path_prefixes.agent` | `/myworkspace/coder/` |
| `workspace` | `path_prefixes.workspace` | `/myworkspace/` |

## Template Variables

When the agent's `mount` scope is non-`none`, the following variables are available in `{expression}` interpolation in **all** tool execute blocks (URLs, headers, bodies) and in agent/middleware bindings:

| Variable | Type | Description |
|----------|------|-------------|
| `mount.bucket` | `string` | The resolved bucket name from the workspace mount |
| `mount.prefix` | `string` | The scoped prefix (evaluated from agent's `mount` field + mount `path_prefixes`) |
| `mount.backend` | `string` | Backend type: `"gcs"` or `"s3"` |

These variables allow **any** tool runtime (HTTP, stateful session, MCP, etc.) to connect to the agent's storage. For example, an HTTP tool can target a cloud storage API using `{mount.bucket}` and `{mount.prefix}` in its URL.

## CEL I/O Functions

When the agent's `mount` scope is non-`none`, the following functions are available in [CEL tool expressions](../reference/cel):

| Function | Description |
|----------|-------------|
| `mount.read(path)` | Reads the contents of a file relative to `mount.prefix` |
| `mount.write(path, content)` | Writes content to a file relative to `mount.prefix`. Returns the written content. |

These functions are **only** available in CEL tool `expression` fields — not in middleware, bindings, or guardrails. Paths containing `../` are rejected.

## LLM File References

When mount is configured, the `file(path)` function becomes available in the LLM capability script environment. This allows the LLM to reference a file in mount storage without its raw contents being inlined into the conversation.

```cel
# LLM-authored capability script — pass a file to a tool
post_attachment({"file": file("reports/summary.pdf")})
```

The LLM sees a summary description of the file (e.g., `report.pdf (application/pdf, 1.2MB)`) rather than the binary content. The reference can be passed as a capability argument so that tools can operate on the file directly. See [CEL Reference](../reference/cel#llm-capability-script-functions).

## Multimedia Output

Model capabilities that produce binary output (`image-generation`, `audio-generation`, `video-generation`) write their generated media to mount storage automatically. The runtime:

1. Writes the media to the agent's scoped mount prefix.
2. Returns a storage URI and content metadata to the task as a content part.

Agents with multimedia model capabilities **must** have a non-`none` mount scope.

## Examples

### Workspace mount configuration

```yaml
name: default
path_prefixes:
  workspace: "/{namespace}/"
  agent: "/{namespace}/{agent}/"
  task: "/{namespace}/{agent}/{task}/"
gcs:
  bucket: my-company-agents
  sa: agentmesh@my-project.iam.gserviceaccount.com
```

### Agent using mount with bindings

```yaml
kind: commonagents.info/v1beta2/agent
namespace: engineering
name: coder
mount: task  # mount.prefix = /engineering/coder/{task}/

capabilities:
  code-search:
    bindings:
      bucket: "{mount.bucket}"
      prefix: "{mount.prefix}"
```

In this example, `code-search` receives `bucket: "my-company-agents"` and `prefix: "/engineering/coder/abc123/"` as deterministic bindings. The code-search tool can use these in any runtime — HTTP, MCP, etc.

### Memory tool using CEL mount functions

```yaml
kind: commonagents.info/v1beta2/tool
namespace: default
name: memory
description: Key-value memory for agents, persisted to mount storage.

actions:
  - name: write
    description: Save a key-value pair to persistent memory.
    parameters:
      type: object
      properties:
        key:
          type: string
        value:
          type: string
    execute:
      cel:
        expression: >
          mount.write("_memory/" + input.key, input.value)

  - name: read
    description: Read a value from persistent memory by key.
    parameters:
      type: object
      properties:
        key:
          type: string
    execute:
      cel:
        expression: >
          mount.read("_memory/" + input.key)
```
