---
id: TASK-1071
title: >-
  db-sync single-flight is per-environment: a dev-side manual sync can still
  overlap the prod nightly
status: To Do
assignee: []
created_date: '2026-09-24 02:35'
labels:
  - 'area:api-gateway'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1063000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the TASK-1055 guard is a Redis SET NX key (services/api-gateway/src/services/sync/dbSyncSingleFlight.ts). Each environment has its own Redis (services/bot-client/src/services/NightlyDbSyncScheduler.ts module docstring, prod-only paragraph), and both gateways can run db-sync because both carry DEV_DATABASE_URL and PROD_DATABASE_URL (routes/admin/dbSync.ts config check). So a manual /admin db-sync from the dev bot does not see the prod gateway key and can run concurrently with the prod nightly against the same database pair.
Fix shape: hold the guard where both environments can see it. Candidates: a session advisory lock on a DEDICATED non-pooled pg connection to the prod database (released automatically if the process dies; the pooled-Prisma objection does not apply to a dedicated client), or a guard row in a table that is excluded from sync. Verify first that the prod database connection is not behind a transaction-mode pooler, which would break session locks.
Acceptance: a dev-gateway sync started while a prod-gateway sync is running gets 409 DB_SYNC_IN_PROGRESS, and the reverse; a component test pins both.
<!-- SECTION:DESCRIPTION:END -->
