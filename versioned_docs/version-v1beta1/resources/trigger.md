---
id: trigger
sidebar_position: 6
title: Trigger
description: The Trigger manifest for creating new agent tasks in response to inbound events.
---

# Trigger

A Trigger is a persistent resource that automatically creates a new task for an agent when an inbound event matches its source conditions. It is the event-driven counterpart to [Schedule](schedule) — where a Schedule fires on a time cadence, a Trigger fires on an external signal.

```yaml
kind: "commonagents.info/v1beta2/trigger"
namespace: str
name: str

agent: str
owner: str

source:
  type: str
  before: list[MiddlewareStep] | None

message: str | None
inputs: object | None

enabled: bool
```

## Fields

1. **`kind`** — Identifies this manifest as a Trigger. Must be `"commonagents.info/v1beta2/trigger"`.
2. **`namespace`** — Identifies the namespace this trigger belongs to.
3. **`name`** — Identifies the trigger uniquely within its namespace.
4. **`agent`** — Identifies the agent that a new task is created for when the trigger fires. The referenced agent exists in the same namespace.
5. **`owner`** — Identifies the user associated with all tasks created by this trigger. Used for identity, access control, and OAuth token resolution. The task runs with this user's identity and OAuth tokens — not the identity of the event sender.
6. **`source.type`** — The event source type this trigger listens to (e.g. `"github"`, `"email"`, `"slack"`). Must match a receive runtime configured in the server.
7. **`source.before`** — When present, CEL assert steps evaluated against the raw incoming event. If any assert fails, no task is created. Supports `event.payload.*` to access the raw event body.
8. **`message`** — When present, used as the input message for the created task. Supports `{event.payload.*}` interpolation to include event data. When absent, the task is created with no initial message.
9. **`inputs`** — When present, passed as structured input satisfying the agent's `parameters` schema. Required agent parameters must be present.
10. **`enabled`** — When `true`, the trigger is active. When `false`, the trigger is inactive and no tasks are created.

## Status

The runtime maintains the following read-only status fields on the trigger, not set by the caller:

```yaml
status:
  last_triggered_at: str | None    # UTC ISO 8601
  last_task_id: str | None
  total_triggers: int
  consecutive_failures: int
  last_error: str | None
```

## Trigger vs Event Subscription

There are two ways events can activate an agent:

| | **Trigger** | **Event Subscription** |
|---|---|---|
| **Creates** | A new task | Input to an existing task |
| **Declared in** | `Trigger` manifest | Tool event + agent capability |
| **Task identity** | `trigger.owner` | Original task owner (unchanged) |
| **Payload access** | `event.payload.*` (raw) | `event.<field>` (via tool `parameters` map) |
| **Filtering** | `source.before` CEL asserts | Tool `receive.filter` + binding scope |

Use a Trigger when an event should **start** a new agent conversation. Use a tool event subscription when an event should **continue** an existing one.

## Identity and RBAC

Tasks created by a Trigger run with the `owner` field's identity — not the identity of the event sender. The event sender may appear in the message content (via `{event.payload.*}` interpolation) but never determines authentication context.

The same self-restriction model applies as for Schedules:

| Role | Create | Read | Update | Delete |
|---|---|---|---|---|
| `agent_user` (non-admin) | Own triggers only | Own triggers only | Own triggers | Own triggers |
| `admin` | Any owner | All | All | All |
| `read_only` | ❌ | All | ❌ | ❌ |

## Raw Payload Access

Triggers receive raw event payloads directly — they are not processed through a tool's event `parameters` map. Use `event.payload.*` to access the unprocessed event body in both `source.before` and `message` fields:

```yaml
source:
  before:
    - assert: "event.payload.repository.private == false"
message: "New PR from {event.payload.pull_request.user.login}: {event.payload.pull_request.title}"
```

## Example

### Inbound Support Email

```yaml
kind: "commonagents.info/v1beta2/trigger"
namespace: "support"
name: "inbound-email"
agent: "support-agent"
owner: "user:alice@example.com"

source:
  type: email
  before:
    - assert: "!has(event.payload.headers.in_reply_to)"
    - assert: "event.payload.to.contains('support@company.com')"

message: >
  New support email from {event.payload.from}:
  Subject: {event.payload.subject}

  {event.payload.body_text}

enabled: true
```

### New GitHub Issue (Public Repos Only)

```yaml
kind: "commonagents.info/v1beta2/trigger"
namespace: "engineering"
name: "new-github-issue"
agent: "triage-agent"
owner: "user:bot@company.com"

source:
  type: github
  before:
    - assert: "event.payload.action == 'opened'"
    - assert: "event.payload.repository.owner.login == 'buoyant-systems'"
    - assert: "event.payload.repository.private == false"

message: >
  New issue #{event.payload.issue.number} in {event.payload.repository.name}:
  {event.payload.issue.title}

  {event.payload.issue.body}

enabled: true
```
