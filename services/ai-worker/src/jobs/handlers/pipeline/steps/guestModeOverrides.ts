/**
 * Guest-mode model overrides — extracted from AuthStep.
 *
 * A guest (no BYOK key) never runs a non-free model on the system OpenRouter
 * key. The z.ai piggyback model (`z-ai/glm-4.7` — NOT free on OpenRouter)
 * is CONDITIONALLY free (owner semantics): while per-request admission holds
 * (flag + key + kill switch + plan headroom + quota), it behaves like any
 * free model at every resolution step — personal selection or global
 * free-default. When admission fails, the model leaves the pool for the
 * whole request and resolution continues down the normal guest ladder:
 * personal selection → global free-default → FREE_ROUTER_MODEL last resort.
 * A misconfigured paid free-default gets the same router substitution — the
 * paid-model-on-system-key class is unrepresentable through this path.
 */

import {
  AIProvider,
  isFreeModel,
  isZaiFreeTierModel,
  ZAI_FREE_TIER_MODEL,
} from '@tzurot/common-types/constants/ai';
import { getFreeTextFloor } from '../../../../services/freeFloors.js';
import { GUEST_MODE_CATEGORY } from '@tzurot/common-types/constants/error';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  logQuotaFallbackAudit,
  type QuotaFallbackInfo,
} from '../../../../services/quotaFallback.js';
import { SYSTEM_CACHE_KEY_ID } from '../../../../services/RateLimitCache.js';
import type { LlmConfigResolver } from '@tzurot/config-resolver';
import type { ZaiFreeTierAdmission } from '../../../../services/ZaiFreeTierAdmission.js';
import type { GenerationContext } from '../types.js';

const logger = createLogger('guestModeOverrides');

type EffectivePersonality = NonNullable<GenerationContext['config']>['effectivePersonality'];

export interface GuestOverrideDeps {
  configResolver?: LlmConfigResolver;
  /** z.ai free-tier piggyback gate; absent (tests/dark) means never upgrade. */
  zaiFreeTierAdmission?: ZaiFreeTierAdmission;
}

export interface GuestOverrideResult {
  personality: EffectivePersonality;
  /** Set when the z.ai upgrade was admitted — the system coding-plan key. */
  zaiSystemKey?: string;
  /**
   * The footer announce carrier, set only when guest mode actually rewrote
   * `personality.model`. An already-free model is served unchanged, so it
   * carries nothing — there is no substitution to announce.
   */
  quotaFallback?: QuotaFallbackInfo;
}

/**
 * Build the announce carrier for a guest substitution, or `undefined` when the
 * model did not actually change. Guests always run on a system key, so the
 * audit line names the shared bucket directly.
 */
function announceGuestSubstitution(
  fromModel: string,
  toModel: string,
  requestId: string
): QuotaFallbackInfo | undefined {
  if (fromModel === toModel) {
    return undefined;
  }
  const info: QuotaFallbackInfo = {
    fromModel,
    toModel,
    category: GUEST_MODE_CATEGORY,
    mode: 'proactive',
  };
  logQuotaFallbackAudit(info, {
    jobId: undefined,
    requestId,
    cacheKeyId: SYSTEM_CACHE_KEY_ID,
  });
  return info;
}

/** The guest vision rule: keep the vision model only when it is itself free. */
function guestVisionModel(personality: EffectivePersonality): string | undefined {
  return personality.visionModel !== undefined &&
    personality.visionModel.length > 0 &&
    isFreeModel(personality.visionModel)
    ? personality.visionModel
    : undefined;
}

