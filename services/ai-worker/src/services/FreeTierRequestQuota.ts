/**
 * Free-Tier Request Quota — rolling-window fair share for the SHARED system
 * OpenRouter free-tier key.
 *
 * **Why this exists**: users without their own OpenRouter key (BYOK) run on a
 * shared system key's free tier. One heavy free user can exhaust that key's
 * daily free-request allowance and starve everyone (mystery outages). This caps
 * each user's consumption dynamically — the cap shrinks as more users are
 * concurrently active and loosens when the bot is quiet — while a daily global
 * counter is the hard ceiling that protects the key absolutely.
 *
 * **Rolling contention window** (owner decision): "active users" are those who
 * consumed the free key within the last `windowMinutes` (a ZSET pruned by
 * timestamp), NOT cumulative daily uniques — so the cap reflects CURRENT load
 * and no one is retroactively cut off when the crowd grows and shrinks.
 *
 * **Per-user cap** = `clamp( globalDailyBudget * window/day / max(N,1), MIN, MAX )`.
 * A lone user gets up to MAX; under contention the cap tightens toward the
 * window's fair slice but never below MIN. The daily global cap overrides the
 * floor — the key's real limit is physical, so denying a floor-entitled user
 * beats 402-ing the whole bot.
 *
 * **Check-then-increment**: limits are evaluated BEFORE any counter moves, and
 * counters advance ONLY on allow — so a denied request never bleeds the shared
 * budget. Deliberately NOT wrapped in a Lua script (per project preference).
 * The residual gap is a non-atomic check-then-incr TOCTOU near a boundary — a
 * bounded burst overshoot, BOTH same-user (per-user cap) and cross-user (the
 * global cap, when several guests interleave get→incr around the daily budget).
 * Both fail on the permissive side and are backstopped by the downstream
 * RateLimitCache/CreditExhaustionCache doom-caches (the real key limit sits
 * above the configured budget), so atomicity isn't worth the machinery here.
 *
 * **requestId as the per-user ZSET member** makes counting idempotent across
 * BullMQ job retries (a retried job carries the same id → ZADD updates the
 * member's score, ZCARD is unchanged).
 *
 * **Fail-open**: any Redis error logs a warn and ALLOWS the request. A counter
 * blip must not break generation for legitimate users.
 */

import type { Redis } from 'ioredis';
import { CACHE_KEY_PREFIXES } from '@tzurot/common-types/constants/redis-keys';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('FreeTierRequestQuota');

/**
 * Sentinel error message thrown when a guest is over their free-tier share.
 * `apiErrorParser`'s `/free-tier fair-share/i` pattern classifies it as
 * `ApiErrorCategory.FREE_TIER_QUOTA` → the friendly "bring your own key"
 * message. Keep the two in sync.
 */
export const FREE_TIER_QUOTA_ERROR_MESSAGE = 'Free-tier fair-share quota reached for this user';

/** Minutes in a day — the denominator turning the daily budget into a window slice. */
const MINUTES_PER_DAY = 1440;

/** Extra TTL beyond the window so a rolling key survives a full quiet window. */
const WINDOW_TTL_MARGIN_SECONDS = 5 * 60;

/** TTL for the daily global counter — 25h clears the UTC-day rollover. */
const GLOBAL_TTL_SECONDS = 25 * 60 * 60;

/**
 * The single global contention-set key (the `FREE_TIER_ACTIVE` prefix + a fixed
 * suffix — the prefix carries a trailing colon per the redis-keys grammar).
 */
export const FREE_TIER_ACTIVE_KEY = `${CACHE_KEY_PREFIXES.FREE_TIER_ACTIVE}window`;

export interface FreeTierQuotaConfig {
  /** The shared free key's daily free-request allowance (the pie). */
  globalDailyBudget: number;
  /** Rolling contention window length, in minutes. */
  windowMinutes: number;
  /** Per-user floor: everyone gets at least this per window when budget permits. */
  minPerWindow: number;
  /** Per-user ceiling: a lone user can't drain the whole pie. */
  maxPerWindow: number;
}

export type QuotaDenyReason = 'global' | 'user';

export interface QuotaVerdict {
  /** True if the request is allowed (and, unless fail-open, has been counted). */
  allowed: boolean;
  /** Why it was denied, or 'ok'/'fail-open' when allowed. */
  reason: 'ok' | QuotaDenyReason | 'fail-open';
  /** The dynamic per-user window cap that applied. */
  windowCap: number;
  /** N — recent concurrent consumers (excludes the current request pre-decision). */
  activeUsers: number;
  /** This user's recent request count in the window (before this request). */
  userCount: number;
  /** Today's global count on the free key. */
  globalCount: number;
}

