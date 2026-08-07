---
id: TASK-449
title: Context window silently unclamps when the model-capability cache misses
status: To Do
assignee: []
created_date: '2026-08-06 23:46'
updated_date: '2026-08-07 16:23'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 449000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The effective context window is re-resolved on every generation (ConversationalRAGService.ts:385-388 into services/contextWindowResolver.ts:71-91) and clamped by clampContextWindow(configured, modelContextLength) — packages/common-types/src/utils/contextWindowCap.ts:65-70.

The clamp input comes from checkModelContextLength into ModelCapabilityChecker.getCapabilities, which is backed by a 5-minute in-memory TTL over a Redis cache. Its own docblock (ModelCapabilityChecker.ts:191-198) states it returns null when Redis is unavailable or misses. And contextWindowCap.ts:66-68 treats null as "no clamp" — it uses the configured value unclamped.

So a Redis miss, eviction, or restart flips the effective window between the clamped and unclamped values for the SAME conversation on consecutive turns. Worked example: configured 131072 against a 200k model gives 100000 when cached and 131072 on a miss. In the trimming branch that is a swing of roughly 28,000 tokens of history budget, driven purely by cache state rather than by anything about the request.

Why it is not currently harmful: trimming is dormant (TASK-447), so the budget covers all fetched history in either state and the swing changes nothing observable. It becomes live the moment trimming starts, and it would then look like inexplicable window thrash.

Fix shape options: (a) fail closed — treat a null capability lookup as "use the conservative clamp" rather than "no clamp"; (b) cache the resolved window per conversation for the turn; (c) at minimum, log when the unclamped path is taken so the thrash is visible. Option (a) is the smallest and matches the fail-safe direction used elsewhere.

Surfaced 2026-08-06 by the Phase-2 windowing grounding sweep.
<!-- SECTION:DESCRIPTION:END -->
