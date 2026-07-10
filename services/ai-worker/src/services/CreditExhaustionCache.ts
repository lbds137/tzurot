/**
 * Credit-Exhaustion Cache
 *
 * Tracks OpenRouter accounts known to be out of credits so we can short-circuit
 * LLM calls that would otherwise hit a known-failed 402.
 *
 * **Why this exists**: when an OpenRouter BYOK key has zero credits, every
 * request to OpenRouter returns the same 402 ("This account never purchased
 * credits"). The caller fast-fails in ~70-440ms (no retry on PERMANENT
 * errors), but the user typically issues several requests in quick succession
 * before realising — each one a wasted network round-trip. Caching the
 * "account out of credits" state lets us turn each subsequent request into a
 * <100ms synthetic short-circuit.
 *
 * **Distinction from `RateLimitCache`**:
 * - **Scope**: per-account, not per-model. A 402 on one OpenRouter model
 *   means the account has no credits across ALL OpenRouter models.
 * - **TTL**: no provider-supplied reset signal, so the TTL is the ONLY path
 *   by which a credit top-up propagates — a user who tops up stays cached as
 *   broke until expiry. Default 10min bounds that staleness window; the cost
 *   of a shorter TTL is just one doomed 402 round-trip per window while the
 *   account is genuinely empty (the quota fallback serves the turn either
 *   way).
 * - **Semantics**: 402 is a permanent state for the account until the user
 *   tops up; not a time-bounded transient block like 429.
 *
 * **Cache key shape**: `nocredits:openrouter:<cacheKeyId>` where `cacheKeyId`
 * is the same opaque scope identifier `RateLimitCache` uses (`user:<discordId>`
 * for BYOK / `system` for guest-mode). Reuses `deriveCacheKeyId` from
 * `RateLimitCache.ts` rather than relocating to a shared utility — single
 * source of truth, no premature abstraction.
 *
 * **Failure modes degrade gracefully**: any Redis error logs a warn and falls
 * through to the existing retry path. Cache is a performance optimisation,
 * never a correctness gate.
 */

import type { Redis } from 'ioredis';
import { CACHE_KEY_PREFIXES } from '@tzurot/common-types/constants/redis-keys';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('CreditExhaustionCache');

const KEY_PREFIX = CACHE_KEY_PREFIXES.CREDIT_EXHAUSTION_OPENROUTER;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_TTL_SECONDS = 10 * 60; // 10 minutes — the top-up staleness bound (see header)

interface MarkOptions {
  /**
   * Opaque scope identifier for the credit-exhaustion bucket — typically
   * `user:<discordUserId>` for BYOK users or `system` for guest mode /
   * system-key fallback. Empty string opts out of the cache.
   */
  cacheKeyId: string;
  /**
   * Optional TTL override. Defaults to 10 minutes. Clamped to [60s, 24h].
   */
  ttlSeconds?: number;
}

interface CheckOptions {
  cacheKeyId: string;
}

interface ExhaustedResult {
  exhausted: true;
  exhaustedAtMs: number;
  ttlSeconds: number;
}

interface NotExhaustedResult {
  exhausted: false;
}

export type CreditExhaustionCheckResult = ExhaustedResult | NotExhaustedResult;

export class CreditExhaustionCache {
  constructor(private readonly redis: Redis) {}

  /**
   * Mark the `cacheKeyId` account as out of credits for `ttlSeconds` (default
   * 1 hour). Stored value is `JSON.stringify({ ts, ttl })` — the timestamp
   * the 402 fired AND the original write TTL. Storing the TTL alongside the
   * timestamp lets `isCreditExhausted` compute accurate remaining-TTL on
   * read without a second `redis.ttl()` round-trip.
   *
   * No-op when `cacheKeyId` is empty (cache opt-out).
   */
  async markCreditExhausted(options: MarkOptions): Promise<void> {
    const { cacheKeyId, ttlSeconds: rawTtl } = options;
    if (cacheKeyId.length === 0) {
      return;
    }
    const ttlSeconds = clampTtl(rawTtl ?? DEFAULT_TTL_SECONDS);
    const key = buildKey(cacheKeyId);
    const exhaustedAtMs = Date.now();
    const value: StoredValue = { ts: exhaustedAtMs, ttl: ttlSeconds };
    try {
      await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
      logger.info(
        {
          cacheKeyId,
          ttlSeconds,
          exhaustedAtIso: new Date(exhaustedAtMs).toISOString(),
        },
        'Cached credit-exhaustion state'
      );
    } catch (err) {
      logger.warn(
        { err, cacheKeyId },
        'Credit-exhaustion cache write failed — degrading to retry path'
      );
    }
  }

