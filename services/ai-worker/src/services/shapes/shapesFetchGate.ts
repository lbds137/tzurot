/**
 * Global concurrency gate for shapes.inc fetch jobs.
 *
 * All shapes.inc traffic leaves from one egress IP, so N users triggering
 * imports/exports simultaneously look like a thundering herd to shapes.inc —
 * the kind of aggregate footprint that invites rate-limiting or hardening.
 * This gate caps simultaneous fetches globally; a job that can't get a slot
 * throws `ShapesFetchBusyError` (retryable), and BullMQ's exponential backoff
 * becomes the wait.
 *
 * Etiquette, not correctness — same fail-open posture as VisionFallbackQuota:
 * - Any Redis error logs a warn and ALLOWS the fetch (a counter blip must not
 *   break user exports).
 * - A crashed worker leaks its slot only until the key TTL; the TTL is set on
 *   every acquire, sized past the longest realistic job.
 * - `release()` floors the counter at zero, so an unpaired decrement (e.g.
 *   release after a fail-open acquire that never incremented) self-heals.
 */

import type { Redis } from 'ioredis';
import { CACHE_KEY_PREFIXES } from '@tzurot/common-types/constants/redis-keys';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('ShapesFetchGate');

/**
 * Max simultaneous shapes.inc fetch jobs across the whole deployment.
 * Low-and-slow: with the fetcher's own 1s inter-request delay this keeps the
 * aggregate request rate to at most a couple of requests per second.
 */
export const MAX_CONCURRENT_SHAPES_FETCHES = 2;

const ACTIVE_KEY = `${CACHE_KEY_PREFIXES.SHAPES_FETCH_GATE}active`;

/**
 * Slot-leak bound. The largest observed export (461 memory pages at 1s
 * spacing plus retries) runs well under an hour; two hours means a crashed
 * worker's leaked slot degrades politeness at most that long.
 */
const SLOT_TTL_SECONDS = 2 * 60 * 60;

/**
 * Outcome of a slot claim. Three states rather than a boolean because
 * "allowed" and "held" are different facts: a fail-open allows the fetch but
 * holds NO counted slot, so the caller must not release one — a boolean
 * conflating the two would make transient Redis errors silently under-count
 * the very thing the gate exists to count.
 */
export type ShapesFetchSlotOutcome = 'acquired' | 'denied' | 'fail-open';

/**
 * Known trade-off — retry budget vs. long contention: the busy error rides
 * the jobs' BullMQ backoff (attempts 5 × exponential 5s ≈ 75s total), which
 * outlasts bursts but NOT two maximal hour-scale exports holding both slots.
 * A third job during such contention exhausts its retries and fails with the
 * honest busy message rather than waiting an hour — acceptable at this
 * project's traffic (a handful of users, rare jobs).
 */
export class ShapesFetchGate {
  constructor(
    private readonly redis: Redis,
    /** Public so a denied caller can name the cap in its error message. */
    readonly maxConcurrent: number = MAX_CONCURRENT_SHAPES_FETCHES
  ) {}

  /**
   * Try to claim a fetch slot.
   *
   * @returns 'acquired' — slot claimed and counted (caller MUST release);
   *   'denied' — at the cap, nothing held (do NOT release);
   *   'fail-open' — Redis failed before counting anything; the fetch is
   *   ALLOWED but no slot is held (do NOT release).
   */
  async tryAcquire(): Promise<ShapesFetchSlotOutcome> {
    let count: number;
    try {
      count = await this.redis.incr(ACTIVE_KEY);
    } catch (error) {
      logger.warn(
        { err: error },
        'Shapes fetch gate acquire failed — failing open (allowing the fetch, no slot held)'
      );
      return 'fail-open';
    }

    // The increment landed — from here on a slot IS counted, so every path
    // returns 'acquired'/'denied' (never 'fail-open') to keep release paired.
    try {
      // Refresh the leak bound on every acquire (cheap; self-heals a miss).
      await this.redis.expire(ACTIVE_KEY, SLOT_TTL_SECONDS);
    } catch (error) {
      logger.warn({ err: error }, 'Shapes fetch gate TTL refresh failed — continuing');
    }

    if (count > this.maxConcurrent) {
      try {
        await this.redis.decr(ACTIVE_KEY);
      } catch (error) {
        logger.warn({ err: error }, 'Shapes fetch gate deny-decrement failed — recovers via TTL');
      }
      logger.info(
        { activeFetches: count - 1, maxConcurrent: this.maxConcurrent },
        'Concurrent shapes.inc fetch cap reached — job will wait via BullMQ backoff'
      );
      return 'denied';
    }
    return 'acquired';
  }

  /** Release a claimed slot. Never throws; floors the counter at zero. */
  async release(): Promise<void> {
    try {
      const count = await this.redis.decr(ACTIVE_KEY);
      if (count < 0) {
        // Unpaired decrement (TTL expiry mid-job) — walk the counter back to
        // exactly zero RELATIVELY, so a concurrent acquire's increment in
        // this window is preserved instead of clobbered by an absolute SET.
        await this.redis.incrby(ACTIVE_KEY, -count);
      }
    } catch (error) {
      logger.warn({ err: error }, 'Shapes fetch gate release failed — slot recovers via TTL');
    }
  }
}
