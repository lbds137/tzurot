/**
 * z.ai free-tier admission — the single gate deciding whether a GUEST request
 * may ride GLM-4.5-Air on the owner's coding-plan key.
 *
 * Admission requires ALL of (checked cheapest-first):
 *   1. `ZAI_FREE_TIER_ENABLED` on and the system coding-plan key present.
 *   2. Kill switch absent (set on account-problem business codes; manual DEL
 *      to reset — the plan being in arrears/disabled is never retried into).
 *   3. Exhausted-cooldown absent (set until the plan window's reset when z.ai
 *      reports window exhaustion — retrying earlier is futile).
 *   4. Headroom: the plan's tighter usage window is under
 *      `ZAI_FREE_TIER_HEADROOM_PERCENT` consumed. The live meter reads TOTAL
 *      plan consumption — the owner's own coding, fact extraction, AND the
 *      backfill — so guests are always the first (and only) traffic shed when
 *      the plan is busy. A null reading (endpoint down/drifted) leaves the
 *      gate OPEN: the static daily budget below still bounds volume.
 *   5. Fair share: the per-user rolling-window + global-daily allocator
 *      (a second `FreeTierRequestQuota` over the `zaifreeq:*` pool) admits.
 *
 * Denial is SILENT by design (owner decision): the caller degrades to the
 * FREE_ROUTER_MODEL dynamic router — never an error, never a paid OpenRouter
 * model. The reply footer keeps disclosing whichever model actually served.
 */

import type { Redis } from 'ioredis';
import {
  ZAI_FREE_TIER_KILL_SWITCH_KEY,
  ZAI_FREE_TIER_EXHAUSTED_KEY,
} from '@tzurot/common-types/constants/redis-keys';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { FreeTierRequestQuota } from './FreeTierRequestQuota.js';
import type { ZaiPlanMeter } from './ZaiPlanMeter.js';

const logger = createLogger('ZaiFreeTierAdmission');

export type ZaiAdmissionDenyReason =
  'disabled' | 'kill-switch' | 'window-exhausted' | 'headroom' | 'quota';

export interface ZaiAdmissionVerdict {
  admitted: boolean;
  reason: 'ok' | ZaiAdmissionDenyReason;
}

export interface ZaiAdmissionOptions {
  enabled: boolean;
  apiKey: string | undefined;
  headroomPercent: number;
}

/**
 * Boot-time coherence check (mirrors extraction's
 * `logZaiCoherenceMisconfigurations`): the flag without the key silently
 * degrades every guest to the free router, which looks like the feature is
 * on but never firing — say so loudly at startup instead.
 */
export function logZaiFreeTierBootCoherence(config: {
  ZAI_FREE_TIER_ENABLED?: string;
  ZAI_CODING_API_KEY?: string;
}): void {
  if (
    config.ZAI_FREE_TIER_ENABLED === 'true' &&
    (config.ZAI_CODING_API_KEY === undefined || config.ZAI_CODING_API_KEY.length === 0)
  ) {
    logger.error(
      'ZAI_FREE_TIER_ENABLED=true but ZAI_CODING_API_KEY is not set — guests silently degrade to the free router; set the key or turn the flag off'
    );
  }
}

export class ZaiFreeTierAdmission {
  constructor(
    private readonly redis: Redis,
    private readonly quota: FreeTierRequestQuota,
    private readonly meter: ZaiPlanMeter,
    private readonly options: ZaiAdmissionOptions
  ) {}

  /** True only when the feature can ever admit (flag on + key present). */
  isEnabled(): boolean {
    return (
      this.options.enabled && this.options.apiKey !== undefined && this.options.apiKey.length > 0
    );
  }

  /** The system coding-plan key an admitted upgrade runs on. */
  systemKey(): string | undefined {
    return this.isEnabled() ? this.options.apiKey : undefined;
  }

  /**
   * Evaluate one guest request. On admit, the fair-share counters have
   * advanced (`requestId` keeps retries idempotent per user). Gate checks
   * fail OPEN on Redis errors — the static allocator inside `quota` is the
   * last line and itself fails open, matching the house counter contract.
   */
  async admit(userId: string, requestId: string): Promise<ZaiAdmissionVerdict> {
    if (!this.isEnabled()) {
      return { admitted: false, reason: 'disabled' };
    }

    const blocked = await this.checkBlockingFlags();
    if (blocked !== null) {
      return { admitted: false, reason: blocked };
    }

    const reading = await this.meter.getReading();
    if (reading !== null && reading.tighterWindowConsumedPct >= this.options.headroomPercent) {
      logger.info(
        {
          userId,
          consumedPct: reading.tighterWindowConsumedPct,
          headroomPercent: this.options.headroomPercent,
          resetAt: reading.resetAt?.toISOString(),
        },
        'z.ai free tier closed — plan window past the headroom threshold'
      );
      return { admitted: false, reason: 'headroom' };
    }

    const verdict = await this.quota.tryConsume(userId, requestId);
    if (!verdict.allowed) {
      return { admitted: false, reason: 'quota' };
    }
    return { admitted: true, reason: 'ok' };
  }

  /** Kill switch / window-exhausted flags; Redis failure ⇒ not blocked (fail-open). */
  private async checkBlockingFlags(): Promise<'kill-switch' | 'window-exhausted' | null> {
    try {
      const [killSwitch, exhausted] = await Promise.all([
        this.redis.exists(ZAI_FREE_TIER_KILL_SWITCH_KEY),
        this.redis.exists(ZAI_FREE_TIER_EXHAUSTED_KEY),
      ]);
      if (killSwitch > 0) {
        return 'kill-switch';
      }
      if (exhausted > 0) {
        return 'window-exhausted';
      }
      return null;
    } catch (error) {
      logger.warn({ err: error }, 'z.ai admission flag check failed — treating as not blocked');
      return null;
    }
  }
}
