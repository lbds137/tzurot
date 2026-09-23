---
id: TASK-1055
title: >-
  db-sync has no guard against a concurrent run; the nightly startup retry could
  stack a second sync
status: To Do
assignee: []
created_date: '2026-09-23 14:46'
labels:
  - 'area:api-gateway'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1049000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2488 (TASK-1054) lets the NightlyDbSyncScheduler startup run release its cooldown and retry once after 5 min on a gateway-not-ready failure. Timeout and 504 are excluded because the sync may still be running server-side, but kind network stays retryable (it is the main deploy-window symptom). A proxy dropping the long-lived dbSync connection while the gateway keeps syncing would also read as kind network, release the cooldown, and the retry would start a second real sync against both databases. A grep of services/api-gateway/src/routes/admin/dbSync.ts and services/api-gateway/src/services/sync/ for lock / inProgress / in_progress / running / concurrent / advisory / mutex (2026-09-23, origin/develop) found no concurrent-run guard: the matches were the is_locked column, a regex, and an idempotent-migration test.
Fix shape: a server-side single-flight guard on the dbSync route (a Postgres advisory lock or a Redis NX key held for the run), answering 409 when a sync is already running. The nightly retry then treats 409 as already-running and does not alert. That also covers a manual /admin db-sync overlapping the nightly one.
Acceptance: a second dbSync request while one is in flight gets 409 without touching either database; the nightly scheduler retry on 409 logs and posts nothing; a component test pins the lock release on both success and throw.
<!-- SECTION:DESCRIPTION:END -->
