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
namespace: str
name: str

agent: str
cron: str
timezone: str | None

owner: str
message: str | None
inputs: object | None

enabled: bool
```

## Fields

1. **`kind`** — Identifies this manifest as a Schedule. A manifest with a different `kind` value is not defined by this specification.
2. **`namespace`** — Identifies the namespace this schedule belongs to.
3. **`name`** — Identifies the schedule uniquely within its namespace.
4. **`agent`** — Identifies the agent that tasks are created for. The referenced agent exists in the same namespace.
5. **`cron`** — Defines the trigger cadence as a standard 5-field cron expression (minute hour day-of-month month day-of-week). Extended 6-field (seconds) expressions are not defined by this specification.
6. **`timezone`** — When present, the cron expression is evaluated in this IANA timezone. When absent, UTC applies.
7. **`owner`** — Identifies the user associated with all tasks created by this schedule, used for identity and access control purposes.
8. **`message`** — When present, used as the input message for each scheduled task.
9. **`inputs`** — When present, passed as structured input satisfying the agent's `parameters` schema. Required agent parameters must be present.
10. **`enabled`** — When `true`, the schedule is active and the runtime evaluates it. When `false`, the schedule is inactive.

## Status

The runtime maintains the following read-only status fields on the schedule, not set by the caller:

```yaml
status:
  last_triggered_at: str | None    # UTC ISO 8601
  last_task_id: str | None
  next_trigger_at: str | None      # UTC ISO 8601
  consecutive_failures: int
  last_error: str | None
```

## Overlapping Execution

Schedules are time-driven, not completion-driven. A new task is created at each cron tick regardless of whether a previously-triggered task is still running.

## Example

```yaml
kind: "commonagents.info/v1/schedule"
namespace: "engineering"
name: "daily-standup-summary"
agent: "standup-agent"
cron: "0 9 * * 1-5"
timezone: "Australia/Sydney"
owner: "user:alice@example.com"
message: "Generate today's standup summary from the ticket backlog."
enabled: true
```
