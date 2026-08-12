---
id: TASK-449
title: Context window silently unclamps when the model-capability cache misses
status: Done
assignee: []
created_date: '2026-08-06 23:46'
updated_date: '2026-08-12 00:53'
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

DESIGN QUESTION RESOLVED 2026-08-11 — the distinction is already available at the source, so this is now spec-able rather than needing a design pass.

`resolveFromRedis` (services/ai-worker/src/services/ModelCapabilityChecker.ts:52-93) returns bare `null` from THREE places, and each one already knows which case it is in:

- line 59 — the catalog key is absent or empty (Redis down, never populated, evicted). TRANSIENT.
- line 66-68 — the cached catalog fails to JSON.parse. TRANSIENT (and already logged as a warn).
- line 72 — the catalog parsed fine and `models.find(...)` did not match. PERMANENT: OpenRouter genuinely does not list this model.

So the fix does not need new data or a new lookup — it needs the three returns to carry a tag instead of collapsing to one `null`, and `clampContextWindow` to treat only the transient tag as fail-closed. Permanent keeps today's behaviour, which is correct for non-OpenRouter providers.

AMPLIFIER found in the same read, and it makes the bug worse than the entry above describes: on the fallback path, `getCapabilities` (line 120-126) writes `contextLength: null` INTO the 5-minute in-memory `capabilityCache`. So one transient Redis blip is not a single unclamped turn — it poisons the in-memory cache for the full TTL, and the window stays unclamped for five minutes AFTER Redis recovers. Any fix must also avoid caching a transient-null as though it were a settled answer; caching the permanent case is fine.

Note the same three-way collapse feeds `supportsVision` and `supportsReasoning` on that path too — those degrade to pattern-matching, which is a deliberate documented fallback rather than a bug, so this task should not widen into them. Only the contextLength consumer treats null as "no constraint".
<!-- SECTION:DESCRIPTION:END -->
