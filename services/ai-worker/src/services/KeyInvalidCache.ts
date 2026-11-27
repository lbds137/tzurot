/**
 * Key-Invalid Cache
 *
 * Tracks OpenRouter accounts whose API key returned a 401 AUTHENTICATION
 * failure so AuthStep can demote that key to the free cascade until the TTL
 * expires or the user updates their wallet key.
 *
 * **Why this exists**: when an OpenRouter BYOK key is invalid or revoked,
 * requests using it return 401 ("Invalid or missing API key"). Caching the
 * invalid-key state per account lets subsequent turns demote that key to the
 * free tier at AuthStep while bounding staleness to the 10-minute default
 * window (one wasted round-trip per window while genuinely bad, plus instant
 * recovery via the wallet-update cache-clear edge).
 *
 * **Cache key shape**: `invalidkey:openrouter:<cacheKeyId>` where `cacheKeyId`
 * is the same opaque scope identifier `CreditExhaustionCache` and
 * `RateLimitCache` use (`user:<discordId>` for a BYOK user's bucket). Only
 * USER buckets are written: the LLMInvoker write site gates on an
 * OpenRouter-routed, user-scoped invocation, so no `system` entry is ever
 * produced and no reader needs to clear one.
 *
 * **Failure modes degrade gracefully**: any Redis error logs a warn and falls
 * through as valid. Cache is a demotion signal, never a hard block on degraded
 * infrastructure.
 *
 * The mark/check/clear mechanics live in the shared `DoomMarkCache` base
 * (also underlies `CreditExhaustionCache`); this class supplies its
 * `DoomMarkCacheConfig` and the invalid-key result vocabulary.
 */

import type { Redis } from 'ioredis';
import { CACHE_KEY_PREFIXES } from '@tzurot/common-types/constants/redis-keys';
import { DoomMarkCache, type DoomCheckOptions, type DoomMarkOptions } from './DoomMarkCache.js';

const KEY_PREFIX = CACHE_KEY_PREFIXES.KEY_INVALID_OPENROUTER;
const DEFAULT_TTL_SECONDS = 10 * 60; // 10 minutes — the fix/rotation staleness bound (see header)

interface InvalidResult {
  invalid: true;
  invalidAtMs: number;
  ttlSeconds: number;
}

interface ValidResult {
  invalid: false;
}

export type KeyInvalidCheckResult = InvalidResult | ValidResult;

export class KeyInvalidCache extends DoomMarkCache {
  constructor(redis: Redis) {
    super(redis, {
      keyPrefix: KEY_PREFIX,
      defaultTtlSeconds: DEFAULT_TTL_SECONDS,
      logNoun: 'invalid-key',
      loggerLabel: 'KeyInvalidCache',
      logTimestampField: 'markedAtIso',
      logFailureSuffix: 'failing open to the user key',
    });
  }

  /**
   * Mark the `cacheKeyId` account key as invalid (default 10 minutes). No-op
   * when `cacheKeyId` is empty (cache opt-out).
   */
  async markKeyInvalid(options: DoomMarkOptions): Promise<void> {
    await this.mark(options);
  }

  /**
   * Check whether the `cacheKeyId` account key is currently marked as invalid.
   * Returns the timestamp the 401 fired + accurate remaining TTL computed
   * against the original write TTL stored in the cache value.
   *
   * Failure modes (cache read throws, malformed value, missing key) return
   * `{ invalid: false }` — better to do an extra real LLM call than to
   * incorrectly demote a request on a degraded cache.
   */
  async isKeyInvalid(options: DoomCheckOptions): Promise<KeyInvalidCheckResult> {
    const result = await this.check(options);
    return result.active
      ? { invalid: true, invalidAtMs: result.atMs, ttlSeconds: result.ttlSeconds }
      : { invalid: false };
  }

  /**
   * Clear the invalid-key mark for `cacheKeyId` — the recovery edge fired
   * from the ApiKey cache-invalidation subscriber when a user sets or
   * updates their wallet key, so a fixed key isn't stranded behind a stale
   * doom-cache until the TTL expires.
   */
  async clearKeyInvalid(options: DoomCheckOptions): Promise<void> {
    await this.clear(options);
  }
}
