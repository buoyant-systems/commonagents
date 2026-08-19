---
id: task-status
sidebar_position: 6
title: Task Status
description: The externally consumable status of a task — identity, phase, notifications, and the polling contract.
---

# Task Status

When a user gives an agent something to do, the runtime creates a task — a stateful, persistent conversation whose lifecycle is defined in [Task Context](./task-context.md).

The **Task Status** is the task's externally consumable contract: what a compliant runtime reports about a task, read alongside the conversation's [messages](./task-io.md#messages). It is deliberately narrow — an identity, a coarse status, and the outstanding [notifications](#task-notifications) — and it is the **polling surface**: everything a consumer must be told about a task is raised through this object. A runtime is free to track whatever additional task information its implementation needs, but it MUST expose the contract defined here to be compliant with the Common Agent Specification.

## Status Object

```yaml
id: str                     # cryptographically random, unique within the deployment
agent: str                  # the agent processing this task
responsible_user: str
created_at: str             # UTC ISO 8601
status:
    phase: idle | processing | terminal
    terminal_reason: completed | errored | restricted | null
    revision: str           # opaque change cursor
    notifications: list[TaskNotification]
    idle_expires_at: str | null
```

1. `id` MUST be a cryptographically random identifier, unique within the deployment.
2. `agent` MUST be the name of the agent processing this task.
3. `responsible_user` MUST be the **human** user responsible for this task: the human who created it, or — for a task created by an agent — the human responsible for that agent's task. A task has exactly one responsible user.
4. `created_at` MUST be the UTC ISO 8601 timestamp of the task's creation.
5. `status.phase` and `status.terminal_reason` follow the lifecycle defined in [Task Context](./task-context.md): an `idle` task awaits its next input, a `processing` task is busy, and `terminal_reason` MUST be `null` for any non-terminal task. A terminal task MUST NOT be mutated further.
6. `status.revision` MUST be an opaque string that changes whenever the status object or the task's [messages](./task-io.md#messages) change. Consumers compare revisions only for inequality — the value carries no ordering or content semantics.
7. `status.notifications` lists the task's outstanding [notifications](#task-notifications), ordered by `since` ascending. It MUST be empty when nothing requires the responsible user.
8. `status.idle_expires_at` — when the runtime enforces an inactivity lifespan, this MUST be the UTC ISO 8601 time at which the runtime will complete the task if no further activity occurs, and MUST be `null` at terminal. When no inactivity lifespan applies it MUST be `null`.

## Task Notifications

A **Task Notification** is an outstanding call to action for the task's **responsible user**: something only they can do before the task can proceed. Notifications are state, not an event log — a notification appears when raised, is carried on every poll while it is outstanding, and is removed when resolved.

Each notification serializes as:

```yaml
kind: auth_required | review_required
since: str                  # UTC ISO 8601 — when the notification was raised
provider: str               # auth_required only — the provider being connected
```

1. **`auth_required`** — the task is paused until the responsible user grants an authorisation (for example, a delegated sign-in consent). The notification MUST name the `provider` being connected. How the consent is completed is implementation-defined.
2. **`review_required`** — a [`review(user)`](../reference/cel.md#reviewuser-str) middleware step awaits a decision **and the reviewing user is the task's responsible user**. A review addressed to anyone else is NOT a notification: routing it to its reviewer is the runtime's responsibility, and externally it is visible only as `phase: processing`. How the decision is made is implementation-defined.
3. Nothing else is a notification. Any other reason a task is not progressing — internal waits, host-side configuration, capacity — is visible only as `phase: processing`: the task is busy, and how is the host's business.
4. Terminal outcomes and new output are deliberately not notifications: `terminal_reason` already reports the former, and a `revision` change with the [messages](./task-io.md#messages) list already conveys the latter.

## Polling

1. A consumer follows a task by polling its status object. When `revision` changes, refetch the [messages](./task-io.md#messages) and re-render the notifications; nothing else needs to be watched.
2. A runtime MAY additionally push change notifications to consumers. When it does, they carry this same status object — push delivery is an optimisation over polling, never a different contract.

## Interaction

1. **Input.** The responsible user continues the conversation by sending an input: a unified object containing a `message` key (the conversational content as `list[ContentPart]`) and optional parameter keys matching the agent's `parameters` schema. Input is subject to the agent's input guardrails and middleware: it MUST clear them before it reaches the agent, and may be blocked or locked by them. Input MAY be sent at any time before terminal: a runtime MUST accept input received while the task is `processing`, queueing it without interrupting the turn in flight — queued input is processed in a subsequent turn.
2. Input is the **only** mutation this contract defines, and it belongs exclusively to the task's responsible user. Further lifecycle control — interrupting a turn in flight, completing the task — is host-side, governed by the implementation's authorisation model; consumers observe the effects through the status object (`phase`, `terminal_reason`).
