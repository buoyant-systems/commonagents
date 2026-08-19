---
id: schedule
sidebar_position: 5
title: Schedule
description: The Schedule manifest for triggering agents on a recurring cron cadence.
---

# Schedule

A Schedule is a persistent resource that automatically creates tasks for an agent on a recurring cadence.

```yaml
kind: "commonagents.info/v1/schedule"
name: str

agent: str
cron: str
timezone: str | None

owner: str
inputs: object | None

enabled: bool
```

## Fields

1. **`kind`** — Identifies this manifest as a Schedule. A manifest with a different `kind` value is not defined by this specification.
2. **`name`** — Identifies the schedule. A name identifies one resource (see [Concepts](../concepts.md#references-and-versions)).
3. **`agent`** — Identifies the agent that tasks are created for.
4. **`cron`** — Defines the trigger cadence as a standard 5-field cron expression (minute hour day-of-month month day-of-week). Extended 6-field (seconds) expressions are not defined by this specification.
5. **`timezone`** — When present, the cron expression is evaluated in this IANA timezone. When absent, UTC applies.
6. **`owner`** — Identifies the user associated with all tasks created by this schedule, used for identity and access control purposes.
7. **`inputs`** — When present, passed as the unified input for each scheduled task. The well-known `message` key (type `list[ContentPart]`) provides the conversational input. Additional keys satisfy the agent's `parameters` schema. Required agent parameters must be present. `message` MUST be present either in `inputs` or via a `default` in the agent's `parameters` schema; if neither exists, the schedule MUST be rejected.
8. **`enabled`** — When `true`, the schedule is active and the runtime evaluates it. When `false`, the schedule is inactive.

## Status

The runtime maintains the following read-only status field on the schedule, not set by the caller:

```yaml
status:
  next_trigger_at: str | None      # UTC ISO 8601
```

Status describes what is true of the schedule now. `next_trigger_at` is derived from `cron`, `timezone` and `enabled`, so a schedule whose next run disagrees with its cadence cannot exist.

What a schedule has *done* — when it last fired, which task that produced, why an attempt failed — is deliberately not here. Those accumulate without the schedule changing, so a status carrying them would be a field whose value moves when nothing about the resource has. How an implementation records execution history, and whether it exposes one at all, is outside this specification.

## Overlapping Execution

Schedules are time-driven, not completion-driven. A new task is created at each cron tick regardless of whether a previously-triggered task is still running.

## Example

```yaml
kind: "commonagents.info/v1/schedule"
name: "daily_standup_summary"
agent: "standup-agent"
cron: "0 9 * * 1-5"
timezone: "Australia/Sydney"
owner: "user:alice@example.com"
inputs:
  message:
    - mimeType: text/plain
      text: "Generate today's standup summary from the ticket backlog."
enabled: true
```
