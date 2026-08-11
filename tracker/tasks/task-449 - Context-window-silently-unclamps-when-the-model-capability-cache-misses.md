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

GROUNDING 2026-08-11 (pre-dispatch, before writing a spec) — option (a) as written is NOT safe, because `null` carries two meanings that need opposite handling:

1. PERMANENT unknown — the model is in no catalog at all (a non-OpenRouter provider, an unrecognized id). There is no real limit to clamp to, so using the configured value is CORRECT, not a failure. `clampContextWindow` docblock names this case explicitly.
2. TRANSIENT unknown — the model has a real limit, but Redis is down, the key was evicted, or the process restarted. This is the actual bug: the same conversation swings between clamped and unclamped on consecutive turns.

Both arrive as the same `null` through `resolveModelContextLength` (contextWindowResolver.ts:40-54): `checkModelContextLength(model) ?? getZaiCodingPlanContextLength(model)`. Fail-closed on the conflated value would clamp legitimate case-1 configs down to a conservative floor for every non-OpenRouter model — a silent capability regression traded for a silent thrash fix.

So the real fix is upstream of the clamp: make the lookup distinguish "catalog says this model is absent" from "the catalog itself is unavailable". That distinction exists at the source — the OpenRouter catalog is either loaded (and the model genuinely missing) or not loaded at all. Only the transient case should fail closed; the permanent case keeps today's behaviour.

That makes this a SEMANTIC-class unit, not mechanical: the spec has to decide the distinguishing mechanism and what "fail closed" resolves to for a transient miss (last-known value, a conservative default, or deferring the turn). Do NOT hand it to a Sonnet worker as a precise edit until that call is made.

Also re-verified the premise while grounding: TASK-447 (the trimming watch) is still To Do, so trimming has not been observed live and the swing remains latent rather than user-visible. The severity assumption in this entry still holds as of 2026-08-11.
<!-- SECTION:DESCRIPTION:END -->