  /**
   * Check whether the `cacheKeyId` account is currently marked as
   * credit-exhausted. Returns the timestamp the 402 fired + accurate
   * remaining TTL computed against the original write TTL stored in the
   * cache value (not against MAX_TTL — that would inflate the reported
   * remaining time by up to 23 hours when the default 1h write is used).
   *
   * Failure modes (cache read throws, malformed value, missing key) return
   * `{ exhausted: false }` — better to do an extra real LLM call than to
   * incorrectly block a request on a degraded cache.
   *
   * **No canonical-truth guard** (unlike `RateLimitCache`): there's no
   * provider-supplied reset timestamp to compare against. The Redis TTL is
   * the only truth — when it expires, the key is gone and the read returns
   * `{ exhausted: false }` naturally.
   */
  async isCreditExhausted(options: CheckOptions): Promise<CreditExhaustionCheckResult> {
    const { cacheKeyId } = options;
    if (cacheKeyId.length === 0) {
      return { exhausted: false };
    }
    const key = buildKey(cacheKeyId);
    try {
      const stored = await this.redis.get(key);
      if (stored === null) {
        return { exhausted: false };
      }
      const parsed = parseStoredValue(stored);
      if (parsed === null) {
        return { exhausted: false };
      }
      // Compute remaining TTL from the original write TTL stored alongside
      // the timestamp. This gives operators an accurate "time until cache
      // self-expires" in the cache-hit log line, regardless of whether the
      // caller used the default 1h TTL or a custom value.
      const elapsedSeconds = Math.floor((Date.now() - parsed.ts) / 1000);
      const ttlSeconds = Math.max(0, parsed.ttl - elapsedSeconds);
      return { exhausted: true, exhaustedAtMs: parsed.ts, ttlSeconds };
    } catch (err) {
      logger.warn(
        { err, cacheKeyId },
        'Credit-exhaustion cache read failed — degrading to retry path'
      );
      return { exhausted: false };
    }
  }

  /**
   * Clear the credit-exhaustion mark for `cacheKeyId`. The recovery edge:
   * fired from the ApiKey cache-invalidation subscriber when a user sets or
   * updates their wallet key, so a top-up isn't stranded behind a stale
   * doom-cache until the TTL expires. Failure is non-fatal — the TTL remains
   * the backstop.
   */
  async clearCreditExhausted(options: CheckOptions): Promise<void> {
    const { cacheKeyId } = options;
    if (cacheKeyId.length === 0) {
      return;
    }
    const key = buildKey(cacheKeyId);
    try {
      const deleted = await this.redis.del(key);
      if (deleted > 0) {
        logger.info({ cacheKeyId }, 'Cleared credit-exhaustion state (wallet key updated)');
      }
    } catch (err) {
      logger.warn(
        { err, cacheKeyId },
        'Credit-exhaustion cache clear failed — TTL remains the backstop'
      );
    }
  }
}

/**
 * Stored cache-value shape. Persisted as JSON to keep both the timestamp
 * (when the 402 fired) and the original write TTL (so reads can compute
 * accurate remaining-time without a second `redis.ttl()` round-trip).
 */
interface StoredValue {
  /** Timestamp the 402 fired, milliseconds since epoch. */
  ts: number;
  /** Original write TTL in seconds, post-clamping. */
  ttl: number;
}

/**
 * Parse a Redis cache value into the structured shape, returning null for
 * malformed values (non-JSON, missing fields, wrong types). Defensive
 * against schema drift if a future operator ever writes the key by hand or
 * if the schema is extended without backward-compatibility shims.
 */
function parseStoredValue(raw: string): StoredValue | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') {
    return null;
  }
  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.ts !== 'number' || typeof candidate.ttl !== 'number') {
    return null;
  }
  if (Number.isNaN(candidate.ts) || Number.isNaN(candidate.ttl)) {
    return null;
  }
  return { ts: candidate.ts, ttl: candidate.ttl };
}

/**
 * Build the Redis key for `cacheKeyId`. Plain string concatenation, no model
 * dimension — credits are account-wide. Format invariant matches
 * `RateLimitCache.buildKey`: the `cacheKeyId` is opaque and never contains a
 * colon in its dynamic segment.
 */
function buildKey(cacheKeyId: string): string {
  return `${KEY_PREFIX}${cacheKeyId}`;
}

function clampTtl(seconds: number): number {
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, seconds));
}
