---
id: TASK-410
title: Migrate to BullMQ 6 (repeat opts removed; re-verify lock/stall tuning)
status: To Do
assignee: []
created_date: '2026-08-03 17:36'
updated_date: '2026-08-03 17:37'
labels:
  - 'area:jobs'
  - 'size:M'
dependencies: []
priority: medium
ordinal: 410000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: dependabot PR #1913 showed bullmq 6.0.2 is a breaking major - JobsOptions no longer has repeat (v6 replaces repeatable jobs with the Job Schedulers API, queue.upsertJobScheduler); ai-worker build/typecheck fail on it. Also #1647 tuned WORKER_LOCK_DURATION/maxStalledCount against bullmq 5.80.2 SOURCE (lock auto-renew cadence, stall semantics) - those invariants must be re-verified against v6 internals before upgrading. bullmq majors are dependabot-ignored until this executes.
Fix shape: read the v6 migration guide; convert repeat-option call sites to job schedulers; re-verify the #1647 lock/stall invariant tests against installed v6 source; remove the dependabot ignore in the same PR.
Acceptance: bullmq 6 in the lockfile, all repeatable jobs registered via schedulers, #1647 invariant tests re-grounded, dependabot ignore removed.
<!-- SECTION:DESCRIPTION:END -->