export class FreeTierRequestQuota {
  constructor(
    private readonly redis: Redis,
    private readonly config: FreeTierQuotaConfig,
    /** Injectable clock (ms) for deterministic tests; defaults to wall time. */
    private readonly now: () => number = () => Date.now()
  ) {}

  /**
   * Evaluate + record one free-key request for `userId`. Returns the verdict;
   * on allow the counters have advanced. Fails OPEN (allowed:true) on any Redis
   * error. `requestId` must be unique per logical message and STABLE across job
   * retries (idempotent per-user counting relies on it).
   */
  async tryConsume(userId: string, requestId: string): Promise<QuotaVerdict> {
    try {
      const now = this.now();
      const windowMs = this.config.windowMinutes * 60_000;
      const windowStart = now - windowMs;
      const day = new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

      const activeKey = FREE_TIER_ACTIVE_KEY;
      const userKey = `${CACHE_KEY_PREFIXES.FREE_TIER_USER_REQUESTS}${userId}`;
      const globalKey = `${CACHE_KEY_PREFIXES.FREE_TIER_GLOBAL}${day}`;

      // Contention N: prune expired, count recent consumers. Excludes the
      // current user pre-decision (added only on allow), so N is "others".
      await this.redis.zremrangebyscore(activeKey, '-inf', windowStart);
      const activeUsers = await this.redis.zcard(activeKey);

      // This user's recent allowed requests (requestId membership = retry-safe).
      await this.redis.zremrangebyscore(userKey, '-inf', windowStart);
      const userCount = await this.redis.zcard(userKey);

      const windowCap = this.computeWindowCap(activeUsers);
      const globalCount = Number((await this.redis.get(globalKey)) ?? 0);

      // Check BEFORE any increment (no reject-bleed). Global hard cap first —
      // it overrides the per-user floor (D4).
      if (globalCount >= this.config.globalDailyBudget) {
        this.logDeny('global', userId, { windowCap, activeUsers, userCount, globalCount });
        return { allowed: false, reason: 'global', windowCap, activeUsers, userCount, globalCount };
      }
      if (userCount >= windowCap) {
        this.logDeny('user', userId, { windowCap, activeUsers, userCount, globalCount });
        return { allowed: false, reason: 'user', windowCap, activeUsers, userCount, globalCount };
      }

      // Allow: advance counters (only now). Rolling keys get window+margin TTL;
      // the daily global gets 25h.
      const windowTtl = Math.ceil(windowMs / 1000) + WINDOW_TTL_MARGIN_SECONDS;
      await this.redis.zadd(activeKey, now, userId);
      await this.redis.zadd(userKey, now, requestId);
      await this.redis.incr(globalKey);
      await this.redis.expire(activeKey, windowTtl);
      await this.redis.expire(userKey, windowTtl);
      await this.redis.expire(globalKey, GLOBAL_TTL_SECONDS);

      return { allowed: true, reason: 'ok', windowCap, activeUsers, userCount, globalCount };
    } catch (error) {
      logger.warn(
        { err: error, userId },
        'Free-tier quota check failed — failing open (allowing the request)'
      );
      return {
        allowed: true,
        reason: 'fail-open',
        windowCap: 0,
        activeUsers: 0,
        userCount: 0,
        globalCount: 0,
      };
    }
  }

  /** The dynamic per-user cap for a given concurrent-user count. */
  computeWindowCap(activeUsers: number): number {
    const windowFraction = this.config.windowMinutes / MINUTES_PER_DAY;
    const raw = Math.floor(
      (this.config.globalDailyBudget * windowFraction) / Math.max(activeUsers, 1)
    );
    return Math.max(this.config.minPerWindow, Math.min(this.config.maxPerWindow, raw));
  }

  private logDeny(
    reason: QuotaDenyReason,
    userId: string,
    fields: { windowCap: number; activeUsers: number; userCount: number; globalCount: number }
  ): void {
    logger.info(
      { userId, reason, ...fields, dailyBudget: this.config.globalDailyBudget },
      reason === 'global'
        ? 'Free-tier daily global budget exhausted — denying free-key request'
        : 'User over rolling free-tier share — denying free-key request'
    );
  }
}
