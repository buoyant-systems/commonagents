---
id: intro
slug: /
sidebar_position: 1
title: Introduction
description: What the Common Agent Specification is, who it is for, and how to use it.
---

# Common Agent Specification

The **Common Agent Specification** is an open, vendor-neutral format for defining AI agents, tools, and schedules as declarative YAML manifests. An agent's capabilities, constraints, and policies are all expressed in a single human-readable file — there is no code to understand, no runtime to inspect, no deployment configuration to trace.

## Who is this for?

- **Runtime implementers** — build a compliant execution engine that loads and runs Common Agent manifests.
- **Platform operators** — configure, audit, and govern agents deployed in your environment.
- **Agent authors** — write agents and tools using the portable manifest format, knowing they will run on any compliant runtime.

## How to read this specification

Start with [Why?](./why) for the design rationale, then [Concepts](./concepts) for the mental model. The resource reference pages ([Agent](./resources/agent), [Tool](./resources/tool), [Bundle](./resources/bundle), [Schedule](./resources/schedule)) are the normative field-level spec. The [Task Lifecycle](./capabilities/task-context) and [Reference](./reference/cel) sections cover runtime behaviour and expression syntax.

## Versioning

The current version of the specification uses the kind prefix `commonagents.info/v1`. Every resource manifest must declare its kind:

```yaml
kind: "commonagents.info/v1/agent"
```

## Licence

The Common Agent Specification is published by **Buoyant Systems** and licensed under [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).

You are free to implement, fork, redistribute, and build commercial products on top of this specification. You must give appropriate credit to Buoyant Systems and link to the licence.
