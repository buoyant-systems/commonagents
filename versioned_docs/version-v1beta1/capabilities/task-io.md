---
id: task-io
sidebar_position: 2
title: TaskIO
description: The human-facing input/output shape of a task's conversation, and the messages projection a runtime exposes.
---

# TaskIO

A task's conversation is a sequence of inputs and outputs. Each entry is a **TaskIO** — the human-facing shape of one conversational message: the content exchanged, plus the structured values that accompanied it.

## Shape

A TaskIO serializes as a flat object with well-known keys plus dynamic keys:

```yaml
message: list[ContentPart]   # the conversational content — see Content
received_at: str | None      # UTC ISO 8601 — inputs only; when the input arrived
committed_at: str            # UTC ISO 8601 — when this turn entered the conversation
{dynamic_key}: any           # inputs: agent parameters · outputs: agent exposes
```

1. `message` MUST be present on every TaskIO, carrying the conversational [content parts](./content.md).
2. `committed_at` MUST be present on every TaskIO and MUST be the time the turn entered the conversation the model reads from.
3. `received_at` MUST be present on every **input** and MUST be the time the runtime took delivery of it. It does not apply to an output, which the runtime produces rather than receives. The two instants are recorded separately because they are not the same moment — see Messages below.
4. `message`, `received_at` and `committed_at` are well-known keys: an agent's `parameters` and `exposes` schemas MUST NOT supply them.
5. An **input** TaskIO additionally carries the parameter keys from the agent's `parameters` schema. Required parameters are always present; optional parameters are present if provided.
6. An **output** TaskIO carries the keys from the agent's `exposes` schema. All declared `exposes` keys are always present.

## Where TaskIO Appears

- In the [task context](./task-context.md), as `context.input` and `context.output` — CEL expressions read entries positionally (`context.input[0].ticket_id`).
- In the **messages projection** below — the conversation as a task's consumers read it, polled alongside the [task status](./task-status.md).

## Messages

The conversation is exposed as a single list of the task's TaskIO entries in **commit order** — the order in which the task actually took them — exactly as a transcript of what happened reads.

An input has two distinct instants, and a runtime MUST track both. It **arrives** when the runtime takes delivery of it, and it is **committed** when the runtime places it in front of the model. For an input sent while a turn is in flight these are not the same moment and may be a whole turn apart: a runtime is not obliged to interrupt a running turn (see [Task Status, Interaction](./task-status.md#interaction)), so a queued input is committed whenever that runtime next calls the model — which, for a turn that answers without invoking a capability, is after that turn's output.

Commit order is therefore not send order, and a message can be listed after an output it was sent before. The list reports the difference rather than resolving it: every input carries `received_at`, so a consumer that wants to present the order the sender experienced has what it needs. **Which order to present is the consumer's decision.**

A message is the TaskIO exactly as the task holds it, plus one presentation field:

```yaml
type: input | output
message: list[ContentPart]
received_at: str            # inputs only — from the TaskIO
committed_at: str | None    # from the TaskIO; absent on an input not yet committed
{dynamic_key}: any
```

1. `type` distinguishes input entries from output entries. It is the only field this projection adds — the instants are the turn's own, so the conversation is readable from the task object and a runtime MUST NOT require its event history to serve this list.
2. `committed_at` is absent exactly when the input has arrived but has not been committed. Its absence is the **read receipt**: while it is absent the model has not been shown the message, and a consumer MUST NOT infer that it has been from the message's position.
3. The list MUST be ordered by `committed_at`, with the inputs that have arrived but not yet been committed after it — they have no commit instant, and will commit later than everything that has one.
4. The ordering preserves the relative order of inputs and of outputs, so a consumer that needs to correlate a response with the input that began its turn counts by `type`: the i-th output answers the i-th committed input.
