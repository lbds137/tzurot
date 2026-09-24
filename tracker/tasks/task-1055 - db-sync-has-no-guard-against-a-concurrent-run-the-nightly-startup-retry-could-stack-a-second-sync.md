---
id: TASK-1055
title: >-
  db-sync has no guard against a concurrent run; the nightly startup retry could
  stack a second sync
status: Done
assignee: []
created_date: '2026-09-23 14:46'
updated_date: '2026-09-24 05:49'
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

Second member (claude-review round 5 on PR #2488): ExportSmokeScheduler has the same shape. Its startup retry uses isGatewayUnreachedFailure, which treats kind network as retryable. A connection drop AFTER startExportSmoke enqueued the job reads as network; if that first job completes inside the 5-minute retry window, the retry starts a second real export, because createExportJobOrConflict (services/api-gateway/src/routes/user/account/export.ts) 409s only on a pending or in_progress job. Fix: the export-smoke start route refuses when a smoke job completed within the last few minutes (or the same single-flight key covers start-to-completion), answered as 409, which the scheduler already alerts on.
Third member (same review): the caller contract of isGatewayUnreachedFailure (services/bot-client/src/utils/gatewayNotReady.ts: a route never returns 404/502/503 after starting its side effect) is enforced only by comment. Add a one-line pointer comment at the top of handleDbSync (routes/admin/dbSync.ts) and the export-smoke start handler (routes/internal/exportSmoke.ts) naming the contract, so an edit to either route sees it.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-09-24 05:49
---
Shipped in #2497, rebase-merged to develop at b39cf533d (2026-09-24), after six claude-review rounds; the per-round record is in the PR body. Acceptance: clause 1 is met for WRITING syncs. A dry run is deliberately exempt (round 3): it writes nothing, and making it take the guard let an owner's dry-run preview make the real nightly sync 409 and skip the day. Clauses 2 and 3 are met as written. Second member, owner ruling 2026-09-23 ('Distinct note'): the smoke route's recent-completion 409 carries its own subcode, EXPORT_SMOKE_RECENT_COMPLETION, and the scheduler posts an informational skipped note instead of the failure alert this task originally proposed. Round 4 added a warn line before every guard-unavailable 503, in db-sync and in the retention run lease. The cross-environment gap stays open as TASK-1071.
---
<!-- COMMENTS:END -->
