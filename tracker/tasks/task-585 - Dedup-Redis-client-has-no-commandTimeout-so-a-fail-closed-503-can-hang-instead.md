---
id: TASK-585
title: >-
  Dedup Redis client has no commandTimeout, so a fail-closed 503 can hang
  instead
status: Done
assignee: []
created_date: '2026-08-13 11:54'
updated_date: '2026-08-14 19:16'
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

Fix shape (ORIGINAL, now superseded — kept for the reasoning): most likely a SEPARATE ioredis instance for the dedup cache carrying commandTimeout and connectTimeout, leaving the shared pub/sub client alone - not a blanket option on cacheRedis. Note createRedisSocketConfig in common-types utils redis is documented for direct clients but uses the node-redis nested socket shape, not the ioredis flat shape, so it is not a drop-in either.

HAZARD FALSIFIED BY PROBE — the separate instance is NOT needed. Probed against local ioredis 5.11.1 and a live redis, three questions:
  Q1 duplicate() inherits commandTimeout — YES (base 300ms, duplicate reports 300ms).
  Q2 an idle subscriber carrying that inherited timeout still receives messages after sitting idle 4x past the window — YES, message delivered.
  Q3 commandTimeout actually bounds a hang — YES, an infinite BLPOP rejected at 301ms with "Command timed out" rather than hanging.

So the feared breakage does not occur, and the reason is structural: CacheInvalidationService line 80 does `this.subscriber = this.redis.duplicate()`, so cacheRedis itself never enters subscriber mode, and an established subscription is not a pending command for a command timeout to interrupt. The option is inherited but inert on the subscriber half.

Also swept: no long-blocking command (blpop/brpop/blmove/brpoplpush/bzpopmin/bzpopmax/xread/wait) is issued anywhere in services/api-gateway/src or packages/cache-invalidation/src, so no legitimate consumer would be cut off by a bounded command. The sweep pattern was positive-controlled — the same regex shape matches 40 real setex/expire/incr/publish call sites.

REVISED FIX: add commandTimeout (REDIS_CONNECTION.COMMAND_TIMEOUT) and connectTimeout to the `new Redis(envConfig.REDIS_URL)` construction at services/api-gateway/src/index.ts:166. No separate instance, no new client to wire through. Resize from M toward S.

Acceptance unchanged, plus: keep a test that pins the subscriber-still-delivers property, since that is the invariant the one-line change depends on and it is not obvious from reading the call site.

Acceptance: a hung dedup Redis command surfaces as a bounded 503 rather than a hanging request, and the pub/sub invalidation services still receive messages. Source: PR 2085 review round 6, Medium - pre-existing, index.ts was not in that diff.
<!-- SECTION:DESCRIPTION:END -->
