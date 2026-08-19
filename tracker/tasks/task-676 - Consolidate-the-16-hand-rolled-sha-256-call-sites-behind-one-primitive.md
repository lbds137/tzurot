---
id: TASK-676
title: Consolidate the 16 hand-rolled sha-256 call sites behind one primitive
status: To Do
assignee: []
created_date: '2026-08-19 03:18'
labels:
  - 'area:common-types'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 676000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: found while writing hashCharacterCard for TASK-660 PR 1. `grep -n "createHash(.sha256.)"` across packages/*/src + services/*/src (excluding tests and dist) returns 16 non-test sites, each hand-rolling `createHash("sha256").update(x).digest("hex")` and then truncating to a DIFFERENT width: full (feedbackNormalization.ts:23, characterCardChecksum.ts:68, fix-migration-drift.ts:74, create-safe-migration.ts:227), 32 (constants/memory.ts:25, deterministicUuid.ts:287/352/368), 16 (LocalEmbeddingService.ts:320, duplicateDetection.ts:278, RedisDeduplicationCache.ts:251), 12 (baseline-meta.ts:123), and a named constant (cacheObservability.ts:37).

The cost is not duplication, it is MISCOPYING. The widths are load-bearing per site and invisible at the call site, so picking a neighbour as precedent silently changes collision resistance. Two files already carry defensive comments about each other: hashFeedbackContent notes "the repo’s other sha-256 helpers all truncate; this one must not", and cacheObservability.ts:30 says "Deliberately not duplicateDetection.ts’s contentHash". TASK-660 nearly shipped a third instance of the same mistake — the task description named duplicateDetection.ts contentHash() as the precedent for a VarChar(64) column, which would have stored 16 chars in a 64-wide column. A premise check caught it; the next one may not.

Fix shape: one `sha256Hex(input, opts?)` in common-types/utils taking an explicit width (default full), so every call site states its truncation in one readable argument instead of a chained `.slice()`. Migrate the 16 sites, preserving each existing width EXACTLY — a width change is a behaviour change for anything persisted or used as a cache key (memory ids, dedup keys, baseline meta). Normalization stays per-site: feedback lowercases, the card checksum deliberately does not.

Acceptance: one primitive; all 16 sites migrated with widths unchanged; the two defensive cross-referencing comments deleted because the trap they warn about no longer exists.
<!-- SECTION:DESCRIPTION:END -->
