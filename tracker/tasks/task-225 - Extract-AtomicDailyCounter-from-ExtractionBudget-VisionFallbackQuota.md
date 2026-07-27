---
id: TASK-225
title: 'Extract AtomicDailyCounter from ExtractionBudget + VisionFallbackQuota'
status: To Do
assignee: []
created_date: '2026-07-07 00:00'
labels:
  - 'area:redis'
  - 'origin:review'
dependencies: []
ordinal: 225000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Extract `AtomicDailyCounter` from ExtractionBudget + VisionFallbackQuota — Identical public shape (constructor(redis, dailyLimit), tryConsume, UTC-day key, 25h TTL, fail-open) with only DATA varying — passes the 2-callback ceiling with zero callbacks. Bonus: backports ExtractionBudget's atomic Lua INCR+EXPIRE to VisionFallbackQuota, closing its real crash-between-incr-and-expire gap. **Promote when**: a third daily-counter clone appears, or next touching either file. Surfaced 2026-07-07 (PR #1528 post-rebase review).

**Why:** Two clones today; the extraction is also a correctness backport.
<!-- SECTION:DESCRIPTION:END -->
