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
 *
 * The mark/check/clear mechanics live in the shared `DoomMarkCache` base
 * (also underlies `KeyInvalidCache`); this class supplies its
 * `DoomMarkCacheConfig` and the credit-exhaustion result vocabulary.
 */

import type { Redis } from 'ioredis';
import {
  ApiErrorCategory,
  ApiErrorType,
  USER_ERROR_MESSAGES,
} from '@tzurot/common-types/constants/error';
import { CACHE_KEY_PREFIXES } from '@tzurot/common-types/constants/redis-keys';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { ApiError, parseApiError } from '../utils/apiErrorParser.js';
import { DoomMarkCache } from './DoomMarkCache.js';

const logger = createLogger('CreditExhaustionCache');

const KEY_PREFIX = CACHE_KEY_PREFIXES.CREDIT_EXHAUSTION_OPENROUTER;
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

export class CreditExhaustionCache extends DoomMarkCache {
  constructor(redis: Redis) {
    super(redis, {
      keyPrefix: KEY_PREFIX,
      defaultTtlSeconds: DEFAULT_TTL_SECONDS,
      logNoun: 'credit-exhaustion',
      loggerLabel: 'CreditExhaustionCache',
      logTimestampField: 'exhaustedAtIso',
      logFailureSuffix: 'degrading to retry path',
    });
  }

  /**
   * Mark the `cacheKeyId` account as out of credits (default 10 minutes).
   * No-op when `cacheKeyId` is empty (cache opt-out).
   */
  async markCreditExhausted(options: MarkOptions): Promise<void> {
    await this.mark(options);
  }

  /**
   * Check whether the `cacheKeyId` account is currently marked as
   * credit-exhausted. Returns the timestamp the 402 fired + accurate
   * remaining TTL computed against the original write TTL stored in the
   * cache value.
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
    const result = await this.check(options);
    return result.active
      ? { exhausted: true, exhaustedAtMs: result.atMs, ttlSeconds: result.ttlSeconds }
      : { exhausted: false };
  }

  /**
   * Clear the credit-exhaustion mark for `cacheKeyId` — the recovery edge
   * fired from the ApiKey cache-invalidation subscriber when a user sets or
   * updates their wallet key, so a top-up isn't stranded behind a stale
   * doom-cache until the TTL expires.
   */
  async clearCreditExhausted(options: CheckOptions): Promise<void> {
    await this.clear(options);
  }
}

/**
 * Short-circuit an OpenRouter invocation when `cache` reports `cacheKeyId` is
 * out of credits, logging the cache hit and throwing a synthetic permanent
 * `ApiError` with the same shape downstream consumers see for real 402s.
 *
 * The synthetic message carries "Insufficient credits" so
 * `isAccountCreditExhaustion` routes it to `CREDIT_EXHAUSTION` inside
 * `parseApiError`; the explicit `category` + `userMessage` overrides are
 * belt-and-suspenders against any future change to either the synthetic
 * message text or the pattern-matching helper.
 *
 * Lives here rather than in `LLMInvoker.ts` (its only consumer); placement
 * rides TASK-1573.
 */
export async function throwIfCreditExhausted(
  cache: CreditExhaustionCache,
  cacheKeyId: string,
  invokerLogger: Pick<typeof logger, 'info'> = logger
): Promise<void> {
  const result = await cache.isCreditExhausted({ cacheKeyId });
  if (!result.exhausted) {
    return;
  }
  invokerLogger.info(
    {
      cacheKeyId,
      ttlSeconds: result.ttlSeconds,
      exhaustedAtIso: new Date(result.exhaustedAtMs).toISOString(),
    },
    'Skipped LLM call — credit-exhaustion cache hit'
  );
  const errorInfo = parseApiError(
    Object.assign(
      new Error('Insufficient credits. This account has no credits — top up to continue.'),
      { status: 402 }
    )
  );
  throw new ApiError('Credit exhaustion cached', {
    ...errorInfo,
    shouldRetry: false,
    type: ApiErrorType.PERMANENT,
    category: ApiErrorCategory.CREDIT_EXHAUSTION,
    userMessage: USER_ERROR_MESSAGES[ApiErrorCategory.CREDIT_EXHAUSTION],
    referenceId: 'credit-exhaustion-cache-hit',
  });
}
