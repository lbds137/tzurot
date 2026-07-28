---
id: TASK-9
title: 'Vision single-flight loser: re-check negative cache after fall-through'
status: To Do
assignee: []
created_date: '2026-07-12 00:00'
updated_date: '2026-07-28 10:46'
labels:
  - 'area:ai-worker'
  - 'size:S'
dependencies: []
priority: low
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-12 — single-flight loser skips the negative-cache re-check after fall-through — A waiter that falls through (winner failed) proceeds straight into its own provider call even though the winner's failure was just written to the negative cache — re-running `checkNegativeCache` after a fallen-through `enterSingleFlight` would short-circuit doomed duplicates. Value is bounded: failure entries are per-MODEL (`vision:fail:{model}:…`), so only same-model losers would hit the winner's entry; different-model losers correctly retry on their own model. **Fix shape**: one re-check + early-return in `describeImage` after the fall-through branch. **Promote when**: next VisionProcessor touch, or if fan-out failure storms show in logs. Surfaced by #1603 round-2 review (non-blocking).

**Why:** Cheap short-circuit for the same-model failure case.
<!-- SECTION:DESCRIPTION:END -->
