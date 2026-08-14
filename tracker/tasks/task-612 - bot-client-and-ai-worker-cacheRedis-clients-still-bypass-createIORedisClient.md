---
id: TASK-612
title: bot-client and ai-worker cacheRedis clients still bypass createIORedisClient
status: To Do
assignee: []
created_date: '2026-08-14 18:32'
labels:
  - 'area:bot-client'
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 612000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2102 routed api-gateway cacheRedis through createIORedisClient so its commands are bounded by commandTimeout. Two more services build a SECOND, separate cacheRedis the old way and were missed: services/bot-client/src/index.ts:184 (buildCacheRedis) and services/ai-worker/src/index.ts:370, both bare new Redis(envConfig.REDIS_URL!) with no commandTimeout, no connectTimeout, no keepAlive, no IPv6 family. Their CORE client goes through initCoreRedisServices, which is why a first pass read the fleet as consistent.

Found by the PR 2102 reviewer, not by the author. The PR body claimed api-gateway was the only bare construction in the fleet; that claim came from a grep scoped to services/api-gateway/src and was wrong. Corrected in the PR body and commit message before merge.

Hazard differs per service, which is why this was scoped out of 2102 rather than folded in - the fix is identical but the justification is not:
  ai-worker: cacheRedis backs only the pub/sub invalidation services via setupCacheInvalidation. No fail-closed consumer today, so the hung-request-never-reaches-catch scenario does not currently bite. Unbounded, but one new fail-closed consumer away from reproducing it.
  bot-client: cacheRedis backs MaintenanceFlag (self-bounds via its own READ_TIMEOUT_MS and fails OPEN, so not exposed), plus DenylistCache and several nag schedulers. Whether any DenylistCache read gates something fail-closed needs checking before the fix is justified the same way.

Fix shape: replace both with createIORedisClient(url, name, logger), which also subsumes the hand-rolled error handler at each site. Check the eslint-disable non-null-assertion comments still apply afterward. The subscriber-mode invariant the change depends on is already pinned by the never enters subscriber mode tests added in 2102, and both services use the same cache-invalidation classes, so no new test is needed for that property.

Acceptance: no bare new Redis(REDIS_URL) remains in services/ (verify with a fleet-wide grep across services/ AND packages/, not one service directory); both clients carry commandTimeout; the invalidation subscribers still deliver.
<!-- SECTION:DESCRIPTION:END -->
