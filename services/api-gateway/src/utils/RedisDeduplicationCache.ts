/**
 * Redis-backed Request Deduplication Cache
 *
 * Prevents duplicate AI requests by caching recent requests in Redis
 * and returning the same job ID for identical requests within a short time window.
 *
 * Redis-backed implementation enables horizontal scaling of API Gateway instances
 * since all instances share the same deduplication state.
 */

import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { REDIS_KEY_PREFIXES } from '@tzurot/common-types/constants/queue';
import { INTERVALS } from '@tzurot/common-types/constants/timing';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { GenerateRequest, CachedRequest } from '../types.js';

const logger = createLogger('RequestDeduplication');

export interface RedisDeduplicationOptions {
  /**
   * Time window (seconds) for duplicate detection
   * @default INTERVALS.REQUEST_DEDUP_WINDOW / 1000 (5 seconds)
   */
  duplicateWindowSeconds?: number;
}

/**
 * Outcome of a reservation attempt.
 *
 * `reserved` — this caller owns the window and must proceed to enqueue.
 * `duplicate` — someone else already reserved it; return their job.
 */
export type ReserveResult = { kind: 'reserved' } | { kind: 'duplicate'; cached: CachedRequest };

/**
 * Compare-and-delete: drop the reservation only when its stored jobId is the
 * one the caller reserved. Returns 1 when deleted, 0 otherwise (absent key,
 * unparseable entry, or an entry belonging to a different request).
 */
