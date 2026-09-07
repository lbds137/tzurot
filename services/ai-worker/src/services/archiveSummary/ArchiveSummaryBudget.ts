/**
 * Memory-Archive Summarizer Daily Budget (the write-side cost tripwire)
 *
 * GLOBAL (all characters combined) per-UTC-day cap on archive-summary model
 * calls. Unlike ExtractionBudget, this counter is not scoped per personality —
 * the summarizer runs on every stored episode across every character, so the
 * cap is a single shared pie rather than a per-character ceiling.
 *
 * **Fixed UTC-day window**: the key embeds the UTC date, so the count
 * auto-resets at UTC midnight. EXPIRE is cleanup only; the date-scoped key
 * makes a missed EXPIRE self-healing.
 *
 * **Fail-open**: a Redis blip must not silently halt the memory pipeline —
 * the guarded resource is sustained spend, not a single call. (Mirrors
 * ExtractionBudget/VisionFallbackQuota.) Per `.claude/rules/03-database.md` §
 * Redis counters, this is a plain non-atomic INCR/EXPIRE, not Lua: it's a
 * soft daily cap and fail-open already, so same-user concurrent overshoot —
 * the one thing Lua would additionally prevent — errs on the permissive
 * side, which is the safe direction for this resource.
 */

import type { Redis } from 'ioredis';
import { CACHE_KEY_PREFIXES } from '@tzurot/common-types/constants/redis-keys';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('ArchiveSummaryBudget');

const KEY_PREFIX = CACHE_KEY_PREFIXES.ARCHIVE_SUMMARY_BUDGET;

/** TTL for the per-day counter key — 25h gives margin past the UTC rollover. */
const BUDGET_KEY_TTL_SECONDS = 25 * 60 * 60;

export class ArchiveSummaryBudget {
  /**
   * `dailyLimit` is read LIVE on every call (a supplier, not a captured
   * value) so an owner's daily-cap edit in the dashboard takes effect on the
   * next job without restarting the worker.
   */
  constructor(
    private readonly redis: Redis,
    private readonly dailyLimit: () => number
  ) {}

  /**
   * Record one archive-summary attempt and report whether it remains within
   * the GLOBAL daily cap. A denied attempt is refunded by the caller, so the
   * counter converges on the calls actually admitted rather than every
   * attempt made.
   *
   * @returns `allowed`: `true` if the call may proceed (counted, under the
   *   cap inclusive). `false` if this call would exceed the cap. Fails OPEN
   *   on Redis errors. `refund`: a closure over the SAME UTC-day key this
   *   call charged — `tryConsume` and a later `refund` must never
   *   independently recompute `buildKey()`, because a consume just before UTC
   *   midnight and a refund just after would then target different day keys,
   *   decrementing a day that was never charged.
   */
  async tryConsume(): Promise<{ allowed: boolean; refund: () => Promise<void> }> {
    const key = this.buildKey();
    const limit = this.dailyLimit();
    try {
      const count = await this.redis.incr(key);
      // The verdict is decided from the INCR result alone, before EXPIRE runs:
      // EXPIRE is cleanup only (the date-scoped key self-heals a missed
      // EXPIRE), so its failure must never override a verdict the INCR
      // already proved.
      const allowed = count <= limit;
      if (!allowed) {
        logger.warn(
          { count, dailyLimit: limit },
          'Archive-summary budget exceeded — delaying job (cost tripwire)'
        );
      }
      try {
        // Set/refresh expiry every call (cheap; self-heals a missed EXPIRE).
        // The date-scoped key resets the count at UTC midnight regardless.
        await this.redis.expire(key, BUDGET_KEY_TTL_SECONDS);
      } catch (expireError) {
        logger.warn(
          { err: expireError },
          'Archive-summary budget EXPIRE failed — continuing (cleanup only, verdict unaffected)'
        );
      }
      return { allowed, refund: () => this.refund(key) };
    } catch (error) {
      logger.warn(
        { err: error },
        'Archive-summary budget check failed — failing open (allowing the call)'
      );
      // Nothing was charged on this path (the INCR itself threw), so the
      // refund closure must be a no-op — a DECR here would under-count a day
      // that was never incremented.
      return { allowed: true, refund: () => Promise.resolve() };
    }
  }

  /**
   * Return one unit consumed by an attempt that spent nothing: either the
   * invoker threw before any tokens were billed, or the attempt was denied
   * before it ever reached the model. Plain DECR against the SAME key the
   * charging `tryConsume` call built, fail-open like the rest of the class.
   */
  private async refund(key: string): Promise<void> {
    try {
      await this.redis.decr(key);
    } catch (error) {
      logger.warn({ err: error }, 'Archive-summary budget refund failed — continuing (fail-open)');
    }
  }

  /** Build the per-UTC-day (global) counter key. */
  private buildKey(): string {
    const utcDay = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    return `${KEY_PREFIX}${utcDay}`;
  }
}
