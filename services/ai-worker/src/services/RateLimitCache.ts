/**
 * Rate-Limit Cache
 *
 * Tracks active OpenRouter rate-limit windows in Redis so we can short-circuit
 * LLM calls that would otherwise hit a known-exhausted quota.
 *
 * **Why this exists**: when OpenRouter's daily-quota fires (`429 Rate limit
 * exceeded: free-models-per-day-high-balance`), the LangChain retry path
 * spends ~80s × 3 attempts before failing — each attempt also burns daily
 * quota tokens. The reset header (`X-RateLimit-Reset`) tells us exactly when
 * the window expires; caching it lets us turn 4-5min user-facing latency
 * into <100ms fast-fail until the quota resets.
 *
 * **Cache key shape**: `ratelimit:openrouter:<cacheKeyId>:<model>` where
 * `cacheKeyId` is an opaque, non-credential identifier provided by the
 * caller — typically `user:<discordUserId>` for BYOK users or `system` for
 * guest mode / system-key fallback. The cache never hashes or otherwise
 * fingerprints the actual API key; the caller is responsible for choosing
 * a `cacheKeyId` that correctly isolates rate-limit buckets.
 *
 * **The `system` bucket is shared across all guest-mode users.** When the
 * system key exhausts the daily quota on a given model, every guest-mode
 * call to that model short-circuits until reset. This is the correct
 * behavior (shared quota → shared block) but worth flagging for operators
 * investigating "why is everyone blocked when only one guest hit the limit."
 *
 * **Why no hashing**: an earlier implementation (PR #943, pre-refactor) used
 * SHA-256 / HMAC of the API key as the fingerprint. CodeQL's
 * `js/insufficient-password-hash` rule flagged it as a hashed-credential
 * pattern, even though the use case wasn't authentication. Rather than
 * suppress the alert, this implementation removes the sink entirely: no
 * crypto primitives, no credential-tainted dataflow into a hash function.
 * The cache identifier is now the caller's chosen scope (user ID or
 * 'system'), which carries no credential-tainted information.
 *
 * **Failure modes degrade gracefully**: any Redis error logs a warn and
 * falls through to the existing retry path. The cache is a performance
 * optimization, never a correctness gate.
 */

import type { Redis } from 'ioredis';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('RateLimitCache');

const KEY_PREFIX = 'ratelimit:openrouter:';
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 24 * 60 * 60;

interface MarkOptions {
  /**
   * Opaque scope identifier for the rate-limit bucket — typically
   * `user:<discordUserId>` for BYOK users or `system` for guest mode /
   * system-key fallback. NOT derived from the API key value.
   */
  cacheKeyId: string;
  model: string;
  resetTimestampMs: number;
}

interface CheckOptions {
  cacheKeyId: string;
  model: string;
}

interface RateLimitedResult {
  rateLimited: true;
  resetMs: number;
  ttlSeconds: number;
}

interface NotLimitedResult {
  rateLimited: false;
}

export type RateLimitCheckResult = RateLimitedResult | NotLimitedResult;

export class RateLimitCache {
  constructor(private readonly redis: Redis) {}

  /**
   * Mark `(cacheKeyId, model)` as rate-limited until `resetTimestampMs`.
   * TTL is clamped to [60s, 24h] so a malformed reset can't block forever
   * or evaporate immediately.
   */
  async markRateLimited(options: MarkOptions): Promise<void> {
    const { cacheKeyId, model, resetTimestampMs } = options;
    const rawTtlSeconds = Math.floor((resetTimestampMs - Date.now()) / 1000);
    if (rawTtlSeconds <= 0) {
      logger.warn(
        { model, resetTimestampMs },
        'Rate-limit reset is in the past — skipping cache write'
      );
      return;
    }
    const ttlSeconds = clampTtl(rawTtlSeconds);
    const key = buildKey(cacheKeyId, model);
    try {
      await this.redis.setex(key, ttlSeconds, String(resetTimestampMs));
      logger.info(
        {
          cacheKeyId,
          model,
          ttlSeconds,
          resetIso: new Date(resetTimestampMs).toISOString(),
        },
        'Cached rate-limit state'
      );
    } catch (err) {
      logger.warn({ err, model }, 'Rate-limit cache write failed — degrading to retry path');
    }
  }

