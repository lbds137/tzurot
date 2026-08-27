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
 * **Retry idempotency**: `requestId` as the per-user ZSET member makes the
 * per-user count idempotent across BullMQ job retries (a retried job carries
 * the same id → ZADD updates the member's score, ZCARD is unchanged), and a
 * day-scoped NX marker gives the global daily counter the same property —
 * only the FIRST consume of a requestId advances it. A retry that crosses
 * UTC midnight counts once per day (acceptable; the day rolled anyway).
 *
 * The VERDICT is idempotent too, not just the counters: a request already
 * holding a slot in its user's window is re-judged `allowed` without
 * re-running the cap checks. Without that, the second consult of one request
 * — the z.ai piggyback design issues one per admission tier — would read a
 * ZCARD that already includes its own member and, at the boundary, deny the
 * very request holding the last slot.
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

/**
 * The three Redis key roots one quota instance operates on. Defaults to the
 * shared-OpenRouter-key set; the z.ai piggyback instance passes the
 * `zaifreeq:*` counterparts so the two pools never share counters.
 */
export interface FreeTierQuotaKeys {
  /** The single contention-set ZSET key (fixed, not a prefix). */
  activeKey: string;
  /** Per-user rolling request ZSET prefix (+ userId). */
  userRequestsPrefix: string;
  /** Per-UTC-day global counter prefix (+ YYYY-MM-DD). */
  globalPrefix: string;
}

export const OPENROUTER_FREE_TIER_KEYS: FreeTierQuotaKeys = {
  activeKey: FREE_TIER_ACTIVE_KEY,
  userRequestsPrefix: CACHE_KEY_PREFIXES.FREE_TIER_USER_REQUESTS,
  globalPrefix: CACHE_KEY_PREFIXES.FREE_TIER_GLOBAL,
};

export const ZAI_FREE_TIER_KEYS: FreeTierQuotaKeys = {
  activeKey: `${CACHE_KEY_PREFIXES.ZAI_FREE_TIER_ACTIVE}window`,
  userRequestsPrefix: CACHE_KEY_PREFIXES.ZAI_FREE_TIER_USER_REQUESTS,
  globalPrefix: CACHE_KEY_PREFIXES.ZAI_FREE_TIER_GLOBAL,
};

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
  private readonly redis: Redis;
  /** Normalized per-call config provider (see constructor doc). */
  private readonly configProvider: () => FreeTierQuotaConfig;
  /** Set on the first inverted-bounds warn so the log fires once per instance, not per call. */
  private warnedInvertedWindowBounds = false;

  constructor(
    redis: Redis,
    config: FreeTierQuotaConfig | (() => FreeTierQuotaConfig),
    /** Injectable clock (ms) for deterministic tests; defaults to wall time. */
    private readonly now: () => number = () => Date.now(),
    /** Which pool's counters this instance operates on. */
    private readonly keys: FreeTierQuotaKeys = OPENROUTER_FREE_TIER_KEYS
  ) {
    this.redis = redis;
    // A provider is re-evaluated once per decision (tryConsume/cap query), so
    // runtime-tuned budgets (system settings) apply to the NEXT decision
    // without touching this instance's Redis window state. A plain object
    // stays supported for tests and fixed-config callers.
    this.configProvider = typeof config === 'function' ? config : (): FreeTierQuotaConfig => config;
  }

  /**
   * Evaluate + record one free-key request for `userId`. Returns the verdict;
   * on allow the counters have advanced. Fails OPEN (allowed:true) on any Redis
   * error. `requestId` must be unique per logical message and STABLE across job
   * retries (idempotent per-user counting relies on it).
   *
   * The verdict is idempotent per `(userId, requestId)`: a re-consume of a
   * request that already holds a window slot returns `allowed` without
   * re-counting and without re-running the cap checks. Pinned by the
   * same-request boundary tests in `FreeTierRequestQuota.test.ts`.
   */
  async tryConsume(userId: string, requestId: string): Promise<QuotaVerdict> {
    try {
      // One config snapshot per decision — request-level consistency even if
      // an admin edit lands mid-flight.
      const config = this.configProvider();
      const now = this.now();
      const windowMs = config.windowMinutes * 60_000;
      const windowStart = now - windowMs;
      const day = new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

      const activeKey = this.keys.activeKey;
      const userKey = `${this.keys.userRequestsPrefix}${userId}`;
      const globalKey = `${this.keys.globalPrefix}${day}`;

      // Contention N: prune expired, count recent consumers. Excludes the
      // current user pre-decision (added only on allow), so N is "others".
      await this.redis.zremrangebyscore(activeKey, '-inf', windowStart);
      const activeUsers = await this.redis.zcard(activeKey);

      // This user's recent allowed requests (requestId membership = retry-safe).
      await this.redis.zremrangebyscore(userKey, '-inf', windowStart);
      const userCount = await this.redis.zcard(userKey);

      const windowCap = this.computeWindowCap(activeUsers);
      const globalCount = Number((await this.redis.get(globalKey)) ?? 0);

      // Same-request re-consult: this request already holds a window slot, so
      // it is re-judged allowed without advancing anything. One logical
      // request can consult twice (the z.ai piggyback admits a vision tier and
      // a text slot separately), and by then `userCount` INCLUDES this
      // request's own member — re-running the cap checks would count the
      // request against itself and, at the boundary, deny the slot it already
      // holds. The member's score is deliberately not refreshed: the original
      // timestamp must keep pruning on its own schedule.
      if (await this.holdsWindowSlot(userKey, requestId)) {
        return { allowed: true, reason: 'ok', windowCap, activeUsers, userCount, globalCount };
      }

      // Check BEFORE any increment (no reject-bleed). Global hard cap first —
      // it overrides the per-user floor (D4).
      if (globalCount >= config.globalDailyBudget) {
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
      // NX marker: a stalled-and-reprocessed job re-runs tryConsume with the
      // SAME requestId — only the first consume advances the day's counter.
      // Plain SET-NX per the house counter contract (no Lua).
      const dedupKey = `${globalKey}:req:${requestId}`;
      const firstConsume = await this.redis.set(dedupKey, '1', 'EX', GLOBAL_TTL_SECONDS, 'NX');
      if (firstConsume === 'OK') {
        await this.redis.incr(globalKey);
      }
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

  /**
   * The dynamic per-user cap for a given concurrent-user count. The admin
   * write surface enforces `minPerWindow <= maxPerWindow`; this guard is
   * defense-in-depth for direct/legacy config paths and is behavior-preserving
   * for valid configs.
   */
  computeWindowCap(activeUsers: number): number {
    const config = this.configProvider();
    const windowFraction = config.windowMinutes / MINUTES_PER_DAY;
    const raw = Math.floor((config.globalDailyBudget * windowFraction) / Math.max(activeUsers, 1));
    if (config.minPerWindow > config.maxPerWindow && !this.warnedInvertedWindowBounds) {
      this.warnedInvertedWindowBounds = true;
      logger.warn(
        { minPerWindow: config.minPerWindow, maxPerWindow: config.maxPerWindow },
        'Free-tier window bounds are inverted (min > max) — clamping with the swapped pair'
      );
    }
    const floor = Math.min(config.minPerWindow, config.maxPerWindow);
    const ceiling = Math.max(config.minPerWindow, config.maxPerWindow);
    return Math.max(floor, Math.min(ceiling, raw));
  }

  /**
   * Whether `requestId` is already a member of this user's rolling window —
   * i.e. an earlier consult of the SAME request took a slot. A probe failure
   * resolves to `false` so the caller falls through to the normal
   * check-then-increment path instead of short-circuiting on a Redis blip;
   * the outer fail-open handler still covers every other command.
   */
  private async holdsWindowSlot(userKey: string, requestId: string): Promise<boolean> {
    try {
      return (await this.redis.zscore(userKey, requestId)) !== null;
    } catch (error) {
      logger.warn(
        { err: error, requestId },
        'Free-tier window-slot membership probe failed — treating the request as new'
      );
      return false;
    }
  }

  private logDeny(
    reason: QuotaDenyReason,
    userId: string,
    fields: { windowCap: number; activeUsers: number; userCount: number; globalCount: number }
  ): void {
    logger.info(
      { userId, reason, ...fields, dailyBudget: this.configProvider().globalDailyBudget },
      reason === 'global'
        ? 'Free-tier daily global budget exhausted — denying free-key request'
        : 'User over rolling free-tier share — denying free-key request'
    );
  }
}
