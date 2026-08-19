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

## Widened by the PR #2149 round-9 review: SELF-overlap, not just shared marks

The framing above ("no heavy job shares a mark with any other job") fixes
collisions between DIFFERENT jobs and misses the case where a job overruns its
own interval. The roster sweep generates sequentially, up to
MAX_GENERATIONS_PER_SWEEP (10) rows at ROSTER_BLURB_TIMEOUT_MS (60s) each, so a
tick where every row times out costs ~600s — exactly its own 10-minute repeat
interval. Under sustained provider degradation it can still be running when its
next tick is due, and because the worker is concurrency-1, EVERY other scheduled
job queues behind it for that window regardless of which mark it holds.

So the guard needs both checks, not one: no two heavy jobs share a mark, AND no
job's worst-case duration exceeds its own repeat interval. The second needs the
same annotation as the first (a declared worst case per heavy job), which is why
it belongs here rather than in its own task.
<!-- SECTION:DESCRIPTION:END -->
