# Caching Architecture Audit

> Last updated: 2025-12-20

## Executive Summary

Audit of all caching mechanisms in Tzurot v3 to identify horizontal scaling concerns and define consistent patterns.

**Key Finding**: The **channel activation cache** was the only critical scaling issue. ✅ **RESOLVED** - Redis pub/sub invalidation implemented.

**Implementation Status**:

- ✅ Audit completed
- ✅ `ChannelActivationCacheInvalidationService` created
- ✅ Redis channel `cache:channel-activation-invalidation` added
- ✅ bot-client startup subscribes to invalidation events
- ✅ `/channel activate` and `/channel deactivate` publish events
- ✅ Tests added for new service and service registry

---

## Cache Inventory

### In-Memory TTL Caches (bot-client)

| Cache                  | Location                 | TTL    | Max Size      | What It Caches                  | Scaling Risk |
| ---------------------- | ------------------------ | ------ | ------------- | ------------------------------- | ------------ |
| Autocomplete           | `autocompleteCache.ts`   | 60s    | 500 users     | Personalities/personas per user | Minor        |
| **Channel Activation** | `GatewayClient.ts`       | 30s    | 1000 channels | Channel activation status       | **CRITICAL** |
| Notification           | `notificationCache.ts`   | 1 hour | Unbounded     | User notification timestamps    | Minor        |
| Global Config          | `preset/autocomplete.ts` | 60s    | 1 entry       | Global LLM configs              | None         |

### In-Memory TTL Caches (common-types)

| Cache       | Location                | TTL   | Max Size | What It Caches       | Scaling Risk             |
| ----------- | ----------------------- | ----- | -------- | -------------------- | ------------------------ |
| Personality | `PersonalityService.ts` | 5 min | 100      | Loaded personalities | **None** (Redis pub/sub) |

### In-Memory Caches (ai-worker)

| Cache            | Location                    | TTL   | Max Size  | What It Caches          | Scaling Risk            |
| ---------------- | --------------------------- | ----- | --------- | ----------------------- | ----------------------- |
| Model Capability | `ModelCapabilityChecker.ts` | 5 min | Unbounded | Vision capability flags | None (reads from Redis) |

### In-Memory + Redis Hybrid (api-gateway)

| Cache             | Location                  | Memory TTL | Redis TTL | What It Caches             | Scaling Risk              |
| ----------------- | ------------------------- | ---------- | --------- | -------------------------- | ------------------------- |
| OpenRouter Models | `OpenRouterModelCache.ts` | 5 min      | 24 hours  | Model list from OpenRouter | **None** (Redis is truth) |

### Redis-Only Caches

| Cache              | Location                     | TTL    | What It Caches     | Scaling Risk |
| ------------------ | ---------------------------- | ------ | ------------------ | ------------ |
| Vision Description | `VisionDescriptionCache.ts`  | 1 hour | Image descriptions | **None**     |
| Voice Transcript   | `VoiceTranscriptCache.ts`    | 5 min  | Voice transcripts  | **None**     |
| Request Dedup      | `RedisDeduplicationCache.ts` | 5 sec  | Request hashes     | **None**     |

### Redis Pub/Sub (Cross-Instance Invalidation)

| Service            | Location                      | Channel              | What It Invalidates |
| ------------------ | ----------------------------- | -------------------- | ------------------- |
| Cache Invalidation | `CacheInvalidationService.ts` | `cache:invalidation` | Personality cache   |

---

## Detailed Analysis

### ✅ RESOLVED: Channel Activation Cache

**Location**: `services/bot-client/src/utils/GatewayClient.ts:27`

```typescript
const channelActivationCache = new TTLCache<GetChannelActivationResponse>({
  ttl: 30 * 1000, // 30 seconds
  maxSize: 1000,
});
```

**The Problem** (now resolved):

- Used by `ActivatedChannelProcessor` to check if a channel has auto-response enabled
- Each bot-client instance has its own in-memory cache
- When activation changes (via `/channel activate` or `/channel deactivate`):
  - ~~The instance handling the command invalidates its local cache~~
  - ~~**Other instances still have stale data for up to 30 seconds**~~
  - ~~Messages in that channel could be missed or incorrectly handled~~

**Solution Implemented**:

- Created `ChannelActivationCacheInvalidationService` following the existing pattern
- Added Redis channel `CHANNEL_ACTIVATION_CACHE_INVALIDATION`
- bot-client subscribes on startup and handles invalidation events
- `/channel activate` and `/channel deactivate` publish invalidation events after success
- All instances now stay in sync immediately when channels are activated/deactivated

**Files Modified**:

- `packages/common-types/src/constants/queue.ts` - Added Redis channel
- `packages/common-types/src/services/ChannelActivationCacheInvalidationService.ts` - New service
- `services/bot-client/src/index.ts` - Subscription and cleanup
- `services/bot-client/src/services/serviceRegistry.ts` - Service registration
- `services/bot-client/src/commands/channel/activate.ts` - Publish event
- `services/bot-client/src/commands/channel/deactivate.ts` - Publish event

