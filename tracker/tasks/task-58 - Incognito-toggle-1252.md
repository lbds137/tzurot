---
id: TASK-58
title: 'Incognito toggle (#1252)'
status: To Do
assignee: []
created_date: '2026-06-18 00:00'
labels:
  - 'area:redis'
dependencies: []
ordinal: 58000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Incognito toggle (#1252) — test-coverage gaps + cosmetic cleanup

**Why:** **Test gaps** (claude-review Medium; don't block, but close before the next refactor touches these files): (1) `ConversationalRAGService.ts` ~:470-473 `summonIncognito=false` path — assert the Redis `isIncognitoActive` call runs and memory write proceeds; (2) `MessageContextBuilder.ts` epoch logic — assert a personal weigh-in (`incognito=false, isWeighInMode=true`) KEEPS `contextEpoch`; (3) `adjustContextForWeighInMode` in `services/character/characterTurn.ts` — no unit test covers the new 3-arg split shape. **Cosmetic cleanup**: standardize the `incognito ?? isWeighIn` boolean shape — `MemoryRetriever`/`ContextAssembler`/`ConversationalRAGService` use `?? Boolean(x)` while `MessageContextBuilder` uses `(… ?? …) === true`; converge on `(incognito ?? isWeighIn) === true` (matches MessageContextBuilder, prettier-stable since the parens are semantically required, house style). Also: `MemoryRetriever` LTM-skip log says "Incognito mode" even when the `isWeighIn` default drove it — neutral "Skipping LTM retrieval (anonymous summon)" is better; and `ContextBuildOptions.ts` `incognito` JSDoc leaks call-site detail ("Defaults to isWeighInMode at the call site") — describe semantics, not the caller's default. ~~**UX**: `/character random <message>` option description says "Anonymous by default" but the default there is personal — reword (needs commandManifest + int-snapshot regen).~~ ✅ Resolved in PR #1263 (reworded to "Hide your persona & memories. Defaults on with no message, off when you send one."; reviewer-confirmed against `incognito ?? isWeighInMode`). **Promote when**: next refactor touches these files, OR the user lands on preferred option wording post-verification. Surfaced by PR #1252 claude-review (rounds at 7:18 + 9:44, 2026-06-18).
<!-- SECTION:DESCRIPTION:END -->
