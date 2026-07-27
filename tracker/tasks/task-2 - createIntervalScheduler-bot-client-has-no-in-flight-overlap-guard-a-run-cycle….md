---
id: TASK-2
title: 'createIntervalScheduler (bot-client) has no in-flight overlap guard: a run cycle…'
status: To Do
assignee: []
created_date: '2026-07-26 00:00'
labels:
  - 'area:bot-client'
  - 'origin:review'
dependencies: []
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-26 (#1797 review observation) — `createIntervalScheduler` (bot-client) has no in-flight overlap guard: a `run` cycle outlasting `intervalMs` would overlap the next tick. Unreachable at current cadences (6h/24h intervals vs. seconds-long checks), which is why it shipped without one. The co-named seam: `RetentionPurgeService.buildPreview` does a per-user reach lookup (`Promise.all`, one query pair per cohort member) that the daily nag now puts on a timer — fine at today's cohort size, the pair to revisit together. **Fix shape**: an in-flight flag in the factory (skip-and-log the overlapping tick) + collapse the per-user reach split into one grouped query. **Promote when**: a fast-cadence consumer adopts the factory (interval within ~10× of run duration), or the eligible cohort grows large enough that preview latency is noticeable in the nag/CLI.

**Why:** Overlap is structurally possible but unreachable at every current call site; the trigger is a new consumer shape, not time.
<!-- SECTION:DESCRIPTION:END -->