const RELEASE_IF_OWNED_LUA = `
local cached = redis.call('GET', KEYS[1])
if not cached then
  return 0
end
local ok, parsed = pcall(cjson.decode, cached)
if ok and parsed.jobId == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/**
 * Redis-backed Request Deduplication Cache
 *
 * Uses Redis SET with TTL for automatic expiration - no cleanup interval needed.
 *
 * Example usage:
 * ```typescript
 * const cache = new RedisDeduplicationCache(redis);
 *
 * const result = await cache.reserve(request, requestId, jobId);
 * if (result.kind === 'duplicate') {
 *   return result.cached.jobId;
 * }
 * // reservation held — enqueue, and release() if the enqueue fails
 * ```
 */
export class RedisDeduplicationCache {
  private readonly redis: Redis;
  private readonly duplicateWindowSeconds: number;
  private readonly keyPrefix: string;

  constructor(redis: Redis, options: RedisDeduplicationOptions = {}) {
    this.redis = redis;
    this.duplicateWindowSeconds =
      options.duplicateWindowSeconds ?? Math.ceil(INTERVALS.REQUEST_DEDUP_WINDOW / 1000);
    this.keyPrefix = REDIS_KEY_PREFIXES.REQUEST_DEDUP;
  }

  /**
   * Claim the deduplication window for a request, atomically.
   *
   * The caller must invoke this BEFORE enqueueing any work: the reservation is
   * the record that the work is about to exist. `SET ... NX EX` makes claim and
   * expiry one round trip, so no interleaving caller can observe a window that
   * is claimed-but-not-yet-expiring.
   *
   * Redis errors PROPAGATE rather than fail open, and the caller turns them into
   * a 503. The dedup client and the BullMQ client are separate connections to the
   * same Redis server, so a total outage already fails the enqueue on its own;
   * fail-closed only changes behaviour under partial degradation — precisely the
   * case where proceeding without a reservation double-bills a paid model call
   * and sends the user two replies.
   *
   * @returns `reserved` when this caller owns the window, `duplicate` with the
   *   existing entry when another request already claimed it
   * @throws when Redis is unreachable, when the SET/GET pair cannot resolve
   *   either way across two attempts, or when a stored entry will not parse.
   *   The parse case is deliberate rather than incidental: an unreadable entry
   *   means SOMEONE holds the window, and the only alternatives are to enqueue
   *   anyway (the double-bill this method exists to prevent) or to overwrite
   *   another caller's live reservation. Pinned by 'propagates a malformed
   *   stored entry rather than enqueueing past it'.
   */
  async reserve(
    request: GenerateRequest,
    requestId: string,
    jobId: string
  ): Promise<ReserveResult> {
    const hash = this.hashRequest(request);
    const key = `${this.keyPrefix}${hash}`;

    // Two attempts: a reservation that expires between our SET and our GET
    // leaves neither answer available, and the window is short enough that the
    // race is self-clearing. A second miss is astronomically unlikely, so it is
    // reported rather than looped on.
    for (let attempt = 0; attempt < 2; attempt++) {
      const now = Date.now();
      const data: CachedRequest = {
        requestId,
        jobId,
        timestamp: now,
        expiresAt: now + this.duplicateWindowSeconds * 1000,
      };

      const setResult = await this.redis.set(
        key,
        JSON.stringify(data),
        'EX',
        this.duplicateWindowSeconds,
        'NX'
      );

      if (setResult === 'OK') {
        logger.debug({ requestId, jobId }, 'Reserved deduplication window');
        return { kind: 'reserved' };
      }

      const cached = await this.redis.get(key);
      if (cached !== null) {
        const existing = JSON.parse(cached) as CachedRequest;
        logger.info(
          { jobId: existing.jobId, timeSinceRequestMs: Date.now() - existing.timestamp },
          'Found duplicate request, returning cached job'
        );
        return { kind: 'duplicate', cached: existing };
      }
    }

    throw new Error(
      'Deduplication reservation did not resolve: the existing reservation expired between SET and GET on both attempts'
    );
  }

  /**
   * Release a reservation taken by `reserve` — only if it is still OURS.
   *
   * A bare `DEL` here would be a correctness bug, not a micro-optimisation.
   * The reservation's TTL is `REQUEST_DEDUP_WINDOW` (5s) while a Redis command
   * can hang for `COMMAND_TIMEOUT` (30s), so an enqueue that fails BY TIMEOUT
   * always outlives its own reservation. By the time this runs, the key is
   * either gone or has been re-reserved by a different in-flight request with
   * the same content hash — and deleting that one frees the window for a third
   * request to enqueue a duplicate job, which is the double-bill this class
   * exists to prevent, reached from the other side.
   *
   * So: compare-and-delete, keyed on the `jobId` this caller reserved. Done as
   * one EVAL rather than GET-then-DEL because the check and the delete must not
   * be separated by a round trip (the same reasoning, and the same shape, as
   * `INCR_WITH_EXPIRE_LUA` in RedisRateLimiter.ts). `cjson.decode` is wrapped in
   * `pcall` so a corrupt entry leaves the key alone instead of erroring the
   * script. Pinned by 'does not delete a reservation belonging to another
   * request'.
   *
   * Best-effort: a failed release only leaves the (short) window blocking a
   * retry, which is the behaviour that existed before reservations, so it is
   * logged rather than thrown.
   */
  async release(request: GenerateRequest, jobId: string): Promise<void> {
    const hash = this.hashRequest(request);
    const key = `${this.keyPrefix}${hash}`;

    try {
      const deleted = await this.redis.eval(RELEASE_IF_OWNED_LUA, 1, key, jobId);
      if (deleted === 0) {
        // Not an error: the reservation expired, or another request owns the
        // window now. Worth seeing, because it means the enqueue outlived its
        // own reservation.
        logger.debug({ jobId }, 'Reservation not released — expired or owned by another request');
        return;
      }
      logger.debug({ jobId }, 'Released deduplication reservation');
    } catch (error) {
      logger.warn({ err: error, jobId }, 'Failed to release deduplication reservation');
    }
  }

  /**
   * Get approximate cache size (for monitoring)
   *
   * Counts RESERVATIONS, not confirmed jobs. Entries now appear at reservation
   * time rather than after a successful enqueue, so the gauge briefly includes
   * requests still enqueuing, and ones whose enqueue failed before `release()`
   * ran. Both windows are short, but an alert threshold tuned against the old
   * write-after-enqueue meaning is measuring a slightly different quantity.
   *
   * Uses SCAN instead of KEYS to avoid blocking Redis.
   * SCAN iterates incrementally and doesn't block the server.
   */
  async getCacheSize(): Promise<number> {
    try {
      let cursor = '0';
      let count = 0;

      do {
        // SCAN returns [newCursor, keys]
        // COUNT is a hint, not a guarantee - Redis may return more or fewer
        const [newCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          `${this.keyPrefix}*`,
          'COUNT',
          100
        );
        cursor = newCursor;
        count += keys.length;
      } while (cursor !== '0');

      return count;
    } catch (error) {
      logger.error({ err: error }, 'Failed to get cache size');
      return 0;
    }
  }

  /**
   * Create a hash for a request to detect duplicates
   * Uses SHA-256 for stable, collision-resistant hashing
   */
  private hashRequest(request: GenerateRequest): string {
    const { personality, message, context } = request;

    // Create hash from key components
    const personalityName = personality.name;
    const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
    const contextStr = `${context.userId}-${context.channelId ?? 'dm'}`;

    // Create stable hash using SHA-256 for the entire message
    // 16 hex chars = 64 bits of entropy (sufficient for current usage)
    const messageHash = createHash('sha256').update(messageStr).digest('hex').substring(0, 16);

    return `${personalityName}:${contextStr}:${messageHash}`;
  }
}
