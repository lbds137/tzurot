/**
 * Vision System-Fallback Quota
 *
 * Per-user daily cap on the **broad free-vision fallback** — the path where an
 * authenticated user who can't auth their vision provider is downgraded to the
 * free vision model on the bot's SYSTEM OpenRouter key (see
 * `resolveBroadFreeFallback`, called per fallback tier).
 *
 * **Why this exists**: the broad fallback lets any authenticated user (including
 * a throwaway account that set a dummy key for any provider) route vision through
 * the owner's system OpenRouter key. The forced free model means no *direct*
 * dollar cost, but it consumes the shared OpenRouter free-tier rate limit — so a
 * few heavy users could starve genuine guests. This cap bounds each user's daily
 * consumption of that shared resource. Once a user exceeds the cap, the tier's
 * auth resolution fail-fasts and the fallback loop advances / renders the
 * `[Image … couldn't be processed …]` placeholder instead of serving another
 * free-fallback call.
 *
 * **Counted per image (per system-key vision call)**: the fallback loop
 * (`describeImageWithFallback`) creates a fresh quota tracker per ATTACHMENT, so each
 * image that downgrades onto the SYSTEM key consumes one unit — a multi-image message
 * spends one unit per image. This is deliberate: each image is a separate system-key
 * vision call, so per-image accounting matches actual shared-resource cost (the earlier
 * per-request accounting undercounted a 10-image message as 1). Only SYSTEM-key
 * downgrades count; a user downgrading onto their *own* OpenRouter key never touches
 * this quota, and genuine guests (who resolve the free model directly, not via the
 * broad-free-fallback) don't either.
 *
 * **Fixed UTC-day window**: the Redis key embeds the UTC date, so the count
 * auto-resets at UTC midnight (a fresh key). `EXPIRE` is set every call purely
 * for cleanup; a missed `EXPIRE` self-heals on the next call and the date-scoped
 * key expires regardless.
 *
 * **Fail-open**: any Redis error logs a warn and allows the call. A counter blip
 * must not break vision for legitimate users — the abuse this guards against is a
 * sustained-volume concern, not a single request, and the rest of the vision
 * pipeline already degrades gracefully on Redis failure.
 */

import type { Redis } from 'ioredis';
import { CACHE_KEY_PREFIXES } from '@tzurot/common-types/constants/redis-keys';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('VisionFallbackQuota');

const KEY_PREFIX = CACHE_KEY_PREFIXES.VISION_SYSTEM_FALLBACK_QUOTA;

/**
 * Default per-user daily ceiling on system-key free-vision fallbacks. The free
 * model (gemma) costs $0, so this cap exists only to stop one user draining the
 * shared OpenRouter free-tier request pool — it can be generous. 100/day leaves
 * comfortable headroom for legitimate image-heavy use while still bounding a
 * single abuser. Intended to become a runtime admin-settings knob.
 */
export const VISION_SYSTEM_FALLBACK_DAILY_LIMIT = 100;

/** TTL for the per-day counter key — 25h gives margin past the UTC-day rollover. */
const QUOTA_KEY_TTL_SECONDS = 25 * 60 * 60;

export class VisionFallbackQuota {
  constructor(
    private readonly redis: Redis,
    private readonly dailyLimit: number = VISION_SYSTEM_FALLBACK_DAILY_LIMIT
  ) {}

  /**
   * Atomically record one system-fallback vision use for `userId` and report
   * whether they remain within the daily cap.
   *
   * @returns `true` if the user is allowed (under the cap, inclusive) — the call
   *   has been counted. `false` if this use would exceed the cap (caller should
   *   fail-fast). Fails OPEN: returns `true` on any Redis error.
   */
  async tryConsume(userId: string): Promise<boolean> {
    const key = this.buildKey(userId);
    try {
      const count = await this.redis.incr(key);
      // Set/refresh expiry every call (cheap; self-heals a missed EXPIRE). The
      // date-scoped key resets the count at UTC midnight regardless.
      await this.redis.expire(key, QUOTA_KEY_TTL_SECONDS);
      const allowed = count <= this.dailyLimit;
      if (!allowed) {
        logger.info(
          { userId, count, dailyLimit: this.dailyLimit },
          'User exceeded daily system-fallback vision quota — failing fast'
        );
      }
      return allowed;
    } catch (error) {
      logger.warn(
        { err: error, userId },
        'Vision fallback quota check failed — failing open (allowing the call)'
      );
      return true;
    }
  }

  /** Build the per-(user, UTC-day) counter key. */
  private buildKey(userId: string): string {
    const utcDay = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    return `${KEY_PREFIX}${userId}:${utcDay}`;
  }
}
