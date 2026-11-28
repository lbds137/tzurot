---
id: TASK-1590
title: 'Reroll: the young-marker recheck lives only in process memory'
status: To Do
assignee: []
created_date: '2026-11-28T18:27:00Z'
labels:
  - area:bot-client
  - size:M
  - state:dependent
dependencies: []
priority: low
ordinal: 1580000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Fable r5 review L1 (docs/local/task-1582/fable-review-r5.md). When a reroll handler dies before writeInflight, the redelivered result usually finds an other-boot marker younger than REROLL_INFLIGHT_MIN_AGE_MS. The handler acknowledges the result and holds the abort in a closure (rerollResultHandler.ts young-marker gate). A second restart inside that wait loses the closure; nothing redelivers, no abort runs, and the attempt memories stay visible until the stale-orphan rule.
What: the periodic recovery pass also scans reroll:job:* keys. A job whose marker is from another boot, past the minimum age, with no inflight record, gets an abort from the job record alone (the gateway reads ids from job_results by jobId). Remove the closure.
Acceptance: a test where the recheck process dies and the next pass still aborts the attempt.
<!-- SECTION:DESCRIPTION:END -->
