---
id: TASK-40
title: Watch tightened fast-pool ladder label rates post-deploy
status: To Do
assignee: []
created_date: '2026-07-01 00:00'
updated_date: '2026-07-28 10:46'
labels:
  - 'origin:review'
  - 'area:db'
  - 'size:S'
dependencies: []
priority: low
ordinal: 40000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Watch the tightened fast-pool ladder's label rates post-deploy (statement 5s→2s, lock 2s→1s)

**Why:** #1423 tightened the fast-pool ladder to `lock 1s < statement 2s < query 3s` so the dead-conn retry fires in ~3s. The persist is a single-row INSERT (<100ms), so 2s statement / 1s lock have huge margin for the common case — but the tighter budget hasn't been validated under real CONTENTION (e.g. a burst of concurrent writes into the same channel). The beta.138 SQLSTATE self-labeling makes this cheap to check. **Watch**: after #1423 reaches prod, grep the gateway logs for `label="statement-timeout"` / `label="lock-timeout"` on the persist routes — a nonzero rate means the tighter budget clipped a legit-but-slow op under load and should be relaxed (bump `DB_FAST_STATEMENT_TIMEOUT_MS`/`DB_FAST_LOCK_TIMEOUT_MS`, both env-overridable). **Promote when**: a `statement-timeout`/`lock-timeout` label appears in prod (previously only `query-timeout-or-dead-conn` did). Surfaced 2026-07-01 (PR #1423 review, non-blocking observation).
<!-- SECTION:DESCRIPTION:END -->
