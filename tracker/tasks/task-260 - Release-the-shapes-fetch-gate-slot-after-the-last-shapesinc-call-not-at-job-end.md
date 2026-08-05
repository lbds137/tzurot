---
id: TASK-260
title: >-
  Release the shapes fetch-gate slot after the last shapes.inc call, not at job
  end
status: To Do
assignee: []
created_date: '2026-07-13 00:00'
updated_date: '2026-07-28 10:51'
labels:
  - 'area:db'
  - 'origin:review'
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 260000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Release the shapes fetch-gate slot after the last shapes.inc call, not at job end — #1631 review observation: the import job holds one of 2 global slots through the pgvector memory-import phase, which touches no shapes.inc traffic — for a maximal import that's most of an hour of slot pressure with zero etiquette benefit. **Fix shape**: release after `downloadAndStoreAvatar` (the last shapes.inc/CDN call) instead of the outer `finally`; keep the finally as a held-slot backstop. **Promote when**: shapes import volume or duration grows enough that gate contention is observed (busy errors in logs from real overlap). Surfaced 2026-07-13 (#1631 review).

**Why:** Tightens the etiquette window without weakening it; irrelevant at current traffic.
<!-- SECTION:DESCRIPTION:END -->
