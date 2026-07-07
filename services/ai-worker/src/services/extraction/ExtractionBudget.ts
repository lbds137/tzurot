/**
 * Fact-Extraction Daily Budget (the §3.8 cost tripwire)
 *
 * Per-(personality, UTC-day) cap on extraction model calls. Extraction runs on
 * a fixed cheap SYSTEM model (never the personality's model), so the direct
 * dollar cost per call is small — but it is unbounded without a ceiling, and
 * shadow mode already spends money. Over-budget batches are skipped with a
 * structured log (the episodes stay in Postgres; nothing is lost — extraction
 * simply doesn't run for that personality until the UTC day rolls over).
 *
 * **Fixed UTC-day window**: the key embeds the UTC date, so the count
 * auto-resets at UTC midnight. EXPIRE is cleanup only; the date-scoped key
 * makes a missed EXPIRE self-healing.
 *
 * **Fail-open**: a Redis blip must not silently halt the memory pipeline —
 * the guarded resource is sustained spend, not a single call. (Mirrors
 * VisionFallbackQuota; atomicity via Lua INCR+EXPIRE mirrors RedisRateLimiter,
 * closing the crash-between-INCR-and-EXPIRE race.)
 */

import type { Redis } from 'ioredis';
import { CACHE_KEY_PREFIXES } from '@tzurot/common-types/constants/redis-keys';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('ExtractionBudget');

const KEY_PREFIX = CACHE_KEY_PREFIXES.FACT_EXTRACTION_BUDGET;

/**
 * Default per-personality daily ceiling on extraction model calls. At the
 * default batch threshold (one call per ~6 stored interactions) this allows
 * ~600 interactions/personality/day before throttling — far above organic
 * roleplay volume, low enough to bound a runaway loop or an abuse pattern.
 */
export const FACT_EXTRACTION_DAILY_LIMIT = 100;

/** TTL for the per-day counter key — 25h gives margin past the UTC rollover. */
const BUDGET_KEY_TTL_SECONDS = 25 * 60 * 60;

/** Atomic INCR + first-call EXPIRE (KEYS[1]=budget key, ARGV[1]=TTL seconds). */
const INCR_WITH_EXPIRE_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;

export class ExtractionBudget {
  constructor(
    private readonly redis: Redis,
    private readonly dailyLimit: number = FACT_EXTRACTION_DAILY_LIMIT
  ) {}

  /**
   * Atomically record one extraction model call for `personalityId` and report
   * whether it remains within the daily cap.
   *
   * @returns `true` if extraction may proceed (counted, under the cap
   *   inclusive). `false` if this call would exceed the cap — the caller skips
   *   the batch (the tripwire firing). Fails OPEN on Redis errors.
   */
  async tryConsume(personalityId: string): Promise<boolean> {
    const key = this.buildKey(personalityId);
    try {
      const count = (await this.redis.eval(
        INCR_WITH_EXPIRE_LUA,
        1,
        key,
        String(BUDGET_KEY_TTL_SECONDS)
      )) as number;
      const allowed = count <= this.dailyLimit;
      if (!allowed) {
        logger.warn(
          { personalityId, count, dailyLimit: this.dailyLimit },
          'Extraction budget exceeded — skipping batch (cost tripwire)'
        );
      }
      return allowed;
    } catch (error) {
      logger.warn(
        { err: error, personalityId },
        'Extraction budget check failed — failing open (allowing the call)'
      );
      return true;
    }
  }

  /** Build the per-(personality, UTC-day) counter key. */
  private buildKey(personalityId: string): string {
    const utcDay = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    return `${KEY_PREFIX}${personalityId}:${utcDay}`;
  }
}
