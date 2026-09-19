---
id: bindings
sidebar_position: 2
title: Bindings
description: CEL binding expressions that deterministically inject capability parameters, bypassing LLM generation.
---

# Bindings

Bindings are CEL expressions declared on an agent's capability configuration that deterministically inject parameter values into capability calls, **bypassing LLM generation** for those parameters.

They enforce that sensitive or security-critical values (user IDs, account numbers, repository paths) always come from trusted task context rather than model output.

## Syntax

Bindings are declared in the `bindings` map of a [Capability](../resources/agent.md#capabilities) object on an agent:

```yaml
capabilities:
  github_file:
    bindings:
      owner: "context.input[0].owner"       # from agent parameters
      token: "context.user.id"              # from authenticated user
  zendesk:
    bindings:
      ticket_id: "{context.input[0].ticket_id}"
      customer_email: "{context.user.email}"
      labels: "{context.input[0].labels}"
      branch: "agent/{context.agent.name}/{now}"
```

Each key MUST correspond to an explicitly declared `parameters` field in the tool schema. A value is a template: each `{...}` token is a CEL expression evaluated against the [task context](task-context.md), and text outside a token is literal.

A binding carries the **type** its expression produced. A value that is exactly one `{expression}` delivers that result with its type intact — for example `labels` above is a list. A value carrying literal text around the token, or more than one token, is composition and produces a string, as `branch` above does. An implementation MUST NOT render a non-string result back into text.

## Evaluation

Bindings are evaluated **synchronously before** the capability is delegated to the LLM. The evaluated values are merged with any LLM-provided parameters, with bindings taking precedence.

When `require_binding` names a parameter in the tool schema, the binding is the only permitted value source. When a parameter has a binding, any attempt by the LLM to override it is ignored.

## `require_binding`

Tools can declare that a parameter must always come from an agent binding. `require_binding` is a list of names on the parameters object, beside `required`:

```yaml
# In the tool manifest
parameters:
  type: object
  properties:
    user_id:
      type: string
      description: "The authenticated user's ID."
  required: ["user_id"]
  require_binding: ["user_id"]   # Agent MUST bind it; invalid config otherwise
```

`require_binding` is a **tool-side validation constraint**. It is enforced at agent save time — any agent that references this tool without providing a binding for a named parameter is rejected by the API server.

Note: it is the **binding** (not this list) that hides the parameter from the LLM and seals its action allow list entry. A binding can exist for a parameter `require_binding` does not name — it will still be hidden and sealed. A named parameter with no binding is an invalid configuration that the runtime MUST error on.

## How Bindings Scope Events

All tool parameters (root, per-action, per-event) share a single **action allow list** namespace keyed by parameter name. `receive.filter` expressions reference `parameters.*` from this allow list to scope event routing.

Agent bindings contribute to the allow list directly. A binding on `owner` adds the bound value to the allow list for `owner`, making it available for any event filter that references `parameters.owner`. The allow list matches on text, a binding with a non-text type is rendered to a string first.

```yaml
# Tool manifest (excerpt)
parameters:
  type: object
  properties:
    owner: { type: string }
    repo:  { type: string }
  required: ["owner", "repo"]
  require_binding: ["owner", "repo"]

events:
  - name: comment
    receive:
      webhook:
        filter: >
          event.payload.repository.owner.login == parameters.owner
          && event.payload.repository.name == parameters.repo

# Agent manifest
capabilities:
  github_pr:
    bindings:
      owner: "buoyant-systems"   # binding hides 'owner' from LLM and seals its allow list
      repo:  "agent-mesh"        # binding hides 'repo' from LLM and seals its allow list
```

The binding is what seals the allow list — the set is fixed and cannot grow from LLM action calls. Events are scoped to exactly the bound value from task start.

A binding can exist for a parameter `require_binding` does not name, and the parameter will still be hidden from the LLM and its allow list entry will still be sealed. `require_binding` only enforces at validation time that the binding is not accidentally omitted.

Parameters named in `require_binding` are particularly well-suited for event filters: they guarantee that the agent configuration is always valid (binding present), and the binding itself ensures the value is reliably agent-controlled and the event scope cannot drift as the task progresses.

```yaml
# Tool manifest (excerpt)
parameters:
  type: object
  properties:
    owner: { type: string }
    repo:  { type: string }
  required: ["owner", "repo"]
  require_binding: ["owner", "repo"]

events:
  - name: comment
    receive:
      webhook:
        filter: >
          event.payload.repository.owner.login == parameters.owner
          && event.payload.repository.name == parameters.repo

# Agent manifest
capabilities:
  github_pr:
    bindings:
      owner: "buoyant-systems"   # scopes actions AND events to this org
      repo:  "agent-mesh"        # scopes actions AND events to this repo
```

The agent only receives `comment` events from `buoyant-systems/agent-mesh` — automatically, from the binding.

## CEL Context for Bindings

Bindings have access to the full [task context](task-context.md):

```yaml
bindings:
  # From structured agent input parameters
  project_id: "context.input[0].project_id"

  # From the authenticated user
  user_id: "context.user.id"
  user_email: "context.user.email"

  # From a previous capability result
  branch_name: "context.capabilities.git_create_branch.outputs[0].name"

  # From agent metadata
  agent_name: "context.agent.name"

  # Static literal values
  environment: "'production'"
  max_results: "50"
```

## Bindings and Middleware

Bindings apply only to the LLM's calls. A capability called from [middleware](middleware.md#calling-capabilities) receives exactly the arguments the expression passes.

## Example: Pinning a Sensitive Parameter

```yaml
# Agent manifest
capabilities:
  stripe_refund:
    bindings:
      # The customer_id is always sourced from the validated ticket context,
      # never from LLM output — preventing prompt injection attacks.
      customer_id: "context.capabilities.zendesk_fetch_ticket.outputs[0].customer_id"
    before:
      - assert: "context.capabilities.zendesk_fetch_ticket.count_successful > 0"
        deny_message: "Ticket must be fetched before issuing a refund."
```
