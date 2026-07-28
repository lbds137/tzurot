---
id: TASK-175
title: >-
  Document the "pooler strips options → gateway boot fails" caveat for the fast
  pool
status: To Do
assignee: []
created_date: '2026-06-25 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:db'
  - 'area:docs'
  - 'size:S'
dependencies: []
priority: low
ordinal: 175000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Document the "pooler strips `options` → gateway boot fails" caveat for the fast pool

**Why:** The fast-pool timeouts (#1343) set `statement_timeout`/`lock_timeout` via the Postgres `options` startup string, and `verifyPoolTimeouts` deliberately FAILS gateway boot if they didn't apply. Intentional (loud failure beats silently reverting to the silent-hang bug), but a future deployer who fronts the gateway's DB with a pooler that strips startup params (PgBouncer txn-mode, Prisma Accelerate, pgpool) would hit a mysterious boot crash. **Fix shape**: note the caveat in `FAST_POOL_DEFAULTS`/`fastPoolConnectionOptions` JSDoc (`poolConfig.ts`) + the deployment runbook (`docs/reference/deployment/`). **Promote when**: a connection pooler is added to the gateway's DB path, OR a deployment-runbook pass. Surfaced 2026-06-25 by PR #1343 round-2 claude-review.
<!-- SECTION:DESCRIPTION:END -->
