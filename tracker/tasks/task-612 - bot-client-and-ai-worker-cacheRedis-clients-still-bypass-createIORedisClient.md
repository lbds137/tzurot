---
id: TASK-612
title: bot-client and ai-worker cacheRedis clients still bypass createIORedisClient
status: Done
assignee: []
created_date: '2026-08-14 18:32'
updated_date: '2026-08-28 02:55'
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

CODE SHIPPED in PR 2230; task stays OPEN on the third acceptance clause alone. Clause-by-clause as of 2026-08-26:

  1. no bare new Redis(REDIS_URL) in services/ — MET. Fleet-wide grep across services/ AND packages/ leaves three hits, none of them the banned shape: an api-gateway COMMENT (which doubles as the sweep's positive control), and two tooling sites that pass explicit options objects rather than a bare URL (inspect/bullmqConnection.ts re-bounds maxRetriesPerRequest deliberately for CLI fail-fast; cache/clear-credit-exhaustion.ts sets only family).
  2. both clients carry commandTimeout — MET. createIORedisClient sets it from REDIS_CONNECTION.COMMAND_TIMEOUT (30s).
  3. the invalidation subscribers still deliver — NOT VERIFIED. This is a runtime property and the unit tests mock ioredis, so nothing local can settle it.

Why clause 3 is low-risk but still open: both clients now carry a 30s commandTimeout, and CacheInvalidationService.duplicate()s its client into a pub/sub subscriber, so the subscriber inherits that timeout. api-gateway has run exactly this shape — createIORedisClient handed to CacheInvalidationService — in production since PR 2102, so the shape is prod-proven; it is just not proven for THESE two services. Code-reading says a commandTimeout should not kill a long-lived subscription (SUBSCRIBE completes fast; messages then arrive as push events, not as commands awaiting reply), but that is a code-read, not a runtime observation.

CLOSE WHEN: one post-deploy observation that cross-service invalidation still works — edit a config in one service and confirm another service picks it up rather than serving its cached copy. Filed here rather than left in the PR description because a PR body is not a durable home (PR 2230 review nit, and 10-working-posture.md "Everything not-done gets a disposition").

The reviewer's other nit — createIORedisClient hardcodes family: 6 — is CORRECT AS IS, on merits rather than on its being pre-existing: Railway private networking requires IPv6 and does not support IPv4 for internal service comms (cited at the constant), the value is uniform across every factory-built client including initCoreRedisServices, and it does not break local connections — a local ai-worker test run logged "Connected to Redis" against 127.0.0.1:6379 through this same factory.
<!-- SECTION:DESCRIPTION:END -->
