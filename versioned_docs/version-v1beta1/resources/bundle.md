---
id: bundle
sidebar_position: 4
title: Bundle
description: The Bundle format for distributing and importing Common Agent resources.
---

# Bundle

A bundle is a portable, self-describing collection of Common Agent resources encoded as a **multi-document YAML file**. Bundles are the standard format for distributing and importing agents, tools, and schedules.

Documents within a bundle are separated by `---`.

## Format

The optional first document is a **Bundle Descriptor** with `kind: commonagents.info/v1/bundledescription`. All subsequent documents are resource manifests.

```yaml
kind: "commonagents.info/v1/bundledescription"
name: "My Agent Bundle"
description: |
  # My Agent Bundle
  A collection of agents and tools for common workflows.
author: "Acme Corp"
version: "1.0.0"
url: "https://github.com/acme/agents"
requiredSettings:
  - "github.token"
  - "github.owner"
---
kind: "commonagents.info/v1/agent"
namespace: "engineering"
name: "coder-agent"
description: "An autonomous software engineering agent."
prompt: |
  You are an expert software engineer...
capabilities:
  github-file: "*"
---
kind: "commonagents.info/v1/tool"
namespace: "engineering"
name: "github-file"
description: "Reads and writes files in a GitHub repository."
settings:
  properties:
    github.owner:
      title: "GitHub Owner"
    github.token:
      title: "GitHub Token"
      format: "password"
```

## Bundle Descriptor

If a descriptor document is present, the runtime treats it as bundle metadata and requires it to be the first document.

| Field | Type | Required | Description |
|---|---|---|---|
| `kind` | string | ✅ | Identifies this document as a bundle descriptor. A value other than `"commonagents.info/v1/bundledescription"` is not defined by this specification |
| `name` | string | ✅ | Display name of the bundle |
| `description` | string | | Markdown description of the bundle |
| `author` | string | | Who created or maintains the bundle |
| `version` | string | | Semver version string |
| `url` | string | | Link to the bundle homepage or repository |
| `requiredSettings` | `[]string` | | When present, identifies tool settings keys the runtime collects from the user before completing the import |

### Required Settings

Each entry in `requiredSettings` is a string matching a tool settings key (e.g. `"github.token"`). The runtime cross-references these against the `settings` JSON schemas declared in the bundle's tools to derive prompt metadata:

- **Label** — from the JSON Schema `title` field
- **Description** — from the JSON Schema `description` field
- **Default** — from the JSON Schema `default` field
- **Format** — from the JSON Schema `format` field (e.g. `"password"` to mask the input)

The runtime collects values for all declared required settings before completing the import. Keys in `requiredSettings` that do not appear in any tool's `settings` schema are silently dropped.

## Resource Documents

For each document after the descriptor, the runtime attempts to load it as a resource manifest using its `kind` field. Documents with unrecognised `kind` values are silently skipped.

| Kind | Description |
|---|---|
| `commonagents.info/v1/agent` | Agent definition |
| `commonagents.info/v1/tool` | Tool definition |
| `commonagents.info/v1/schedule` | Schedule definition |

## Rules

1. A bundle may contain zero or one descriptor document.
2. When present, the descriptor is the first document.
3. The descriptor `name` field is required; all other fields are optional.
4. Bundles without a descriptor are valid — they are a plain collection of resources.
5. When `requiredSettings` is present, the runtime collects all declared values before the import completes.
6. Keys in `requiredSettings` that match no tool `settings` schema are silently dropped.

## Size Limits

Runtimes SHOULD enforce reasonable limits to prevent abuse. The following are recommended defaults:

| Limit | Recommended value |
|---|---|
| Max bundle size (remote fetch) | 10 MB |
| Max bundle size (direct upload) | 2 MB |
| Max documents per bundle | 200 |
| Max single document size | 512 KB |
