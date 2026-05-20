---
id: glossary
sidebar_position: 6
title: Glossary
description: Canonical definitions for terms used across the Common Agent Specification.
---

# Glossary

The following terms have specific meanings within the Common Agent Specification. These definitions describe how the terms are used in the spec itself — they are not requirements imposed on implementations.

**Agent** — A declarative YAML manifest that pairs a system prompt with a set of capabilities, an optional LLM model preference, and a built-in authorisation layer (guardrails, middleware, bindings). Agents are fully defined by static configuration — no code.

**Binding** — A CEL expression on an agent's capability configuration that deterministically injects a value into a capability parameter at execution time, bypassing LLM generation entirely. Bindings enforce that sensitive values (user IDs, ticket numbers, etc.) come from trusted task context rather than model output.

**Bundle** — A portable, multi-document YAML file containing a collection of agents, tools, and schedules. Bundles are the standard format for distributing and importing Common Agent configurations.

**Capability** — An action that an agent can invoke during a task. Capabilities include tool function calls (HTTP, CEL, filesystem, MCP, etc.) and other agents, enabling multi-agent delegation.

**Delegation** — When an agent invokes another agent as a capability, creating an autonomous child task. The child runs its own conversation loop and routes its output back to the parent.

**Guardrail** — Middleware steps defined at the agent level that gate conversational input or output. Unlike capability middleware (which gates individual tool executions), guardrails operate on the user–agent boundary — validating what goes in and what comes out.

**Message** — A user-visible conversational round: one user input paired with one agent output. A single message may span many internal turns (e.g., input → LLM → capability → LLM → output).

**Middleware** — An ordered sequence of assertion, invocation, or transform steps that the runtime evaluates before or after a capability execution. Middleware is invisible to the LLM — it does not consume turns or appear in conversation history.

**Namespace** — A logical ownership and isolation boundary containing agents, tools, schedules, and their associated configuration.

**Runtime** — An implementation of the Common Agent Specification. A runtime loads and executes agent, tool, and schedule manifests. Where this specification says "the runtime", it refers to any conforming implementation.

**Schedule** — A persistent resource that automatically creates tasks for an agent on a recurring cron cadence.

**Task** — A stateful, asynchronous conversation session between a user and an agent. A task persists its full conversation history, capability invocation records, token usage, and lifecycle state.

**Tool** — A YAML manifest declaring one or more capabilities along with their execution backends, shared settings, and parameters. The LLM never interacts with a tool directly — only with its individual capabilities.

**Turn** — A single message in the LLM conversation array. Each turn has a type: `input` (user), `llm` (assistant), or `capability` (tool result). Turn count reflects total conversation messages, not user-visible messages.
