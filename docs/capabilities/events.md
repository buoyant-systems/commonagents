---
id: events
sidebar_position: 4
title: Events
description: How agents subscribe to inbound tool events and how the action allow list scopes event delivery.
---

# Events

Events are inbound signals from external platforms that inject input into a running task. They are the inbound counterpart to actions: where actions are outbound calls the LLM initiates, events are things that happen in the world that the agent needs to respond to.

When a tool declares events, an agent subscribes to them automatically just by listing the tool as a capability. The same capability declaration that exposes the tool's actions also subscribes to its events — no additional configuration is required.

## How Events Are Subscribed

When an agent's `capabilities` block references a tool, the agent is automatically subscribed to all events declared in that tool's `events` list. The tool's `message` template provides the default input, and the tool's `receive.filter` expression scopes which events are routed.

```yaml
# Minimal: subscribe to all github-pr actions AND events
capabilities:
  github-pr:
    bindings:
      owner: "buoyant-systems"
      repo:  "agent-mesh"
```

That's the complete declaration. The agent receives `comment`, `review`, and `pr_merged` events for `buoyant-systems/agent-mesh` automatically — once the scoping conditions are met.

## The Action Allow List

Event routing is controlled by the **action allow list** — a per-tool, per-task structure maintained by the runtime. It is a flat namespace keyed by **parameter name**, shared across root parameters, per-action parameters, and per-event parameters.

### How It Works

1. When the LLM calls any action on a tool, **all resolved parameter values** (root and per-action) are added to the allow list set for their respective parameter names. A name accumulates multiple values if the LLM calls actions with different values.

2. When an event arrives, `receive.filter` expressions that reference `parameters.*` are evaluated against the allow list. For `parameters.X`, the filter passes if the payload value is **a member of the allow list set** for `X`.

3. If a parameter's allow list is empty (no action has been called with that name yet), the event is **discarded**.

### Syncing Per-Action and Per-Event Parameters

If a per-action parameter and a per-event parameter share the same name, they are the same allow list entry. This is how the tool author links specific action inputs to specific event filters — through naming.

```yaml
# Tool manifest (excerpt)
actions:
  - name: create_pr
    parameters:
      properties:
        author:             # LLM provides this when calling create_pr
          type: string

events:
  - name: pr_merged
    parameters:
      properties:
        author:             # same name → shares the allow list entry for 'author'
          type: string
    receive:
      webhook:
        filter: "... && event.payload.pull_request.user.login == parameters.author"
```

When the LLM calls `create_pr` with `author: "alice"`, the allow list for `author` becomes `{"alice"}`. The `pr_merged` event is then only routed for PRs by Alice. If the LLM later creates a PR for Bob, the set becomes `{"alice", "bob"}` and events for either are routed.

## Bindings: Sealing the Allow List

When a parameter has an agent binding, the allow list for that parameter name is **sealed** at task start to the resolved binding value:

- The set is **sealed** — the runtime MUST NOT append to it from LLM action calls.
- The LLM cannot supply a value for this parameter (it is hidden from the LLM by the binding).
- Events referencing this parameter in `receive.filter` are routable immediately, scoped to exactly the bound value.

```yaml
# Agent binds owner + repo → allow lists sealed; events routable from task start
capabilities:
  github-pr:
    bindings:
      owner: "buoyant-systems"   # binding → sealed to this value
      repo:  "agent-mesh"        # binding → sealed to this value
```

`require_binding: true` on a parameter is a **tool-side validation constraint** that ensures the agent MUST configure a binding. It does not itself seal the allow list or hide the parameter — that is what the binding does. If a parameter has `require_binding: true` but no binding, the configuration is invalid and the runtime errors.

## Using `include` to Filter Events

The `include` list on a capability filters both actions and events by name. Any name not in the list is excluded:

```yaml
capabilities:
  github-pr:
    bindings:
      owner: "buoyant-systems"
      repo:  "agent-mesh"
    include: [create_pr, comment, review]   # pr_merged event excluded
```

If `include` is absent, all actions and all events from the tool are active.

## Events in `before` Middleware

The agent capability's `before` middleware applies to all activations of the capability — both action invocations and incoming events. When an event arrives, the CEL scope gains an `event` variable with the raw payload. When an action is invoked, `event` is not in scope.

Use `has(event)` to write assertions that only apply to events:

```yaml
capabilities:
  github-pr:
    bindings:
      owner: "buoyant-systems"
      repo:  "agent-mesh"
    before:
      - assert: "context.capabilities['github_pr'].count_successful < 10"   # applies to actions only
      - assert: "!has(event) || event.payload.comment.user.login != 'dependabot[bot]'"   # applies to events
```

