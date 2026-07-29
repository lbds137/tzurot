---
id: TASK-327
title: Bound the reconcile-off-db sweep
status: Done
assignee: []
created_date: '2026-07-25 00:00'
updated_date: '2026-07-29 14:29'
labels:
  - 'area:jobs'
  - 'origin:review'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 327000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-25 (PR-D1 #1795 claude-review r3, non-blocking) — `RetentionPurgeService.reconcileOffDb` and its `/internal/retention/reconcile-off-db` route walk every unsettled ledger row **sequentially and unbounded**, with one avatar-unlink pass each. Fine today (the ledger gains one row per purged account and the sweep is normally a zero-row no-op), but a long-unreconciled backlog would run the whole queue inside one HTTP request against Railway's ~60s timeout — the same failure mode D2 avoided for the purge itself by making it per-user. **Fix shape**: bound the sweep (`take: N` on `findPendingOffDbRows`, returning a `remaining` count the CLI loops on), mirroring the per-user purge's resumable shape. **Promote when**: a `retention:reconcile-off-db` run reports a nonzero `stillFailing` more than once — that is the only way a backlog accumulates — or the sweep is ever wired to a schedule.

**Why:** The purge endpoint already learned this lesson per-user; the sweep inherited the un-bounded shape because its queue is normally empty.
<!-- SECTION:DESCRIPTION:END -->