/** Apply guest mode model overrides (see module doc). */
export async function applyGuestModeOverrides(
  deps: GuestOverrideDeps,
  personality: EffectivePersonality,
  userId: string,
  requestId: string
): Promise<GuestOverrideResult> {
  const currentModel = personality.model;

  // If current model is already free, no change needed
  if (isFreeModel(currentModel)) {
    logger.info({ userId, model: personality.model }, 'Guest mode active - using free model');
    return { personality };
  }

  // Once admission denies, the piggyback model is out of the pool for the
  // REST of this request's resolution — and admit() must not run twice
  // (admission consumes the guest's quota share when it admits).
  let zaiUnavailable = false;

  // A personally-selected piggyback model is conditionally free: admitted →
  // serve it; denied → it leaves the pool and resolution falls through to
  // the global free-default like any other unavailable model.
  if (isZaiFreeTierModel(currentModel)) {
    const upgrade = await tryZaiFreeTierUpgrade(deps, personality, userId, requestId);
    if (upgrade !== null) {
      return upgrade;
    }
    zaiUnavailable = true;
    logger.info(
      { userId, originalModel: currentModel },
      'Guest-selected piggyback model unavailable — continuing down the free-model ladder'
    );
  }

  // Next ladder step: the global free default
  let guestModel = await fetchFreeDefaultModel(deps.configResolver);

  // Guests never run a non-free model on the system OpenRouter key. The
  // piggyback model upgrades to z.ai when admitted; a denial (or an earlier
  // denial this request) removes it from the pool → last-resort router.
  if (isZaiFreeTierModel(guestModel)) {
    if (!zaiUnavailable) {
      const upgrade = await tryZaiFreeTierUpgrade(deps, personality, userId, requestId);
      if (upgrade !== null) {
        return upgrade;
      }
    }
    guestModel = getFreeTextFloor();
  } else if (!isFreeModel(guestModel)) {
    logger.warn(
      { userId, configuredModel: guestModel },
      'Free-default config is not a free model — using the free router (check /preset global free-default)'
    );
    guestModel = getFreeTextFloor();
  }

  logger.info(
    {
      userId,
      originalModel: currentModel,
      guestModel,
    },
    'Guest mode: overriding paid model with free model'
  );

  const quotaFallback = announceGuestSubstitution(currentModel, guestModel, requestId);

  return {
    personality: {
      ...personality,
      model: guestModel,
      visionModel: guestVisionModel(personality),
    },
    ...(quotaFallback !== undefined ? { quotaFallback } : {}),
  };
}

/** The global free-default ladder step; the hardcoded router when the
 * resolver is absent, `getFreeDefaultConfig()` resolves to null, or the
 * lookup errors. */
async function fetchFreeDefaultModel(configResolver?: LlmConfigResolver): Promise<string> {
  if (!configResolver) {
    return getFreeTextFloor();
  }
  try {
    const freeConfig = await configResolver.getFreeDefaultConfig();
    if (freeConfig !== null) {
      logger.debug({ model: freeConfig.model }, 'Using database free default config');
      return freeConfig.model;
    }
  } catch (error) {
    logger.warn({ err: error }, 'Failed to get free default config, using hardcoded fallback');
  }
  return getFreeTextFloor();
}

/**
 * The z.ai free-tier upgrade: admitted guests get the bare piggyback model on
 * the coding-plan key with `provider: zai-coding` so ModelFactory routes
 * z.ai-direct. Null on any denial — the model leaves the pool and the caller
 * continues down the free-model ladder.
 */
async function tryZaiFreeTierUpgrade(
  deps: GuestOverrideDeps,
  personality: EffectivePersonality,
  userId: string,
  requestId: string
): Promise<GuestOverrideResult | null> {
  if (deps.zaiFreeTierAdmission === undefined) {
    return null;
  }
  const verdict = await deps.zaiFreeTierAdmission.admit(userId, requestId);
  if (!verdict.admitted) {
    // Destination is the caller's to log — a personal-selection denial
    // cascades to the global free-default, not straight to the router.
    logger.info(
      { userId, reason: verdict.reason },
      'z.ai free-tier denied — piggyback model leaves the pool for this request'
    );
    return null;
  }
  const zaiSystemKey = deps.zaiFreeTierAdmission.systemKey();
  if (zaiSystemKey === undefined) {
    // Admission already consumed the guest's quota share; without this line
    // the key-vanished fall-through is indistinguishable from a plain denial.
    logger.warn(
      { userId },
      'z.ai admitted but the system key vanished — falling through with quota consumed'
    );
    return null;
  }
  logger.info(
    { userId, model: ZAI_FREE_TIER_MODEL },
    'Guest upgraded to the piggyback model on the system coding plan'
  );
  // A guest who personally selected the BARE piggyback id lands here with no
  // model change at all, and gets no note; the `z-ai/`-prefixed form and the
  // free-default arm both do change it, so both announce.
  const quotaFallback = announceGuestSubstitution(
    personality.model,
    ZAI_FREE_TIER_MODEL,
    requestId
  );
  return {
    personality: {
      ...personality,
      model: ZAI_FREE_TIER_MODEL,
      provider: AIProvider.ZaiCoding,
      // z.ai-direct serves text only here; vision keeps the guest rules.
      visionModel: guestVisionModel(personality),
    },
    zaiSystemKey,
    ...(quotaFallback !== undefined ? { quotaFallback } : {}),
  };
}
