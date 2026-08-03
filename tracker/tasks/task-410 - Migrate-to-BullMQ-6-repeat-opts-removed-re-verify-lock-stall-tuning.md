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
Scope addition (2026-08-03): ioredis 6 rides this migration. bullmq 5.x hard-pins ioredis 5.11.1 (a direct ioredis 6 bump dual-installs and type-clashes at the shared-connection seam), while bullmq 6 takes ioredis as a peer (>=5.0.0) - so both majors upgrade in the same PR. Both are ignored twice: dependabot.yml entries AND server-side chat-command ignores on PR #1919 (config alone was inert - dependabot reads dependabot.yml from main, not develop).
Fix shape: read the v6 migration guide; convert repeat-option call sites to job schedulers; bump ioredis to 6.x alongside; re-verify the #1647 lock/stall invariant tests against installed v6 source; remove BOTH dependabot.yml ignore entries AND comment "@dependabot unignore bullmq major version" + "@dependabot unignore ioredis major version" on any open dependabot PR in the same cycle.
Acceptance: bullmq 6 + ioredis 6 in the lockfile, all repeatable jobs registered via schedulers, #1647 invariant tests re-grounded, all four ignores (2 config + 2 server-side) removed.
<!-- SECTION:DESCRIPTION:END -->
