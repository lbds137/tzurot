/**
 * Hop-1 floor promotion for the reactive quota-fallback runner.
 *
 * Picks the configured floor as the first retarget when no tier-aware target exists.
 */

import { AIProvider } from '@tzurot/common-types/constants/ai';
import { ApiErrorCategory } from '@tzurot/common-types/constants/error';
import { getSystemSetting } from '@tzurot/common-types/services/SystemSettingsService';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getFreeTextFloor } from '../../../../services/freeFloors.js';
import {
  isRouteAttempted,
  selectFloorTarget,
  type AttemptedRoute,
  type classifyQuotaFailure,
  type QuotaFallbackCaches,
  type QuotaFallbackTarget,
} from '../../../../services/quotaFallback.js';
import { SYSTEM_CACHE_KEY_ID } from '../../../../services/RateLimitCache.js';
import type { GenerateAttemptOpts } from './autoPromotionFallback.js';

const logger = createLogger('QuotaFallbackRunner');

/**
 * The floor promoted to HOP 1, for the turns that have no tier-aware retarget
 * at all: a guest already running the free default, or a user whose global
 * default is the failing model. Invariant — such a turn can never produce a
 * hop-1 target, so without this the floor is unreachable and the turn is
 * terminal. The returned target flows through the SAME downstream path a
 * normal hop-1 target takes (credential resolution, metering, the audit line,
 * the retry); `attemptFloorHop` then self-excludes because hop 2's
 * `excludeModels` already carries this model as `info.toModel`. Pinned by
 * `quotaFallbackRunner.test.ts` › "hop-1 floor promotion".
 *
 * Category-agnostic on purpose: ANY retargetable category that dead-ends on
 * a same-model tiered selection gets the floor (a dead end is a dead end,
 * whatever produced it) — with one carve-out.
 *
 * Deliberately NOT extended to CREDIT_EXHAUSTION, whose terminal selection is
 * a policy, not an oversight: for a guest the system key itself is broke and
 * no different billing entity exists, and a BYOK user's floor would run on
 * that same broke account. Whether OpenRouter still serves `:free` routes on
 * a credit-exhausted key is an unverified external claim, so this arm stays
 * exactly as terminal as it is today.
 *
 * Routes the primary already attempted (`excludeRoutes`) are excluded, so the
 * floor never re-runs a route that already failed this job.
 *
 * Viability identity mirrors `selectQuotaFallbackTarget`: guest semantics
 * execute on the system key, so they are checked under the system bucket;
 * everyone else under their own. Never throws — a floor-selection failure
 * degrades to null and the pristine original propagates.
 */
export async function selectHopOneFloorTarget(params: {
  category: NonNullable<ReturnType<typeof classifyQuotaFailure>>;
  opts: GenerateAttemptOpts;
  cacheKeyId: string;
  caches: QuotaFallbackCaches;
  excludeRoutes?: readonly AttemptedRoute[];
}): Promise<QuotaFallbackTarget | null> {
  const { category, opts, cacheKeyId, caches, excludeRoutes } = params;
  const failingModel = opts.personality.model;
  if (category === ApiErrorCategory.CREDIT_EXHAUSTION) {
    logger.debug(
      { jobId: opts.jobId, failingModel, isGuestMode: opts.isGuestMode, category },
      'No hop-1 retarget and the floor is not attempted: credit exhaustion leaves no solvent billing entity'
    );
    return null;
  }
  const floorTarget = await selectFloorTarget({
    isGuestMode: opts.isGuestMode,
    excludeModels: [failingModel],
    excludeRoutes,
    cacheKeyId: opts.isGuestMode ? SYSTEM_CACHE_KEY_ID : cacheKeyId,
    caches,
  }).catch((err: unknown) => {
    // A selection failure is not a veto — log it as itself so it can't hide
    // under the "unavailable" message below.
    logger.warn(
      { err, jobId: opts.jobId, failingModel, isGuestMode: opts.isGuestMode },
      'Floor selection threw — treating the floor as unavailable'
    );
    return null;
  });
  if (floorTarget === null) {
    // Which unavailability cause applies is diagnosable from the floor id
    // itself: empty = unconfigured, equal to the failing model = excluded,
    // already attempted = the primary ran that route, anything else = the doom
    // caches or the catalog vetoed a configured floor (the label names only
    // the doom caches).
    const floor = opts.isGuestMode ? getFreeTextFloor() : getSystemSetting('fallbackTextModel');
    let cause: string;
    if (floor.length === 0) {
      cause = 'no floor model is configured';
    } else if (floor === failingModel) {
      cause = 'the floor IS the failing model';
    } else if (isRouteAttempted({ provider: AIProvider.OpenRouter, model: floor }, excludeRoutes)) {
      cause = 'this job already attempted the floor route';
    } else {
      cause = 'the doom caches veto it';
    }
    logger.debug(
      {
        jobId: opts.jobId,
        failingModel,
        floorModel: floor,
        isGuestMode: opts.isGuestMode,
        category,
        cause,
      },
      'No hop-1 retarget and the floor is unavailable — terminal'
    );
    return null;
  }
  logger.info(
    {
      jobId: opts.jobId,
      failingModel,
      floorModel: floorTarget.config.model,
      isGuestMode: opts.isGuestMode,
      category,
    },
    'No hop-1 retarget available — promoting the floor to the hop-1 target'
  );
  return floorTarget;
}
