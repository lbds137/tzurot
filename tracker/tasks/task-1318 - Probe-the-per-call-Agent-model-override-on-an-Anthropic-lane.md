---
id: TASK-1318
title: Probe the per-call Agent model override on an Anthropic lane
status: To Do
assignee: []
created_date: '2026-10-28T19:11:00Z'
labels:
  - area:skills
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1301000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2679 acceptance claimed the per-call model override was confirmed; the runtime probe falsified it on this lane — both dispatched seyag:implementer workers ran glm-5.3-flash (subagent JSONL .message.model, 74+68 messages) despite model: sonnet on the Agent calls. Two candidate explanations: the z.ai lane resolves model aliases lane-locally (sonnet -> the lane model), or the override field is ignored for plugin agents; the z.ai probe cannot distinguish them.

What: from a session on the Anthropic lane, dispatch one bounded worktree subagent with model: haiku (or sonnet) and read its per-message .message.model the same way. Record which explanation holds, then add the lane caveat to the Worker-model-tier rule (tzurot-orchestration SKILL.md ~line 49) — today it reads as if sonnet tier buys Sonnet everywhere; on z.ai it serves the lane model either way.

Acceptance: a recorded observation naming which explanation holds (or naming that it is still ambiguous with the probes run), and the Worker-model-tier text carrying the lane caveat. Fleet consequence if lane-local resolution is confirmed: the sonnet worker tier is an Anthropic-lane concept only; z.ai dispatches serve glm regardless of the model field.
<!-- SECTION:DESCRIPTION:END -->