---

### Minor: Autocomplete Cache

**Location**: `services/bot-client/src/utils/autocomplete/autocompleteCache.ts:50`

```typescript
const userCache = new TTLCache<UserAutocompleteData>({
  ttl: 60 * 1000, // 60 seconds
  maxSize: 500,
});
```

**The Situation**:

- Caches personality/persona lists for Discord autocomplete
- Each instance has its own cache
- When user creates/deletes a persona, other instances have stale data

**Why It's Minor**:

- 60 seconds max staleness for autocomplete is acceptable UX
- Worst case: autocomplete shows stale options briefly
- Not a correctness issue - command will fail gracefully if user selects deleted item

**Recommendation**: Leave as-is, or consider pub/sub if UX complaints arise

---

### Minor: Notification Cache

**Location**: `services/bot-client/src/processors/notificationCache.ts:14`

```typescript
const notificationCache = new Map<string, number>();
```

**The Situation**:

- Rate-limits notifications about private personality access
- Each instance tracks independently
- Different instances might send duplicate notifications

**Why It's Minor**:

- Extra notification is annoying but harmless
- Not a data correctness issue
- 1-hour cooldown means duplicates are rare in practice

**Recommendation**: Leave as-is (local is actually better for this use case)

---

### Already Solved: Personality Cache

**Location**: `packages/common-types/src/services/personality/PersonalityService.ts:27`

```typescript
this.cache = new TTLCache({
  ttl: TIMEOUTS.CACHE_TTL, // 5 minutes
  maxSize: 100,
});
```

**The Solution**:

- `CacheInvalidationService` provides Redis pub/sub invalidation
- When LLM configs change, all instances receive invalidation event
- Each instance clears its local cache on event receipt

**This pattern should be applied to channel activation cache.**

---

### No Action Needed

1. **OpenRouterModelCache**: Redis is source of truth, memory cache is optimization
2. **ModelCapabilityChecker**: Reads from Redis, memory cache is local optimization
3. **VisionDescriptionCache**: Redis-backed, shared across instances
4. **VoiceTranscriptCache**: Redis-backed, shared across instances
5. **RedisDeduplicationCache**: Redis-backed, shared across instances
6. **Global Config Cache**: Single entry, rare changes, 60s staleness acceptable

---

## HTTP Agent Investigation

**Finding**: No explicit HTTP agent configuration found in the codebase.

- Uses Node.js default fetch behavior
- Connection pooling is automatic via Node.js undici
- Discord.js uses its own HTTP handling (REST API + WebSocket)

**Potential Concern**:

- Gateway HTTP calls and Discord REST API may share connection pools
- Under high load, one could starve the other

**Recommendation**: Low priority. Only investigate if connection issues arise under load.

---

## Recommendations

### ✅ Priority 1: Channel Activation Cache Invalidation - COMPLETE

**Goal**: Add Redis pub/sub invalidation for channel activation changes

**Implementation** (completed):

1. ✅ Created `ChannelActivationCacheInvalidationService` (similar to `CacheInvalidationService`)
2. ✅ Publish invalidation event when `/channel activate` or `/channel deactivate` runs
3. ✅ Subscribe in bot-client startup
4. ✅ Invalidate local cache on event receipt
5. ✅ Tests added

**Effort**: ~2 hours (actual: as estimated)
**Risk**: Low (follows existing pattern)

### Priority 2: Document Caching Patterns (This Document)

**Goal**: Codify when to use each caching approach

| Use Case                               | Pattern                      | Example               |
| -------------------------------------- | ---------------------------- | --------------------- |
| Shared state (correctness matters)     | Redis + pub/sub invalidation | Channel activations   |
| Expensive external API                 | Redis with TTL               | OpenRouter models     |
| Local optimization (reads from Redis)  | In-memory with TTL           | Model capabilities    |
| UX optimization (staleness acceptable) | In-memory TTL only           | Autocomplete          |
| Rate limiting (local is correct)       | In-memory Map                | Notification cooldown |

### Priority 3: HTTP Agent Isolation (Optional)

**Goal**: Investigate connection pool isolation

**When**: Only if HTTP connection issues arise under load

---

## Cache Invalidation Strategies

| Cache Type          | Invalidation Method | When           |
| ------------------- | ------------------- | -------------- |
| Redis-backed        | TTL expiry          | Automatic      |
| In-memory + pub/sub | Redis pub/sub event | On data change |
| In-memory TTL only  | TTL expiry          | Automatic      |
| In-memory Map       | Periodic cleanup    | On interval    |

---

## Future Considerations

### If Running Multiple bot-client Instances

1. **Must do**: Implement channel activation pub/sub
2. **Should do**: Consider autocomplete pub/sub
3. **Can skip**: Notification cache (local is fine)

### If Adding New Caches

Decision tree:

1. Does staleness cause incorrect behavior? → Redis + pub/sub
2. Is it expensive external API data? → Redis with TTL
3. Is it read-heavy optimization? → In-memory with TTL
4. Is it rate limiting? → In-memory Map (local is correct)
