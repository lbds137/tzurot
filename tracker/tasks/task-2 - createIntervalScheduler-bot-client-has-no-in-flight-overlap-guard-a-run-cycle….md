---
id: TASK-2
title: Collapse buildPreview per-user reach lookup into one grouped query
status: To Do
assignee: []
created_date: '2026-07-26 00:00'
updated_date: '2026-07-28 13:11'
labels:
  - 'area:bot-client'
  - 'origin:review'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Remaining half of the original pairing (the in-flight overlap guard in createIntervalScheduler shipped separately): `RetentionPurgeService.buildPreview` runs `splitOwnedCharacters` per cohort member (one personality.findMany + one findCrossUserReachIds each, concurrent via Promise.all). Fine at today's cohort size (~0-20 post-purge); the daily nag puts it on a timer, so a large cohort would put the whole per-user fan-out's latency on a schedule. Fix shape: one grouped owned-personalities query (`ownerId IN cohort`) + one grouped cross-user-reach query, split per user in memory. Promote when: the eligible cohort grows large enough that preview latency is noticeable in the nag/CLI (breaker-warn-scale cohorts). Deliberately NOT done alongside the guard: it rewrites freshly runtime-verified retention SQL (Phase-3 completion 2026-07-27) for latency nobody currently experiences.
<!-- SECTION:DESCRIPTION:END -->
