---
id: TASK-742
title: Admin db-sync bulk-writes users.default_persona_id with no cache invalidation
status: Done
assignee: []
created_date: '2026-08-23 04:02'
updated_date: '2026-08-23 13:36'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 742000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: found by the TASK-739 sibling sweep (PR #2190). POST /api/admin/db-sync (services/api-gateway/src/routes/admin/dbSync.ts:71 -> DatabaseSyncService -> sync/config/syncTables.ts:118-127) bulk-writes users rows including default_persona_id via raw SQL and evicts nothing from the UserService provisioning cache in either environment. After a sync, any user whose default changed on the other side keeps a stale cached entry (up to the 1h TTL) - and per TASK-739, a stale entry does not just serve an old value, it gates the set-default write.

Fix shape: after a sync run that touched the users table, call clearCache() on the local UserService (getOrCreateUserService) and broadcast an invalidate-all via UserCacheInvalidationService (the event type "all" already exists - ai-worker handles it in cacheInvalidation.ts). Per-user eviction is wrong here: the sync is bulk and the changed-row set is not cheaply enumerable.

Acceptance: a sync that writes users triggers clearCache locally plus the "all" broadcast, asserted at the seam in the sync service tests; syncs that do not touch users trigger neither.
<!-- SECTION:DESCRIPTION:END -->
