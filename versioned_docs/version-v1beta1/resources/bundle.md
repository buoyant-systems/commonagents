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
templateVariables:
  - name: "owner"
    description: "GitHub organisation or user"
    required: true
  - name: "default_branch"
    description: "Branch to operate on"
    default: "main"
---
kind: "commonagents.info/v1/agent"
name: "coder_agent"
description: "An autonomous software engineering agent."
prompt: |
  You are an expert software engineer...
capabilities:
  github_file: "*"
---
kind: "commonagents.info/v1/tool"
name: "github_file"
description: "Reads and writes files in a GitHub repository."
stateless_http:
  base_url: "https://api.github.com/repos/{template.owner}/project/{template.default_branch}"
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
| `templateVariables` | [`TemplateVariable[]`](#template-variables) | | Parameters the bundle collects from the user and substitutes into its resource documents at import time |

### Template Variables

A bundle may parameterise its resource documents with **template variables**. Each variable is declared in the descriptor's `templateVariables` list and referenced from any resource document with a `{template.<name>}` token. When the bundle is imported, the runtime collects a value for each variable and substitutes it into the documents **before they are stored** — no `{template.<name>}` token survives into the persisted resource.

Template variables are for non-secret configuration only (organisation, repository, region, base URL). Secrets are provided through connections, not template variables.

Each `TemplateVariable` has the following fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | ✅ | The variable identifier, referenced as `{template.<name>}` |
| `description` | string | | Help text shown to the user when collecting a value |
| `default` | string | | Value used when the user provides none |
| `required` | bool | | When `true`, the import fails unless a value is provided or a `default` is set |

Substitution rules:

- The token grammar is `{template.<name>}`. It shares the single-brace form of [CEL template interpolation](../reference/cel.md), but a `{template.*}` token is resolved entirely at **import time** — it is never a runtime interpolation root.
- Substitution applies to every resource document; the descriptor document itself is never substituted.
- A `{template.<name>}` token whose name is not declared in `templateVariables` fails the import.
- A `required` variable with neither a provided value nor a `default` fails the import.

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
5. When `templateVariables` is present, the runtime collects a value for each variable before the import completes and substitutes them into the resource documents.
6. A `{template.<name>}` reference to a variable not declared in `templateVariables` fails the import.

## Size Limits

Runtimes SHOULD enforce reasonable limits to prevent abuse. The following are recommended defaults:

| Limit | Recommended value |
|---|---|
| Max bundle size (remote fetch) | 10 MB |
| Max bundle size (direct upload) | 2 MB |
| Max documents per bundle | 200 |
| Max single document size | 512 KB |
