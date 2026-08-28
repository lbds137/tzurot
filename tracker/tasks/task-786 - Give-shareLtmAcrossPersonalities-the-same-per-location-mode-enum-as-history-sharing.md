---
id: TASK-786
title: >-
  Give shareLtmAcrossPersonalities the same per-location mode enum as history
  sharing
status: To Do
assignee: []
created_date: '2026-08-28 02:21'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 786000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: shareHistoryAcrossPersonalities is a 4-mode location-aware enum (always / guilds-only / dms-only / never — configOverrides.ts:54-56, with the colocated shouldScopeHistoryToPersonality truth table at :78), but the sibling shareLtmAcrossPersonalities is still a flat boolean (configOverrides.ts:41). A user who sets history to guilds-only (isolated in DMs) still gets cross-personality memories AND facts injected in DMs — observed live in a dev inspect trace 2026-08-27: 3 of 4 retrieved memories in a Weaver DM prompt belonged to COLD (DB-verified personality_id), because the retrieval gate at MemoryRetriever.ts:336 drops the personality filter entirely whenever the boolean resolves true. Owner call 2026-08-27: parallel structure — the flat boolean now reads as weirdly inconsistent beside the mode enum.

Fix shape: widen shareLtmAcrossPersonalities to the same 4-mode enum, coercing legacy stored boolean overrides at the schema/read seam (true -> always, false -> never); add a location-aware gate (generalize shouldScopeHistoryToPersonality or add a colocated twin); thread isDm into the consumers — MemoryRetriever.ts:336 plus the fact path (FactRetriever.ts, factRetrievalHelper.ts, FactStore.ts) — and update the dashboard control (settingsConfig.ts:76, tri-state -> mode select copying the Share History control) and cascade resolver typing/defaults (ConfigCascadeResolver.ts:153,165). All file:line cites verified 2026-08-27 — re-verify before editing, cites drift.

Acceptance: with mode guilds-only, a DM retrieval for personality A includes zero memory/fact rows scoped to personality B while guild retrieval still shares; legacy boolean override values resolve correctly through the cascade; the dashboard exposes all four modes.
<!-- SECTION:DESCRIPTION:END -->
