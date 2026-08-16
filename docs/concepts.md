---
id: concepts
sidebar_position: 3
title: Concepts
description: The core concepts of the Common Agent Specification — resources, tasks, capabilities, events, the value pipeline, middleware, and expressions.
---

# Concepts

The concepts below are the building blocks of the Common Agent Specification. Read this page before the resource reference pages — it provides the mental model that makes the field-level details make sense.

## Resources

Everything in the specification is defined as a **YAML manifest**. There are five resource types:

- **Agent** — pairs a system prompt with a set of capabilities. Defines what an agent can do, what constraints apply, and how it interacts with tools and events.
- **Tool** — declares one or more outbound actions and the execution backend that backs each one (HTTP, CEL, MCP, etc.). A tool may also declare inbound events — signals from external platforms that the agent can respond to.
- **Schedule** — triggers an agent automatically on a recurring cron cadence.
- **Trigger** — triggers an agent automatically when an inbound event matches its conditions. The event-driven counterpart to Schedule.
- **Bundle** — a portable multi-document YAML file containing any combination of agents, tools, schedules, and triggers. Bundles are the distribution format for sharing and importing configurations.

Agents and tools are the core pair. An agent *uses* tools; tools don't know about agents. The same tool can be shared across many agents.

## References and Versions

Resources refer to each other by name. An agent's `capabilities` keys name the tools and other agents it uses; nothing else in a manifest points at a resource.

A resource is identified by its namespace and its name together. A name is unique within its namespace, and one namespace may not hold an agent and a tool sharing a name.

A name is lower-case letters, digits and single dashes, starts and ends with a letter or digit, and is at most 63 characters — `[a-z0-9]+(-[a-z0-9]+)*`. The form is narrow on purpose: a name has to survive being used as an identifier by whatever a runtime is built on. A runtime storing resources as Kubernetes objects uses the name as the object's `metadata.name`, and every runtime folds the name into the function name the LLM sees. `input` and `llm` are additionally reserved, because each already names part of the task context that a capability of the same name would shadow.

- A tool is referenced as `{namespace}/{tool_name}`.
- An agent is referenced as `{namespace}/{agent_name}`, or equivalently as `agent://{namespace}/{agent_name}`. A runtime MAY additionally interpret `agent://{hostname}/{namespace}/{agent_name}` as an agent hosted elsewhere.

A reference that omits the namespace resolves within the manifest's own namespace.

### Pinning a version

Manifests are editable, and a task can run for a long time after it starts. A reference MAY therefore carry a **version** suffix, naming exact content instead of whatever happens to be current:

```yaml
capabilities:
  "agent://research/summariser@9f2c4e...": "*"
```

- A **version** is the SHA-256, in lower-case hexadecimal, of the canonical serialisation of that resource's spec. It is never abbreviated.
- A version is immutable: the same version always denotes the same content. It is not ordered — two versions tell you that content differs, never which came first.
- A reference carrying no suffix means "whatever is current at the moment this reference is resolved".
- A runtime resolves references **once, when a task is created**, and runs the resolved content for that task's whole life. Editing a manifest therefore never changes what an already-running task does.

The `@` is not part of a name: names may not contain one, and a reference is a name once its suffix is removed. A runtime MAY accept other ways of addressing a version in this position, but only the SHA-256 form is portable.

## Tasks and the LLM Loop

When an agent is invoked, the runtime creates a **Task** — a stateful, persistent conversation session. A task does not end when the agent responds; it reaches an **idle state** and waits for further input.

A **message** is one complete conversational exchange: the input from the caller paired with the agent's reply. Under the hood, a single message may span many **turns** — individual entries in the LLM's conversation array, typed as `input` (user), `llm` (assistant), or `capability` (tool result). The LLM sees all turns; the caller sees only messages.

Inside a task, the runtime processes each message with a continuous loop:

1. Input arrives — a user message, a scheduled trigger, an inbound event, or a continuation of a previous conversation.
2. The LLM is called with the system prompt and conversation history.
3. The LLM either sends a message and the task goes idle, or decides to invoke an action.
4. If an action is invoked, the runtime executes it and feeds the result back to the LLM as a new turn.
5. Steps 2–4 repeat until the LLM sends a message.

## Capabilities

A **capability** is anything an agent can do or respond to during a task. An agent's capabilities come in three forms:

- **Actions** — outbound functions the LLM can invoke. The specification presents all actions through the same interface: the LLM sees a named, callable function regardless of whether it's backed by HTTP, a CEL expression, an MCP server, or any other runtime.
- **Events** — inbound signals from external platforms that inject input into a running task. Tools declare both their actions and their events; when an agent lists a tool as a capability it automatically subscribes to all of the tool's events, with no extra configuration required.
- **Delegation** — another agent exposed as a capability. When invoked, it creates an autonomous child task that runs its own conversation loop and returns its output to the parent. From the LLM's perspective, delegation is indistinguishable from invoking any other action.

All three forms flow through the same middleware and guardrail pipeline. See [Events](./capabilities/events.md) and [Tool Runtimes](./resources/tool-runtimes.md) for the full capability surface.

## The Value Pipeline

**Parameters** are the structured inputs a capability expects at invocation time. How they are provided depends on context:

- For **tool actions**, parameters are generated by the LLM when it decides to invoke the action. They can also be injected deterministically via a binding, bypassing the LLM entirely.
- For **tool events**, all root tool parameters are available as `parameters.*` inside the event's `receive.filter` CEL expression, so the tool author can use them to scope which events are routed. Parameters with a binding are hidden from the LLM and have their allow list entry sealed — making them reliable for use in filters. `require_binding: true` is a tool-side validation constraint that ensures the agent must provide a binding.
- For **agents**, parameters define the structured input the agent accepts from its caller. The `message` key is a well-known parameter that carries the conversational content and MUST be present on every input — either provided explicitly or resolved from a schema default.

**Settings** are a separate category: static, operator-configured values declared in a tool manifest — API keys, base URLs, environment-specific configuration. They are never exposed to the LLM and never generated by it. Settings apply only to tools; agents do not have settings.

**Bindings** are expressions evaluated against trusted task context that supply parameter values without LLM involvement. They are the mechanism that keeps security-critical values — user identities, account references, resource paths — out of model-generated input. See [Bindings](./capabilities/bindings.md) and [Parameter Pipeline](./reference/parameters.md).

## Middleware and Guardrails

The concept of a **guardrail** in most platforms means running a prompt or response through an LLM-based content filter — probabilistic checks with no access to what happened earlier in a conversation. Common Agents guardrails are a fundamentally different thing: deterministic, logic-driven policy steps that can reference the full task context. They know what the user sent, what the agent has already done, which actions were invoked, and what the results were.

In Common Agents, guardrails are applied at the agent's conversational boundary — validating input from the caller and output back to the caller, across the entire conversation. Middleware is the same mechanism applied to individual capability invocations. Both support the same step types, the same context access, and the same deterministic logic. The only difference is where they are applied.

See [Middleware](./capabilities/middleware.md) for the full step specification.

## Expressions

The specification uses two expression mechanisms with a clear distinction between them.

**Some fields support `{...}` interpolation** — curly braces embed a value from a known root into the surrounding string at execution time:

```yaml
url: "https://api.example.com/users/{parameters.user_id}"
headers:
  Authorization: "Bearer {settings.api_key}"
```

**Expression fields** — middleware assertions, binding values, guardrail conditions, transforms, event `receive.filter` — take a CEL expression directly as the field value, with no surrounding string to interpolate into. The entire field is evaluated as logic:

```yaml
assert: "context.capabilities.fetch_ticket.count_successful > 0"
```

The difference is in the field type. Interpolation-capable fields use `{...}` to embed a reference into a string; expression fields are pure CEL. See [CEL Reference](./reference/cel.md).