The pattern `!has(event) || <condition>` evaluates as:
- During an action invocation: `true` (short-circuits — action is unaffected)
- During an event activation: evaluates `<condition>` against the event payload

## Reshaping Event Input

Use `after` middleware with `has(event)` to transform the input only for event-originated turns:

```yaml
capabilities:
  github-pr:
    after:
      - transform: "has(event) ? '[ACTION REQUIRED] ' + input.message : input"
```

## Event Activation vs Task Creation

Events can activate an agent in two ways:

| Mode | Resource | Effect |
|---|---|---|
| **Warm resume** | Tool event + agent capability | Injects input into an existing, idle task |
| **Cold start** | [`Trigger`](../resources/trigger) manifest | Creates a new task for the agent |

Tool event subscriptions resume **existing tasks**. Triggers act on raw event payloads and bypass the action allow list — they are for creating new tasks from external signals.

## Subscription Lifecycle

Event subscriptions have a defined lifecycle that controls when a task starts and stops receiving events.

### When Subscriptions Are Active

A subscription is created when a task starts and the agent's capabilities include a tool with events. It is removed when any of the following occurs:

- The task reaches a terminal state (error).
- The task is deleted.
- The task is interrupted.
- The subscription's timeout expires.

When a task is interrupted, its subscriptions are removed immediately. However, the subscriptions are **automatically restored** when the task completes its next FSM step (e.g. when it receives new user input and begins processing). This prevents events from piling up during an interrupt, while allowing the task to resume event-driven behaviour naturally once it becomes active again.

### Timeouts

Each event may declare a `timeout` (default subscription duration) and a `max_timeout` (hard cap). The agent may override the default via the capability's `event_timeout` field.

The effective timeout is computed as:

```
effective = clamp(
    agent.capabilities[tool].event_timeout  ??  tool.events[name].timeout  ??  ∞,
    max = tool.events[name].max_timeout  ??  ∞
)
```

When the effective timeout is finite, the runtime tracks a `last_activity_at` timestamp per subscription. Activity is defined as **any FSM step** — any state transition within the task worker (input ingestion, LLM generation, capability execution, middleware evaluation, etc.). The timeout clock resets on each step. When `now - last_activity_at > effective_timeout`, the subscription is removed — but the task is not deleted or errored.

A runtime implementation MAY also enforce its own maximum timeout independent of the tool and agent declarations.

```yaml
# Tool declares defaults and caps
events:
  - name: comment
    timeout: "72h"         # default: 3 days
    max_timeout: "168h"    # cap: 7 days
    ...

# Agent overrides
capabilities:
  github-pr:
    event_timeout: "48h"         # effective: 48h (within cap)
```

### Webhook Signature Verification

The `webhook` receive type supports an optional `secret` field for HMAC signature verification:

```yaml
receive:
  webhook:
    secret: "{settings.github_webhook_secret}"
    filter: "event.payload.action == 'created'"
```

When `secret` is present, the runtime validates the inbound webhook's `X-Hub-Signature-256` header against the resolved HMAC secret before evaluating the filter. The secret is resolved via the standard `{settings.*}` interpolation — the same mechanism used for API keys and auth tokens. If absent, no signature verification is performed.

Because different tools may use different secrets, verification happens during event routing at the per-tool level, not at the API ingestion endpoint.

## Full Example: Autonomous Code Review Agent

```yaml
kind: "commonagents.info/v1beta2/agent"
namespace: "engineering"
name: "coder-agent"
description: "An autonomous software engineer that responds to PR feedback."
prompt: |
  You are a software engineer. Open PRs, push code, and address
  review feedback by pushing new commits.

capabilities:
  github-file:
    bindings:
      owner: "buoyant-systems"
      repo:  "agent-mesh"

  github-pr:
    bindings:
      owner: "buoyant-systems"
      repo:  "agent-mesh"
    event_timeout: "48h"
    include: [create_pr, comment, review]
    before:
      - assert: "!has(event) || event.payload.comment.user.login != 'agentmesh-bot'"

guardrails:
  before:
    - assert: "size(context.input) > 0"
      error_message: "Input cannot be empty."
```

When this agent calls `create_pr`, the resolved `owner` and `repo` values (fixed by binding) are in the allow list from task start. `comment` and `review` events for `buoyant-systems/agent-mesh` arrive immediately. The `pr_merged` event is excluded by `include`. After 48 hours of task inactivity, event subscriptions expire.

