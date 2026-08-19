---
id: TASK-681
title: No guard catches two scheduled jobs sharing a cron minute mark
status: To Do
assignee: []
created_date: '2026-08-19 14:00'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 681000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the scheduled-jobs worker runs at BullMQ default concurrency (1), so two repeatable jobs on the same minute mark serialize — and if one is long-running the other is delayed by its whole runtime, every time the mark comes round. PR #2149 hit this class twice in one PR: the roster-blurb sweep first shared `*/10` with process-pending-memories, was moved to `3,13,23,...` to fix it, and that landed on reembed-null-vectors at `:13`. Both were caught by review, not by tooling.

Fix shape: a guard over REPEATABLE_JOB_SCHEDULE in services/ai-worker/src/index.ts. Expand each pattern to its minute set (only four forms are in use: `*/N`, `a,b,c`, `N`, and `M H` for the daily jobs) and assert the sets are pairwise disjoint.

The design question that makes this more than a one-liner: a bare disjointness check would be wrong. Two cheap jobs sharing a mark is harmless, and the daily 09:xx jobs collide with an hourly mark only once a day. What actually matters is that a LONG-RUNNING job shares no mark with anything. That needs the schedule entries annotated with something like `heavy: true` (the roster sweep and anything else making sequential model calls), and the guard asserting no heavy job shares a mark with any other job. Decide the annotation before writing the check.

Verified 2026-08-19: the occupied set is 0,7,10,13,15,20,22,25,30,37,40,41,45,50,52 and the roster sweep now runs at 4,14,24,34,44,54.
<!-- SECTION:DESCRIPTION:END -->
