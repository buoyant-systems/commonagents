---
id: glossary
sidebar_position: 7
title: Glossary
description: Canonical definitions for terms used across the Common Agent Specification.
---

# Glossary

The following terms have specific meanings within the Common Agent Specification. These definitions describe how the terms are used in the spec itself — they are not requirements imposed on implementations.

**Action** — An outbound operation a tool exposes for the LLM to invoke. Actions are how agents interact with the world: calling APIs, reading files, running computations. Each action has exactly one execution backend and is presented to the LLM as a named, callable function.

**Action Allow List** — A safety mechanism that ensures agents only receive events for resources they have already actively operated on. When the LLM calls an action, the parameter values it resolved are recorded. Inbound events are only routed if their payload matches those recorded values. The allow list is per-tool, per-task, and keyed by parameter name — root, per-action, and per-event parameters all share it. Parameters with an agent-defined binding have a **sealed** allow list entry — fixed to the binding value at task start, it cannot grow from LLM action calls.

**Agent** — A declarative YAML manifest that pairs a system prompt with a set of capabilities, an optional LLM model preference, and a built-in authorisation layer (guardrails, middleware, bindings). Agents are fully defined by static configuration — no code.

**Binding** — An expression on an agent's capability configuration that deterministically injects a parameter value at execution time, bypassing LLM generation entirely. A binding hides the parameter from the LLM-facing schema and seals its action allow list entry. Bindings enforce that sensitive values (user IDs, account identifiers, resource paths) come from trusted task context rather than model output. `require_binding: true` on a parameter is a tool-side validation constraint that makes providing a binding mandatory — the configuration is invalid and the runtime errors if a binding is absent.

**Bundle** — A portable, multi-document YAML file containing a collection of agents, tools, schedules, and triggers. Bundles are the standard format for distributing and importing Common Agent configurations.

**Capability** — Anything an agent can do or respond to during a task. Capabilities come in three forms: actions (outbound execution), events (inbound signals), and delegation (invoking another agent as a sub-task). All three flow through the same middleware and guardrail pipeline.

**Delegation** — When an agent invokes another agent as a capability, creating an autonomous child task. The child runs its own conversation loop and returns its result to the parent. From the LLM's perspective, delegation is indistinguishable from invoking any other action.

**Event** — An inbound signal from an external platform that resumes an agent task. Events are the mechanism by which the outside world tells an agent that something relevant has happened — a PR comment, an email reply, a CI result. Events flow through the same middleware and guardrail pipeline as any other task input.

**Event Subscription** — The active routing state between a running task and a tool's event. When an agent lists a tool as a capability, the runtime automatically subscribes the task to all of the tool's events. The tool's `receive.filter` expressions and the action allow list together determine which inbound payloads are actually delivered.

**Guardrail** — A deterministic policy check at the agent's conversational boundary. Unlike probabilistic LLM-based content filters, Common Agent guardrails have full access to task context — they know what the user sent, what actions were called, and what the results were. `before` guardrails gate incoming input; `after` guardrails gate outgoing responses.

**Message** — A user-visible conversational round: one input paired with one agent response. A single message may span many internal turns (e.g., input → LLM → action → LLM → response).

**Middleware** — Ordered policy steps evaluated before or after a capability execution or event activation. Middleware is invisible to the LLM. It is the mechanism for assert-before-call access control, audit logging, input transformation, and capability-level rate limiting. The same middleware primitives are used at both the capability level and the agent guardrail level.

**Namespace** — A logical ownership and isolation boundary containing agents, tools, schedules, triggers, and their configuration. Namespaces map to teams, products, or tenants.

**Runtime** — An implementation of the Common Agent Specification. A runtime loads and executes agent, tool, schedule, and trigger manifests. Where this specification says "the runtime", it refers to any conforming implementation.

**Schedule** — A persistent resource that automatically creates tasks for an agent on a recurring cron cadence.

**Task** — A stateful, persistent conversation session between a user and an agent. A task persists its full conversation history, capability invocation records, token usage, and lifecycle state. Tasks do not end when the agent responds — they idle and wait for the next input, which may be a user message, an event, or a scheduled trigger.

**Tool** — A YAML manifest declaring one or more outbound actions and optionally one or more inbound events. Tools are the integration layer between agents and external systems. The LLM never sees a tool directly — only its individual named actions, presented as callable functions.

**Tool Runtime** — The execution or delivery mechanism declared within a tool. Action runtimes (in an action's `execute` block: `cel`, `stateless_http`, `stateful_session`, `openapi`, `mcp`, `kubernetes_job`) determine how outbound action invocations are executed. Receive runtimes (in an event's `receive` block: `webhook`, `subscription`, `poll`) determine how inbound events are delivered. The runtime type is inferred from which sub-key is present.

**Mount** — Workspace-level cloud storage configuration that enables agents to read and write persistent data. An agent's `mount` scope (`none`, `task`, `agent`, `workspace`) determines the storage prefix. When mount is non-`none`, `mount.*` template variables and `mount.read()`/`mount.write()` CEL functions are available.

**Trigger** — A persistent resource that automatically creates a new task for an agent when an inbound event matches its conditions. Where a Schedule fires on a time cadence, a Trigger fires on an external signal. Triggers operate on raw event payloads and bypass the action allow list — they are for cold-starting new conversations, not continuing existing ones.

**Turn** — A single entry in the LLM's conversation array, typed as `input` (user), `llm` (assistant), or `capability` (tool result). A user-visible message spans many turns. Turn count reflects total LLM context entries, not user-visible exchanges.
