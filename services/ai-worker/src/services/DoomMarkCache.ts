/**
 * Doom-Mark Cache (shared base)
 *
 * The mechanical core shared by the per-account doom caches
 * (`CreditExhaustionCache`, `KeyInvalidCache`): a Redis-backed boolean mark
 * keyed by a cache-bucket id (`user:<discordId>`), storing
 * `{ ts, ttl }` JSON so reads compute accurate remaining-TTL without a second
 * `redis.ttl()` round-trip, clamping caller TTLs to [60s, 24h], and degrading
 * open on every Redis failure (a mark is a demotion/perf signal, never a
 * correctness gate).
 *
 * Subclasses own the semantic vocabulary (method names, result shapes, header
 * docs) and the config: the Redis key prefix, the default write TTL, the log
 * noun/label, the log timestamp field name, and the failure-log suffix. Log
 * FIELDS and the failure SUFFIX are per-cache config (each cache keeps its own
 * greppable field and says what actually degrades); the rest of each log
 * message is shared.
 */

import type { Redis } from 'ioredis';
import { createLogger } from '@tzurot/common-types/utils/logger';

/** Subclass-supplied identity: key prefix, default TTL, and log vocabulary. */
export interface DoomMarkCacheConfig {
  /** Redis key prefix, e.g. `nocredits:openrouter:` — prepended verbatim. */
  keyPrefix: string;
  /** Write TTL when the caller omits `ttlSeconds`. Clamped like any other value. */
  defaultTtlSeconds: number;
  /** Lower-case noun for log messages, e.g. `'credit-exhaustion'` / `'invalid-key'`. */
  logNoun: string;
  /** pino logger label, e.g. `'CreditExhaustionCache'`. */
  loggerLabel: string;
  /** Field name carrying the ISO mark time on the mark log line, e.g. `'markedAtIso'`. */
  logTimestampField: string;
  /**
   * What degrades when Redis fails, ending the write/read failure warn
   * messages — e.g. `'degrading to retry path'` / `'failing open to the user key'`.
   */
  logFailureSuffix: string;
}

export interface DoomMarkOptions {
  /**
   * Opaque scope identifier for the doom bucket. Empty string opts out of
   * the cache entirely (write skip / read miss).
   */
  cacheKeyId: string;
  /**
   * Optional TTL override. Defaults to the subclass config's value.
   * Clamped to [60s, 24h].
   */
  ttlSeconds?: number;
}

export interface DoomCheckOptions {
  cacheKeyId: string;
}

export interface DoomMarkActiveResult {
  active: true;
  /** When the triggering failure fired, milliseconds since epoch. */
  atMs: number;
  /** Accurate remaining TTL in seconds (floored at 0). */
  ttlSeconds: number;
}

export interface DoomMarkInactiveResult {
  active: false;
}

export type DoomMarkCheckResult = DoomMarkActiveResult | DoomMarkInactiveResult;

/** Stored cache-value shape: the failure timestamp plus the original write TTL. */
interface StoredValue {
  ts: number;
  ttl: number;
}

export class DoomMarkCache {
  protected readonly logger;

  constructor(
    private readonly redis: Redis,
    private readonly config: DoomMarkCacheConfig
  ) {
    this.logger = createLogger(config.loggerLabel);
  }

  /**
   * Mark `cacheKeyId` as doomed for `ttlSeconds` (default from config). Stored
   * value is `JSON.stringify({ ts, ttl })` so reads compute accurate
   * remaining-TTL without a second `redis.ttl()` round-trip. No-op when
   * `cacheKeyId` is empty (cache opt-out). Redis write failures log a warn
   * and degrade per the cache's `logFailureSuffix`.
   */
  protected async mark(options: DoomMarkOptions): Promise<void> {
    const { cacheKeyId, ttlSeconds: rawTtl } = options;
    if (cacheKeyId.length === 0) {
      return;
    }
    const ttlSeconds = clampTtl(rawTtl ?? this.config.defaultTtlSeconds);
    const key = this.buildKey(cacheKeyId);
    const atMs = Date.now();
    const value: StoredValue = { ts: atMs, ttl: ttlSeconds };
    const noun = this.config.logNoun;
    try {
      await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
      this.logger.info(
        {
          cacheKeyId,
          ttlSeconds,
          [this.config.logTimestampField]: new Date(atMs).toISOString(),
        },
        `Cached ${noun} state`
      );
    } catch (err) {
      this.logger.warn(
        { err, cacheKeyId },
        `${capitalize(noun)} cache write failed — ${this.config.logFailureSuffix}`
      );
    }
  }

  /**
   * Check whether `cacheKeyId` currently carries the mark. Returns the
   * timestamp the failure fired + accurate remaining TTL computed against the
   * original write TTL stored in the cache value (not against MAX_TTL — that
   * would inflate the reported remaining time by over 23 hours when a
   * 10-minute write is used).
   *
   * Failure modes (cache read throws, malformed value, missing key) return
   * `{ active: false }` — better to take the real LLM call than to act on a
   * degraded cache.
   */
  protected async check(options: DoomCheckOptions): Promise<DoomMarkCheckResult> {
    const { cacheKeyId } = options;
    if (cacheKeyId.length === 0) {
      return { active: false };
    }
    const key = this.buildKey(cacheKeyId);
    const noun = this.config.logNoun;
    try {
      const stored = await this.redis.get(key);
      if (stored === null) {
        return { active: false };
      }
      const parsed = parseStoredValue(stored);
      if (parsed === null) {
        return { active: false };
      }
      // Compute remaining TTL from the original write TTL stored alongside
      // the timestamp, so the cache-hit log reports accurate "time until
      // self-expiry" regardless of the write TTL the caller used.
      const elapsedSeconds = Math.floor((Date.now() - parsed.ts) / 1000);
      const ttlSeconds = Math.max(0, parsed.ttl - elapsedSeconds);
      return { active: true, atMs: parsed.ts, ttlSeconds };
    } catch (err) {
      this.logger.warn(
        { err, cacheKeyId },
        `${capitalize(noun)} cache read failed — ${this.config.logFailureSuffix}`
      );
      return { active: false };
    }
  }

  /**
   * Clear the mark for `cacheKeyId` — the wallet-key-update recovery edge
   * (fired from the ApiKey cache-invalidation subscriber). Failure is
   * non-fatal: the TTL remains the backstop.
   */
  protected async clear(options: DoomCheckOptions): Promise<void> {
    const { cacheKeyId } = options;
    if (cacheKeyId.length === 0) {
      return;
    }
    const key = this.buildKey(cacheKeyId);
    const noun = this.config.logNoun;
    try {
      const deleted = await this.redis.del(key);
      if (deleted > 0) {
        this.logger.info({ cacheKeyId }, `Cleared ${noun} state (wallet key updated)`);
      }
    } catch (err) {
      this.logger.warn(
        { err, cacheKeyId },
        `${capitalize(noun)} cache clear failed — TTL remains the backstop`
      );
    }
  }

  /**
   * Build the Redis key for `cacheKeyId`. Plain string concatenation, no
   * model dimension — both doom states are account-wide. Format invariant
   * matches `RateLimitCache.buildKey`: the `cacheKeyId` is opaque and never
   * contains a colon in its dynamic segment.
   */
  private buildKey(cacheKeyId: string): string {
    return `${this.config.keyPrefix}${cacheKeyId}`;
  }
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

function clampTtl(seconds: number): number {
  return Math.min(24 * 60 * 60, Math.max(60, seconds));
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
