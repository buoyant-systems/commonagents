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

Bindings are declared in the `bindings` map of a [Capability](../resources/agent#capabilities) object on an agent:

```yaml
capabilities:
  github-file:
    bindings:
      owner: "context.input[0].owner"       # from agent parameters
      token: "context.user.id"              # from authenticated user
  zendesk:
    bindings:
      ticket_id: "context.input[0].ticket_id"
      customer_email: "context.user.email"
```

Each key MUST correspond to an explicitly declared `parameters` field in the tool schema. Values MUST be valid CEL expressions evaluated against the [task context](task-context).

## Evaluation

Bindings are evaluated **synchronously before** the capability is delegated to the LLM. The evaluated values are merged with any LLM-provided parameters, with bindings taking precedence.

When a parameter has `require_binding: true` in the tool schema, the binding is the only permitted value source. When a parameter has a binding, the runtime MUST reject any attempt by the LLM to override it.

## `require_binding: true`

Tools can declare that a parameter must always come from an agent binding:

```yaml
# In the tool manifest
parameters:
  properties:
    user_id:
      type: string
      description: "The authenticated user's ID."
      require_binding: true   # Agent MUST provide a binding; invalid config otherwise
```

`require_binding: true` is a **tool-side validation constraint**. It is enforced at agent save time — any agent that references this tool without providing a binding for the parameter is rejected by the API server.

Note: it is the **binding** (not this flag) that hides the parameter from the LLM and seals its action allow list entry. A binding can exist without `require_binding: true` — the parameter will still be hidden and sealed. `require_binding: true` without a binding is an invalid configuration that the runtime MUST error on.

## How Bindings Scope Events

All tool parameters (root, per-action, per-event) share a single **action allow list** namespace keyed by parameter name. `receive.filter` expressions reference `parameters.*` from this allow list to scope event routing.

Agent bindings contribute to the allow list directly. A binding on `owner` adds the bound value to the allow list for `owner`, making it available for any event filter that references `parameters.owner`.

```yaml
# Tool manifest (excerpt)
parameters:
  properties:
    owner: { type: string, require_binding: true }
    repo:  { type: string, require_binding: true }

events:
  - name: comment
    receive:
      webhook:
        filter: >
          event.payload.repository.owner.login == parameters.owner
          && event.payload.repository.name == parameters.repo

# Agent manifest
capabilities:
  github-pr:
    bindings:
      owner: "buoyant-systems"   # binding hides 'owner' from LLM and seals its allow list
      repo:  "agent-mesh"        # binding hides 'repo' from LLM and seals its allow list
```

The binding is what seals the allow list — the set is fixed and cannot grow from LLM action calls. Events are scoped to exactly the bound value from task start.

A binding can exist without `require_binding: true` and the parameter will still be hidden from the LLM and its allow list entry will still be sealed. `require_binding: true` only enforces at validation time that the binding is not accidentally omitted.

Parameters with `require_binding: true` are particularly well-suited for event filters: they guarantee that the agent configuration is always valid (binding present), and the binding itself ensures the value is reliably agent-controlled and the event scope cannot drift as the task progresses.

```yaml
# Tool manifest (excerpt)
parameters:
  properties:
    owner: { type: string, require_binding: true }
    repo:  { type: string, require_binding: true }

events:
  - name: comment
    receive:
      webhook:
        filter: >
          event.payload.repository.owner.login == parameters.owner
          && event.payload.repository.name == parameters.repo

# Agent manifest
capabilities:
  github-pr:
    bindings:
      owner: "buoyant-systems"   # scopes actions AND events to this org
      repo:  "agent-mesh"        # scopes actions AND events to this repo
```

The agent only receives `comment` events from `buoyant-systems/agent-mesh` — automatically, from the binding.

## CEL Context for Bindings

Bindings have access to the full [task context](task-context):

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

## Middleware Bindings

Middleware `invoke` steps also support bindings, using the same CEL syntax. These are scoped to the middleware step and take precedence over capability-level bindings:

```yaml
capabilities:
  github-file:
    before:
      - invoke: "audit-log:record_event"
        bindings:
          event_type: "'file_access'"
          resource_path: "input.path"
          user_id: "context.user.id"
```

See [Middleware](middleware) for full middleware documentation.

## Example: Pinning a Sensitive Parameter

```yaml
# Agent manifest
capabilities:
  stripe-refund:
    bindings:
      # The customer_id is always sourced from the validated ticket context,
      # never from LLM output — preventing prompt injection attacks.
      customer_id: "context.capabilities.zendesk_fetch_ticket.outputs[0].customer_id"
    before:
      - assert: "context.capabilities.zendesk_fetch_ticket.count_successful > 0"
        error_message: "Ticket must be fetched before issuing a refund."
```
