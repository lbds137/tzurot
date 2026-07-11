/**
 * Guest-mode model overrides — extracted from AuthStep.
 *
 * A guest (no BYOK key) never runs a non-free model on the system OpenRouter
 * key. The admin free-default preset may be the z.ai piggyback model
 * (`z-ai/glm-4.5-air` — deliberately selectable, NOT free on OpenRouter):
 * per-request admission decides whether the guest rides it on the system
 * coding-plan key, and every denial degrades SILENTLY to the
 * FREE_ROUTER_MODEL dynamic router. A misconfigured paid free-default gets
 * the same router substitution — the paid-model-on-system-key class is
 * unrepresentable through this path.
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

  // Override to guest default
  let guestModel: string = GUEST_MODE.DEFAULT_MODEL;

  // Try to get free default from database
  if (deps.configResolver) {
    try {
      const freeConfig = await deps.configResolver.getFreeDefaultConfig();
      if (freeConfig !== null) {
        guestModel = freeConfig.model;
        logger.debug({ model: guestModel }, 'Using database free default config');
      }
    } catch (error) {
      logger.warn({ err: error }, 'Failed to get free default config, using hardcoded fallback');
    }
  }

  // Guests never run a non-free model on the system OpenRouter key. The
  // piggyback model upgrades to z.ai when admitted; everything else (or a
  // denial) lands on the dynamic free router.
  if (isZaiFreeTierModel(guestModel)) {
    const upgrade = await tryZaiFreeTierUpgrade(deps, personality, userId, requestId);
    if (upgrade !== null) {
      return upgrade;
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

/**
 * The z.ai free-tier upgrade: admitted guests get the bare piggyback model on
 * the coding-plan key with `provider: zai-coding` so ModelFactory routes
 * z.ai-direct. Null (degrade to the router) on any denial.
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
    logger.info(
      { userId, reason: verdict.reason },
      'z.ai free-tier denied — guest degrades to the free router'
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
