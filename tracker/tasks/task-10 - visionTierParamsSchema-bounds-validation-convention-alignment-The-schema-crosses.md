---
id: TASK-10
title: 'visionTierParamsSchema bounds validation (convention alignment) — The schema crosses a…'
status: To Do
assignee: []
created_date: '2026-07-12 00:00'
labels:
  - 'area:jobs'
dependencies: []
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-12 — `visionTierParamsSchema` bounds validation (convention alignment) — The schema crosses a BullMQ job-payload boundary (`loadedPersonalitySchema` embeds it) but validates only types, not ranges — unlike its sibling `llmAdvancedParams.ts` (`temperature: min(0).max(2)` etc.). Values originate from DB-side-validated `advancedParameters` JSONB, so no live gap; defense-in-depth per the Zod-at-boundaries rule if a future write path skips the DB validation. **Fix shape**: mirror the sibling's bounds onto the nine numeric fields. **Promote when**: next touch of `visionTierParamsSchema`, or a new write path for vision configs. Surfaced by #1602 round-2 review (deferred at the iteration cap).

**Why:** Boundary-validation convention; not a live gap.
<!-- SECTION:DESCRIPTION:END -->
