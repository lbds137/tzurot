---
id: TASK-585
title: >-
  Dedup Redis client has no commandTimeout, so a fail-closed 503 can hang
  instead
status: To Do
assignee: []
created_date: '2026-08-13 11:54'
labels:
  - 'area:api-gateway'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 585000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the api-gateway dedup cache and rate limiters run over cacheRedis, constructed at index.ts as new Redis(envConfig.REDIS_URL) with NO options. The BullMQ connection sets commandTimeout (30s, REDIS_CONNECTION.COMMAND_TIMEOUT) via createBullMQRedisConfig; this client sets nothing. TASK-556 made Redis a billing-correctness dependency: reserve() now fails CLOSED and the route returns 503. That design assumes a reserve() call either succeeds or REJECTS. With no command bound, a partially-degraded Redis can leave the SET or GET hanging indefinitely, so the route never reaches its catch and never returns the 503 - the request just hangs. Partial degradation is precisely the scenario fail-closed exists for, so the gap sits exactly where the guarantee is supposed to hold.

HAZARD - the obvious one-line fix is wrong. cacheRedis is shared with seven pub/sub cache-invalidation services (CacheInvalidation, ApiKeyCacheInvalidation, LlmConfigCacheInvalidation, TtsConfigCacheInvalidation, SttResolverCacheInvalidation, DenylistCacheInvalidation, ConfigCascadeCacheInvalidation, plus SystemSettingsCacheInvalidation) as well as MaintenanceFlag, OpenRouterModelCache and three rate limiters. Adding a blanket commandTimeout to a connection that also runs SUBSCRIBE risks breaking the subscriber half. Verify how ioredis applies commandTimeout to a subscribed connection BEFORE changing anything.

Fix shape: most likely a SEPARATE ioredis instance for the dedup cache carrying commandTimeout and connectTimeout, leaving the shared pub/sub client alone - not a blanket option on cacheRedis. Note createRedisSocketConfig in common-types utils redis is documented for direct clients but uses the node-redis nested socket shape, not the ioredis flat shape, so it is not a drop-in either.

Acceptance: a hung dedup Redis command surfaces as a bounded 503 rather than a hanging request, and the pub/sub invalidation services still receive messages. Source: PR 2085 review round 6, Medium - pre-existing, index.ts was not in that diff.
<!-- SECTION:DESCRIPTION:END -->
