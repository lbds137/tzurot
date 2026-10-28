---
id: TASK-1318
title: Probe the per-call Agent model override on an Anthropic lane
status: Done
assignee: []
created_date: '2026-10-28T19:11:00Z'
updated_date: '2026-10-28T20:07:00Z'
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

Close-out (same day, both acceptance halves met without the Anthropic probe): (1) the which-explanation question was already answered by the recorded cc-route mapping in shared memory (project_driver_effort_levels.md: on GLM lanes the Agent model names map lane-locally — opus/sonnet/haiku -> GLM 5.3 Flash) — the 10-28 probe confirmed that recorded knowledge live, so lane-local resolution is the holding explanation, not override-ignore. (2) The Worker-model-tier caveat landed in PR 2679 round 4 ("The per-call override is verified only on an Anthropic lane; on other lanes the lane's own model serves regardless of the passed field"). The Anthropic-lane probe remains available if a lane-mismatch case ever needs first-hand evidence, but the acceptance does not require it.
<!-- SECTION:DESCRIPTION:END -->
