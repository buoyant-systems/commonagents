---
id: task-io
sidebar_position: 2
title: TaskIO
description: The human-facing input/output shape of a task's conversation, and the messages projection a runtime exposes.
---

# TaskIO

A task's conversation is a sequence of inputs and outputs. Each entry is a **TaskIO** — the human-facing shape of one conversational message: the content exchanged, plus the structured values that accompanied it.

## Shape

A TaskIO serializes as a flat object with a well-known `message` key plus dynamic keys:

```yaml
message: list[ContentPart]   # the conversational content — see Content
{dynamic_key}: any           # inputs: agent parameters · outputs: agent exposes
```

1. `message` MUST be present on every TaskIO, carrying the conversational [content parts](./content).
2. An **input** TaskIO additionally carries the parameter keys from the agent's `parameters` schema. Required parameters are always present; optional parameters are present if provided.
3. An **output** TaskIO carries the keys from the agent's `exposes` schema. All declared `exposes` keys are always present.

## Where TaskIO Appears

- In the [task context](./task-context), as `context.input` and `context.output` — CEL expressions read entries positionally (`context.input[0].ticket_id`).
- In the **messages projection** below — the conversation as a task's consumers read it, polled alongside the [task status](./task-status).

## Messages

The conversation is exposed as a single chronological list of the task's TaskIO entries in **commit order** — each input at the moment it was received, each output at the moment it was produced — exactly as a conversation transcript reads. Input may be sent while a turn is in flight (see [Task Status, Interaction](./task-status#interaction)), so an input can legitimately appear before the output of the turn that was already running: the list records what actually happened.

Each message serializes as the TaskIO plus two presentation fields:

```yaml
type: input | output
message: list[ContentPart]
timestamp: str              # UTC ISO 8601 — when this message was committed
{dynamic_key}: any
```

1. `type` distinguishes input entries from output entries.
2. `timestamp` MUST be the time the message was committed, and the list MUST be ordered by it. Task processing is single-threaded, so no two messages ever commit at the same instant: commit order is a total, unique ordering.
3. Commit ordering preserves the relative order of inputs and of outputs, so a consumer that needs to correlate a response with the input that began its turn counts by `type`: the i-th output answers the i-th input.
