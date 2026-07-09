/**
 * Redis cache-key prefixes shared by services and ops tooling. Centralised
 * here so a rename can't silently desync the runtime cache writer from the
 * operator `DEL` tooling — the previous duplication had no compile-time
 * signal that the two literals had to match.
 *
 * Every prefix ends with `:` so callers concatenate the dynamic identifier
 * directly. The `cacheKeyId` segment follows its producer's no-colon
 * invariant — see `RateLimitCache.assertValidCacheKeyId` for the
 * runtime-enforced grammar. List every reader/writer in a `<consumer>` doc
 * line when adding a prefix.
 */
export const CACHE_KEY_PREFIXES = {
  /**
   * Per-(account, model) rate-limit window cache for OpenRouter 429s.
   * Consumers: `ai-worker/RateLimitCache`.
   */
  RATE_LIMIT_OPENROUTER: 'ratelimit:openrouter:',
  /**
   * Per-account credit-exhaustion cache for OpenRouter 402s.
   * Consumers: `ai-worker/CreditExhaustionCache`, `tooling/cache/clear-credit-exhaustion`.
   */
  CREDIT_EXHAUSTION_OPENROUTER: 'nocredits:openrouter:',
  /**
   * Per-(user, UTC-day) counter capping how many times an authenticated user may
   * fall back to the free vision model on the SYSTEM OpenRouter key in a day.
   * Bounds the freeloading surface opened by the broad vision free-fallback.
   * Consumers: `ai-worker/VisionFallbackQuota`.
   */
  VISION_SYSTEM_FALLBACK_QUOTA: 'visionfallback:system:',
  /**
   * Rolling-window contention set for the shared-free-key fair-share quota — a
   * ZSET of userId→last-request-ms for users who consumed the free key within
   * the window. Its cardinality is the divisor N that shrinks each user's cap.
   * A single set (prefix + a fixed suffix; see `FREE_TIER_ACTIVE_KEY`).
   * Consumers: `ai-worker/FreeTierRequestQuota`.
   */
  FREE_TIER_ACTIVE: 'freeq:active:',
  /**
   * Per-user rolling request set for the shared-free-key quota — a ZSET of
   * requestId→ms for one user's recent free-key requests (requestId membership
   * makes counting idempotent across job retries). Prefix + userId.
   * Consumers: `ai-worker/FreeTierRequestQuota`.
   */
  FREE_TIER_USER_REQUESTS: 'freeq:ureq:',
  /**
   * Per-UTC-day global counter for the shared-free-key quota — the absolute
   * key-protection ceiling (INCR per allowed request, 25h TTL). Prefix + day.
   * Consumers: `ai-worker/FreeTierRequestQuota`.
   */
  FREE_TIER_GLOBAL: 'freeq:global:',
  /**
   * Per-(channel, personality) turn counter + pending episode-id list driving
   * extraction batching (memory Phase 2). Consumers: `ai-worker` extraction
   * trigger (slice 2).
   */
  FACT_EXTRACTION_COUNTER: 'factextract:counter:',
  /**
   * Per-(personality, UTC-day) extraction budget counter — the cost tripwire
   * that auto-throttles extraction (memory Phase 2 §3.8). Consumers:
   * `ai-worker` extraction worker (slice 2).
   */
  FACT_EXTRACTION_BUDGET: 'factextract:budget:',
} as const;

/**
 * Maintenance-mode flag — a singleton key (no dynamic suffix, hence not in
 * CACHE_KEY_PREFIXES). Present ⇒ maintenance active; value = ISO timestamp of
 * enable time. Consumers: `common-types/MaintenanceFlag` (read/write; used by
 * bot-client, api-gateway, and the `pnpm ops maintenance` command).
 */
export const MAINTENANCE_FLAG_KEY = 'maintenance:enabled';