  /**
   * Check whether `(cacheKeyId, model)` is currently rate-limited per the cache.
   * Returns the reset timestamp + remaining TTL when limited, so callers can
   * surface the wait time to users if desired.
   *
   * Failure modes (cache read throws, malformed value) return
   * `{ rateLimited: false }` — better to do an extra real LLM call than
   * to incorrectly block a request on a degraded cache.
   *
   * **One Redis round-trip per check**: only `GET` is called. The `ttlSeconds`
   * field is computed from the cached `resetMs` (the canonical truth) rather
   * than queried via `redis.ttl()` — this saves a network hop on every
   * rate-limited request and removes a GET/TTL race window where the cached
   * key could expire between the two commands.
   */
  async isRateLimited(options: CheckOptions): Promise<RateLimitCheckResult> {
    const { cacheKeyId, model } = options;
    const key = buildKey(cacheKeyId, model);
    try {
      const stored = await this.redis.get(key);
      if (stored === null) {
        return { rateLimited: false };
      }
      const resetMs = Number(stored);
      if (Number.isNaN(resetMs)) {
        return { rateLimited: false };
      }
      // Treat the cached resetMs as the canonical truth. If the reset has
      // already passed (e.g., a clock-skew window made the cache linger past
      // its real expiry), the real provider would accept the call now —
      // short-circuiting on a stale cached value would block a request that
      // should succeed.
      const nowMs = Date.now();
      if (resetMs < nowMs) {
        return { rateLimited: false };
      }
      const ttlSeconds = Math.floor((resetMs - nowMs) / 1000);
      return { rateLimited: true, resetMs, ttlSeconds };
    } catch (err) {
      logger.warn({ err, model }, 'Rate-limit cache read failed — degrading to retry path');
      return { rateLimited: false };
    }
  }
}

/**
 * Build the Redis key for `(cacheKeyId, model)`.
 *
 * Plain string concatenation — no hashing, no crypto primitives. The
 * `cacheKeyId` is an opaque scope identifier provided by the caller (e.g.,
 * `user:<discordId>` or `system`), chosen to correctly isolate rate-limit
 * buckets without being derived from any credential value.
 *
 * **Format invariant**: `cacheKeyId` is always either the literal string
 * `system` or `user:<snowflake>` where `<snowflake>` is a numeric Discord ID
 * (no colons). Model identifiers carry their own `:` separator (e.g.,
 * `z-ai/glm-4.5-air:free`); the resulting key has multiple `:` segments but
 * is unambiguous because the prefix-segment shape is fixed. Future callers
 * extending `cacheKeyId` to non-numeric scopes must preserve the no-colon
 * invariant in the dynamic segment to avoid key-shape ambiguity.
 */
function buildKey(cacheKeyId: string, model: string): string {
  return `${KEY_PREFIX}${cacheKeyId}:${model}`;
}

function clampTtl(seconds: number): number {
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, seconds));
}

/**
 * Derive a cache scope identifier from auth context. Use `user:<discordId>`
 * when the caller has BYOK auth (their personal OpenRouter quota), `system`
 * for guest mode / system-key fallback (shared pool). The identifier is
 * intentionally not derived from the raw API key — see the file header for
 * the rationale.
 *
 * **BYOK + empty userId returns `''` (skip-cache), not `'system'`.** Pooling
 * an unknown BYOK caller into the shared system bucket would cross account
 * boundaries: a BYOK user who exhausted their personal quota would block
 * guest-mode users, and a system-key exhaustion would falsely block them.
 * In practice `userId` is always populated for authenticated Discord users,
 * so this branch is defensive — opting out of the cache is strictly safer
 * than risking cross-account false-blocks. The empty-string sentinel is
 * recognized by `LLMInvoker.invokeWithRetry`'s cache-skip guard.
 */
export function deriveCacheKeyId(userApiKey: string | undefined, userId: string): string {
  const hasByokKey = userApiKey !== undefined && userApiKey.length > 0;
  if (hasByokKey) {
    return userId.length > 0 ? `user:${userId}` : '';
  }
  return 'system';
}
