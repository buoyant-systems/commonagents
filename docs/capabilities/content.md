---
id: content
sidebar_position: 2
title: Content
description: The unified ContentPart model for task input and output — inline text and mount file references.
---

# Content

Tasks and agents often need to process text and varying forms of multimedia. To provide a standardised interface for sending this input to agents (and receiving it from them), they interact via a unified generic content model comprised of `ContentPart`s. The `message` on every task input and output is a `list[ContentPart]`.

A text string and a 10&nbsp;GB video segment are both represented as `ContentPart`s, differing only by their properties.

To prevent task objects and event histories from growing unboundedly, inline content is bounded: a `ContentPart`'s `text` field MUST NOT exceed **100&nbsp;KB (100,000 bytes)**. Text beyond this budget IS file content: it MUST be uploaded to the agent's [mount](../resources/mount) and passed as a `file` reference. Implementations MUST reject oversized text with a corrective error, never transform it implicitly — and since mounts are optional, an agent without a mount cannot accept text beyond the inline budget at all. A part's `metadata` MUST NOT exceed 8&nbsp;KB serialised: metadata carries small annotations, never payloads. This enforces a strict **pass-by-reference** paradigm for large data.

## ContentPart Schema

```yaml
mimeType: str
text: str | None
file: str | None
sizeBytes: int | None
metadata: object | None
```

Content takes exactly two forms — inline `text` or a `file` reference. A `file` reference names a mount root and never a remote host: there is no form that fetches from somewhere else, because every object a model can see lives in the receiving agent's mount and is referenced from there.

The `file` field is a file reference in the **receiving agent's mount**, a URI whose scheme is its root (e.g. `task://report.pdf`; see [Mount](../resources/mount)), and is the canonical form for all non-text content. All binary data shown to a model MUST be served from the agent's own mount: files are uploaded (or copied) into the mount first, then referenced by name. The runtime resolves `file` parts against the mount per LLM request — content bytes and transient signed URLs are never persisted in task state, and a content hash is captured at reference time for auditing. When content crosses a task boundary (e.g. a sub-task's media output routed to its parent, or a file forwarded to a delegated agent), the runtime MUST copy the object into the recipient's mount at ingestion and re-reference it by `file` name; a reference outside the receiving agent's mount MUST NOT be forwarded to a model.

### Text input (inline)

If the `ContentPart` represents inline text within the 100&nbsp;KB budget, the `text` field MAY be populated directly. The `mimeType` MUST be set to `text/plain`.

```json
{
  "mimeType": "text/plain",
  "text": "Please summarise the attached document."
}
```

### Text input (reference)

If the text exceeds the 100&nbsp;KB inline budget (e.g. a large document or system log), it MUST first be uploaded into the mount and passed as a `file` reference instead of using the `text` field.

```json
{
  "mimeType": "text/plain",
  "file": "task://large_prompt.txt",
  "sizeBytes": 56000
}
```

### Media input (file reference)

If the `ContentPart` represents a file or media object, the `file` field MUST be populated with its reference URI, and `mimeType` with the media type. `sizeBytes` MAY be populated.

```json
{
  "mimeType": "video/mp4",
  "file": "task://sample.mp4",
  "sizeBytes": 10485760
}
```

*In-memory file passing (e.g. `bytes: [...]`) is intentionally omitted from the core spec. Implementations MUST pass files by `file` reference to prevent message sizes from crashing runtime processors or breaking event-tracking limits.*

## Using content in CEL conditions

Because all inputs and outputs conform to this schema, deterministic capability `conditions` and agent [guardrails](middleware) can assert against these structures using standard CEL properties:

- **Restrict file size:** `size(i) > 0 && i[0].sizeBytes < 15000000` (file inputs under 15&nbsp;MB)
- **Restrict file type:** `size(i) > 0 && i[0].mimeType.startsWith("image/")` (only images)
- **Require a document input:** `size(i) > 0 && has(i[0].file)` (require an attached file reference)
