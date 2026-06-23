# Cache Duration Rationale

Why each cache in the codebase has the TTL and memory bound it does. The goal is
that no TTL is a mystery constant: every duration traces to a property of the
data being cached.

## How we pick a TTL

A cache duration is a function of three things:

1. **How long the cached value stays correct** — the natural validity window of
   the underlying data (a transcript for an immutable attachment is valid
   forever; a user's config is valid until they change it).
2. **How staleness is corrected** — TTL-only, or TTL _plus_ eager invalidation
   (Redis pub/sub). When eager invalidation exists, the TTL is only a backstop
   for the rare missed event, so it can be short without hurting hit-rate logic
   and short is _safer_ (a missed invalidation self-heals faster).
3. **The memory cost of holding it** — the dominant constraint for this project.
   Every in-memory cache MUST be bounded (a `maxSize`/LRU or a fixed key space).
   Redis-backed caches self-evict on TTL, so their memory is bounded by
   `entries × value-size × TTL`; we keep values small and TTLs proportionate.

**The memory rule (project-specific):** the failure mode we most want to avoid is
a cache that accumulates unbounded data and degrades the process. So: no raw
`Map` cache without an eviction bound. Use the shared
[`TTLCache`](../../../packages/common-types/src/utils/TTLCache.ts) (LRU
`maxSize` + expiry-on-access) unless there's a specific reason not to.

## Rationale classes

Most caches fall into one of these classes. The TTL follows from the class.

### 1. External data keyed by a content-stable key

TTL = how long the external data is valid. The key must be **content-stable** so
re-fetches hit the same entry.

| Cache                              | TTL     | Why                                                                                                                                                                                                                                                                      |
| ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VoiceTranscriptCache`             | **1h**  | Transcript of an immutable Discord attachment — valid as long as the attachment exists. Keyed via [`deriveAttachmentCacheKey`](../../../packages/common-types/src/utils/attachmentCacheKey.ts) (query-stripped CDN path), so re-signed URLs hit. Value is a tiny string. |
| `VisionDescriptionCache` (success) | **1h**  | Same shape as voice: description of an immutable attachment, content-stable key (attachment id → query-stripped URL hash).                                                                                                                                               |
| `OpenRouterModelCache` (Redis)     | **24h** | The OpenRouter model catalog changes ~daily; 24h bounds the upstream API budget. A 5-min in-memory L1 tier sits in front to avoid per-request Redis round-trips.                                                                                                         |

**Key stability is load-bearing here.** Before #1315, `VoiceTranscriptCache` keyed
on the _full signed_ CDN URL; Discord re-signs `?ex=&is=&hs=` on every re-fetch,
so the same audio missed every time. The fix (shared with the vision cache) is to
strip the signature query before hashing — the path already embeds the immutable
attachment id.

### 2. Config caches behind eager pub/sub invalidation (short TTL = backstop)

These resolve user/personality/channel configuration. They are invalidated
**eagerly** on every write via Redis pub/sub (wired in
[`cacheInvalidation.ts`](../../../services/ai-worker/src/cacheInvalidation.ts) and
api-gateway's `index.ts`). The short TTL is therefore **not** the primary
correctness mechanism — it's a backstop for the rare dropped pub/sub event, and
short is deliberate: a missed invalidation self-heals within the TTL. Re-resolution
is a cheap indexed point-lookup, so a short TTL is not a DB-load problem either.

| Cache                                             | TTL        | Invalidation                                                                     |
| ------------------------------------------------- | ---------- | -------------------------------------------------------------------------------- |
| config-resolver `BaseConfigResolver` (Llm/Tts)    | 10s        | pub/sub per-user + per-config + clear-all                                        |
| `ConfigCascadeResolver`                           | 10s        | pub/sub user/channel/personality/admin/all                                       |
| `SttResolver`                                     | 10s        | pub/sub per-user + all                                                           |
| `ApiKeyResolver`                                  | 10s        | pub/sub per-user + all                                                           |
| identity `BaseConfigResolver` (`PersonaResolver`) | 10s        | pub/sub per-user + all                                                           |
| `PersonalityService`                              | 5min       | pub/sub (`CacheInvalidationService`)                                             |
| `HttpPersonalityLoader` (positive / negative)     | 5min / 60s | pub/sub + prefix; negative tier shorter so new personalities appear fast         |
| Channel / Admin settings (bot-client)             | 30s / 60s  | pub/sub via `ChannelActivationCacheInvalidationService`                          |
| `UserService`                                     | 1h         | TTL-only; 1h bounds eventual consistency of provisioning rows that change rarely |

**Decision: the 10s config TTL is kept, not lengthened.** Lengthening it would
trade a negligible DB saving for a longer missed-event staleness window
(a just-changed model/provider not taking effect). The short backstop is correct.
(`ApiKeyResolver` at 10s additionally bounds how long a revoked key could survive
a missed invalidation — another reason not to lengthen.)

### 3. Negative / cooldown caches

TTL = how long to back off before retrying a failed operation.

| Cache                                | TTL                                | Why                                                                                                                                                                           |
| ------------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VisionDescriptionCache` (failure)   | 5 / 10 / 60min                     | Per-category: transient failures (auth/quota) get short cooldowns so they recover fast; attachment-bound failures (content-policy, dead URL) get 60min to avoid re-hammering. |
| `RateLimitCache`                     | dynamic (resetMs, clamped 60s–24h) | Caches the provider's _own_ reset timestamp from a 429, so a hit knows the exact remaining time.                                                                              |
| `CreditExhaustionCache`              | 1h (configurable 60s–24h)          | 402 account-wide cooldown; 1h re-check window.                                                                                                                                |
| ElevenLabs / Mistral negative caches | 5min                               | Cooldown after a clone/registration failure to prevent retry storms on transient outages.                                                                                     |

### 4. Dedup / rate-limit windows

TTL = the length of the window being deduplicated.

| Cache                                              | TTL     | Why                                                                            |
| -------------------------------------------------- | ------- | ------------------------------------------------------------------------------ |
| `RedisDeduplicationCache`                          | 5s      | The user keystroke / accidental-resend window for duplicate AI job submission. |
| Notification cooldown (private-personality access) | 1h      | One notification per channel+user per hour.                                    |
| Autocomplete (fresh tier)                          | 30s–60s | Covers a single autocomplete interaction; next keystroke re-fetches.           |

### 5. Provider voice-clone caches

| Cache                             | TTL   | Why                                                                                                          |
| --------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------ |
| ElevenLabs / Mistral clone caches | 30min | Voice-clone identity stability window for the provider; an eviction-mutex prevents concurrent double-writes. |

## Deliberately unbounded (and why that's acceptable)

A handful of in-memory caches have **no `maxSize`** by design. Each is bounded by
something other than an LRU cap, so it is not a growth risk:

- **`DenylistCache`** — nested `Map`s hydrated from the gateway (≈10k-entry cap)
  and kept in sync by pub/sub. Bounded by the gateway's denylist size, not by
  request traffic.
- **Notification cooldown `Map`** — bounded by a 1h periodic sweep of expired
  entries; key space is (channel × user) that hit the private-personality path.
- **Autocomplete stale tier** — a 500-entry FIFO (bounded by count, not TTL); it
  is intentionally TTL-less so it can serve last-known-good during a backend
  outage.

If you add an in-memory cache that does NOT fall into one of these patterns, it
needs an explicit bound — prefer `TTLCache`.

## Decisions recorded in the cache-duration audit

- **`VoiceTranscriptCache`: volatile signed-URL key → stable key; 5min → 1h TTL**
  (#1315). The volatile key caused near-total cache misses; the longer TTL is
  pure upside once the key is content-stable. Shared `deriveAttachmentCacheKey`
  now backs both the voice and vision caches so they can't drift.
- **identity `BaseConfigResolver` + `ModelCapabilityChecker`: raw `Map` →
  `TTLCache`** (#1316). Both were unbounded; the identity one also ran a
  `setInterval` cleanup flagged in-code as a horizontal-scaling blocker. The swap
  bounds memory (LRU `maxSize` 1000 / 500) and deletes the interval. (The two
  `BaseConfigResolver` classes — config-resolver's row-cascade and identity's
  persona-selection — now both use `TTLCache`, but they stay distinct
  abstractions: the "dedup" follow-up was already verified obsolete on different
  generics + cascade shapes, and aligning the cache mechanism doesn't change that.)
- **config-resolver 10s TTL: kept** — verified it sits behind comprehensive
  eager pub/sub invalidation, so it's a justified backstop, not a defect (see
  class 2).
- **config-resolver `maxSize` (TTLCache default 100): kept** — a deliberate
  memory-conservative choice; tunable later if hit-rate (not memory) becomes the
  concern.

## Adding a new cache

1. Which rationale class does it fall into? The class sets the TTL.
2. Is it invalidated eagerly (pub/sub)? If yes, the TTL is a backstop and can be
   short. If no, the TTL alone bounds staleness — size it to the data's validity.
3. In-memory? It MUST be bounded. Use `TTLCache` (`ttl` + `maxSize`) unless it's
   one of the documented unbounded patterns above.
4. Add a one-line rationale comment at the TTL constant and a row here.
