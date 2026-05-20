---
id: why
sidebar_position: 2
title: Why?
description: The design rationale behind the Common Agent Specification — security, auditability, and democratising access to AI agents.
---

# Why?

AI agents are most valuable when the people who understand a problem can define and deploy them — not just the engineers who build the infrastructure. But giving non-technical teams the ability to connect an AI to real systems, with real consequences, only works if those agents are safe to deploy and easy to reason about.

Common Agents is built around that tension. It is designed to make agents accessible to anyone who can work with structured data, while ensuring that the security constraints, approval gates, and policies that enterprises require are a first-class part of the definition — not an afterthought applied in deployment.

Three properties define how the specification achieves this.

## Democratising Agents

Writing an agent should not require a software engineer. The people closest to a business problem — analysts, operations teams, domain experts — often have the clearest understanding of what an agent should do and what rules it should follow. What they lack is a way to express that without writing code.

Common Agents is designed to be read and written by anyone who can work with structured data. Agents, tools, and their policies are plain YAML. Capabilities are documented interfaces. Security rules are explicit statements. There are no hidden behaviours, no framework internals to learn, and no deployment pipeline required to understand what an agent will do.

The goal is to put AI automation in the hands of the people who understand the problem — not just the people who understand the infrastructure.

## Security

LLMs are non-deterministic and can be manipulated. An agent that lets the model freely generate all of its capability inputs is vulnerable to prompt injection, model hallucination, and adversarial user input. When those inputs include sensitive identifiers — user IDs, account numbers, resource paths — the consequences can be severe.

The specification addresses this at multiple levels. The manifest declares exactly which capabilities an agent can invoke — the LLM cannot reach anything not listed. Specific parameters can be pinned to values from trusted task context, bypassing the model entirely, so that security-critical values can never be overridden by what a user says. Assertion gates before and after capability invocations let you enforce preconditions, require human approval, and record audit trails — all as part of the manifest, not bolted on afterwards.

## Auditability

An agent manifest is the complete, static description of what an agent can do. There is no code to read, no runtime to inspect. The manifest alone tells you which capabilities are exposed, which parameters are locked to trusted values, which checks run before and after each call, and which policies apply at the agent's input and output boundaries.

This makes agents auditable in a way that code-based approaches are not. A security reviewer, a compliance team, or an automated policy engine can reason about an agent's behaviour from a single file — without running it, without tracing through a call stack, and without needing to understand the underlying implementation.

