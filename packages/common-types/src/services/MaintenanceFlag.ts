/**
 * MaintenanceFlag
 *
 * Redis-backed maintenance-mode flag shared by the user-facing services.
 * When active, bot-client rejects Discord traffic with a friendly message and
 * api-gateway 503s API requests — so a destructive migration can run against
 * a quiesced system instead of erroring on live traffic (the flag store is
 * Redis precisely because Postgres is the thing in flux during the window).
 *
 * Toggled by the ops CLI (`pnpm ops maintenance on|off|status --env <env>`),
 * which writes the same key via the same class.
 *
 * Read path is TTL-cached (default 5s) so per-message checks cost at most one
 * Redis GET per window per process — staleness of a few seconds is harmless
 * here (a message slipping in 3s after maintenance-on is equivalent to it
 * arriving 3s earlier), so per the caching decision tree this deliberately
 * does NOT use pub/sub invalidation.
 */

import type { Redis } from 'ioredis';
import { MAINTENANCE_FLAG_KEY } from '../constants/redis-keys.js';
import { createLogger } from '../utils/logger.js';
import { TTLCache } from '../utils/TTLCache.js';

const logger = createLogger('MaintenanceFlag');

/** Single cache slot — the flag has no per-entity axis. */
const CACHE_KEY = 'flag';

/** Default read-cache window. */
const DEFAULT_CACHE_TTL_MS = 5_000;

/**
 * Hard latency bound on the hot-path Redis read. `isActive` runs BEFORE the
 * Discord ack on every interaction (cache misses only, ~1 per 5s per process),
 * and fail-open bounds ERRORS but not LATENCY — a hung-not-failing Redis GET
 * would otherwise eat the 3-second ack budget. A timed-out read is treated as
 * inactive (same fail-open posture) and not cached, so recovery is observed on
 * the next call.
 */
const READ_TIMEOUT_MS = 250;

export interface MaintenanceFlagOptions {
  /** Read-cache TTL in ms (default 5s). */
  cacheTtlMs?: number;
  /** Clock injection for fake-timer tests (see TTLCache). */
  now?: () => number;
}

export interface MaintenanceStatus {
  active: boolean;
  /** ISO timestamp recorded at enable time; null when inactive. */
  since: string | null;
}

export class MaintenanceFlag {
  private readonly cache: TTLCache<boolean>;

  constructor(
    private readonly redis: Redis,
    options: MaintenanceFlagOptions = {}
  ) {
    this.cache = new TTLCache<boolean>({
      ttl: options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
      now: options.now,
    });
  }

  /**
   * Whether maintenance mode is active — the hot-path check (TTL-cached,
   * latency-bounded to {@link READ_TIMEOUT_MS}).
   *
   * Fail-OPEN on Redis errors AND timeouts: a Redis outage is its own
   * incident, and converting a failed/slow flag read into "reject all
   * traffic" (or a blown ack budget) would turn every Redis blip into a
   * full bot outage. Treat unknown as inactive and WARN.
   */
  async isActive(): Promise<boolean> {
    const cached = this.cache.get(CACHE_KEY);
    if (cached !== null) {
      return cached;
    }
    try {
      const value = await this.readWithTimeout();
      const active = value !== null;
      this.cache.set(CACHE_KEY, active);
      return active;
    } catch (error) {
      logger.warn(
        { err: error },
        'Maintenance-flag read failed — treating as inactive (fail-open)'
      );
      return false;
    }
  }

  /** Redis GET raced against the latency bound; the loser's timer is cleared. */
  private readWithTimeout(): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`maintenance-flag read exceeded ${READ_TIMEOUT_MS}ms`));
      }, READ_TIMEOUT_MS);
      this.redis.get(MAINTENANCE_FLAG_KEY).then(
        value => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      );
    });
  }

  /**
   * Turn maintenance mode on. The stored value is the enable timestamp so
   * `status` can answer "how long has this been on."
   */
  async enable(now: Date = new Date()): Promise<void> {
    await this.redis.set(MAINTENANCE_FLAG_KEY, now.toISOString());
    // Drop the local cache so the toggling process observes its own write
    // immediately (other processes converge within their cache TTL).
    this.cache.delete(CACHE_KEY);
  }

  /** Turn maintenance mode off. */
  async disable(): Promise<void> {
    await this.redis.del(MAINTENANCE_FLAG_KEY);
    this.cache.delete(CACHE_KEY);
  }

  /**
   * Uncached read for the ops CLI — always reflects the live Redis state.
   * `since` is null for pre-timestamp values only if the key is absent;
   * a present key always carries the ISO timestamp `enable` wrote.
   */
  async status(): Promise<MaintenanceStatus> {
    const value = await this.redis.get(MAINTENANCE_FLAG_KEY);
    return { active: value !== null, since: value };
  }
}
