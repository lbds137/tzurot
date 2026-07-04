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
import { ApiErrorCategory } from '@tzurot/common-types/constants/error';
import { CACHE_KEY_PREFIXES } from '@tzurot/common-types/constants/redis-keys';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('RateLimitCache');

const KEY_PREFIX = CACHE_KEY_PREFIXES.RATE_LIMIT_OPENROUTER;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 24 * 60 * 60;

/**
 * Cached value shape, persisted as JSON in Redis.
 *
 * Stores the full user-facing context from the original 429 — not just the
 * reset timestamp — so the synthetic short-circuit at read time can replay
 * the exact category + message the user would have seen on a real upstream
 * call. Without this, every cache hit collapsed to the generic
 * `RATE_LIMIT` user message, losing the `QUOTA_EXCEEDED` distinction
 * (which carries actionable wording about credits + limit-reset windows).
 */
interface StoredValue {
  /** Unix-ms timestamp when the rate-limit window resets. */
  resetMs: number;
  /**
   * Original ApiErrorCategory from the upstream 429. Persisted as a
   * string for forward-compat with new categories; the read path falls
   * back to RATE_LIMIT on unknown values.
   */
  category: ApiErrorCategory;
  /** User-facing message corresponding to `category` (verbatim from `USER_ERROR_MESSAGES`). */
  userMessage: string;
  /**
   * Original upstream technical message text (e.g.,
   * "Rate limit exceeded: free-models-per-day-high-balance"). Bounded
   * length is the caller's responsibility — `parseApiError` already
   * applies `MAX_ERROR_MESSAGE_LENGTH` truncation.
   */
  technicalMessage: string;
}

/**
 * Format invariant for `cacheKeyId` — the dynamic segment of the cache key.
 * Either the literal string `system`, `user:<digits>`, or empty (cache opt-out).
 * Critically excludes any colon in the dynamic segment after `user:` so the
 * `<prefix>:<id>:<model>` key shape stays unambiguous. Future scope extensions
 * (e.g., `org:<name>`) MUST update this regex AND audit all callers to confirm
 * the new dynamic segment cannot itself contain a colon.
 */
const VALID_CACHE_KEY_ID = /^(?:system|user:\d+|)$/;

interface MarkOptions {
  /**
   * Opaque scope identifier for the rate-limit bucket — typically
   * `user:<discordUserId>` for BYOK users or `system` for guest mode /
   * system-key fallback. NOT derived from the API key value.
   */
  cacheKeyId: string;
  model: string;
  resetTimestampMs: number;
  /**
   * Original error category from `parseApiError` — preserved so the
   * synthetic short-circuit at read time can replay the same user
   * message the user would have seen on a real upstream 429.
   */
  category: ApiErrorCategory;
  /** User-facing message corresponding to `category`. */
  userMessage: string;
  /** Original upstream error text. */
  technicalMessage: string;
}

interface CheckOptions {
  cacheKeyId: string;
  model: string;
}

interface RateLimitedResult {
  rateLimited: true;
  resetMs: number;
  ttlSeconds: number;
  /** Original error category preserved across the cache. */
  category: ApiErrorCategory;
  /** User-facing message preserved across the cache. */
  userMessage: string;
  /** Original upstream error text preserved across the cache. */
  technicalMessage: string;
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
    const { cacheKeyId, model, resetTimestampMs, category, userMessage, technicalMessage } =
      options;
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
    const value: StoredValue = {
      resetMs: resetTimestampMs,
      category,
      userMessage,
      technicalMessage,
    };
    try {
      await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
      logger.info(
        {
          cacheKeyId,
          model,
          category,
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
      const parsed = parseStoredValue(stored);
      if (parsed === null) {
        return { rateLimited: false };
      }
      // Treat the cached resetMs as the canonical truth. If the reset has
      // already passed (e.g., a clock-skew window made the cache linger past
      // its real expiry), the real provider would accept the call now —
      // short-circuiting on a stale cached value would block a request that
      // should succeed.
      const nowMs = Date.now();
      if (parsed.resetMs < nowMs) {
        return { rateLimited: false };
      }
      const ttlSeconds = Math.floor((parsed.resetMs - nowMs) / 1000);
      return {
        rateLimited: true,
        resetMs: parsed.resetMs,
        ttlSeconds,
        category: parsed.category,
        userMessage: parsed.userMessage,
        technicalMessage: parsed.technicalMessage,
      };
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
 * Parse a Redis cache value into the structured shape. Returns null for
 * malformed values (cache read fails closed, callers fall through to the
 * retry path).
 *
 * The forward/backward deployment skew check below is the only non-obvious
 * piece: a future version of ai-worker may write a new `ApiErrorCategory`
 * value into the cache, then a rollback to current code reads the unknown
 * string. Without the runtime membership check, the unknown value would
 * flow unchecked through `ApiError` and into downstream consumers that
 * switch on `category` (e.g., the bot-client error renderer). On unknown
 * values we fall back to `RATE_LIMIT` — safe since we know the entry was
 * written for a 429-class event, and the persisted user/technical messages
 * are still used verbatim so the user sees the original wording.
 */
function parseStoredValue(raw: string): StoredValue | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  // Given startsWith('{'), JSON.parse either throws (caught above) or returns
  // an object literal — non-object outcomes (null, array, primitive) require
  // an input that doesn't start with '{', so no defensive type-check is needed.
  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate.resetMs !== 'number' ||
    Number.isNaN(candidate.resetMs) ||
    typeof candidate.category !== 'string' ||
    typeof candidate.userMessage !== 'string' ||
    typeof candidate.technicalMessage !== 'string'
  ) {
    return null;
  }
  const isKnownCategory = (Object.values(ApiErrorCategory) as string[]).includes(
    candidate.category
  );
  return {
    resetMs: candidate.resetMs,
    category: isKnownCategory
      ? (candidate.category as ApiErrorCategory)
      : ApiErrorCategory.RATE_LIMIT,
    userMessage: candidate.userMessage,
    technicalMessage: candidate.technicalMessage,
  };
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
  let result: string;
  if (hasByokKey) {
    result = userId.length > 0 ? `user:${userId}` : '';
  } else {
    result = 'system';
  }
  assertValidCacheKeyId(result);
  return result;
}

/**
 * Runtime belt for the documented `cacheKeyId` format invariant. Logs `warn`
 * on violation rather than throwing — the cache is a performance optimisation,
 * never a correctness gate, so a degraded read is preferable to a hard
 * failure mid-request.
 *
 * Dormant against the current `deriveCacheKeyId` outputs, which all match
 * `VALID_CACHE_KEY_ID` by construction. The check is a sentinel for future
 * extensions: a contributor adding a new scope (e.g., `org:<name>`) must
 * update both `deriveCacheKeyId` and `VALID_CACHE_KEY_ID`, or this assertion
 * will fire and surface the gap.
 *
 * Exported for direct unit testing of the invariant — callers that route
 * through `deriveCacheKeyId` get the check for free.
 */
export function assertValidCacheKeyId(cacheKeyId: string): void {
  if (!VALID_CACHE_KEY_ID.test(cacheKeyId)) {
    logger.warn(
      { cacheKeyId },
      'Cache key ID violates expected shape — Redis key lookups may collide. ' +
        'Expected: "system" | "user:<digits>" | "". ' +
        'Update VALID_CACHE_KEY_ID + deriveCacheKeyId together when adding a new scope.'
    );
  }
}
