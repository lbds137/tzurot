/**
 * Guest-mode model overrides — extracted from AuthStep.
 *
 * A guest (no BYOK key) never runs a non-free model on the system OpenRouter
 * key. The z.ai piggyback model (`z-ai/glm-4.5-air` — NOT free on OpenRouter)
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
  GUEST_MODE,
  isFreeModel,
  isZaiFreeTierModel,
  ZAI_FREE_TIER_MODEL,
} from '@tzurot/common-types/constants/ai';
import { createLogger } from '@tzurot/common-types/utils/logger';
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
    guestModel = GUEST_MODE.DEFAULT_MODEL;
  } else if (!isFreeModel(guestModel)) {
    logger.warn(
      { userId, configuredModel: guestModel },
      'Free-default config is not a free model — using the free router (check /preset free-default)'
    );
    guestModel = GUEST_MODE.DEFAULT_MODEL;
  }

  logger.info(
    {
      userId,
      originalModel: currentModel,
      guestModel,
    },
    'Guest mode: overriding paid model with free model'
  );

  return {
    personality: {
      ...personality,
      model: guestModel,
      visionModel: guestVisionModel(personality),
    },
  };
}

/** The global free-default ladder step; the hardcoded router when the
 * resolver is absent, `getFreeDefaultConfig()` resolves to null, or the
 * lookup errors. */
async function fetchFreeDefaultModel(configResolver?: LlmConfigResolver): Promise<string> {
  if (!configResolver) {
    return GUEST_MODE.DEFAULT_MODEL;
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
  return GUEST_MODE.DEFAULT_MODEL;
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
    return null;
  }
  logger.info({ userId }, 'Guest upgraded to GLM-4.5-Air on the system coding plan');
  return {
    personality: {
      ...personality,
      model: ZAI_FREE_TIER_MODEL,
      provider: AIProvider.ZaiCoding,
      // z.ai-direct serves text only here; vision keeps the guest rules.
      visionModel: guestVisionModel(personality),
    },
    zaiSystemKey,
  };
}
