/**
 * Demotion tier of the proactive quota check (extracted from AuthStep for the
 * 400-line cap; pure function over the resolved auth — no class state).
 *
 * When the resolved route is an auto-promotion whose z.ai side is already
 * known-doomed, and the pre-computed OpenRouter passthrough's own pool is NOT
 * doomed, swap to the passthrough instead of retargeting away from the model —
 * z.ai coding-plan quota is not OpenRouter quota, and the user configured this
 * model on purpose. Returns null when not applicable (not promoted, no
 * fallback, or the passthrough is doomed too — the quota retarget then
 * proceeds).
 */

import { AIProvider } from '@tzurot/common-types/constants/ai';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  checkModelViability,
  type QuotaFallbackCaches,
  type QuotaFallbackCategory,
  type QuotaFallbackInfo,
} from '../../../../services/quotaFallback.js';
import { deriveCacheKeyId } from '../../../../services/RateLimitCache.js';

const logger = createLogger('PromotionDemotion');

/** The slice of resolved LLM auth the demotion reads and rewrites. */
export interface DemotableAuth {
  effectivePersonality: { model: string; provider?: string } & Record<string, unknown>;
  resolvedApiKey: string | undefined;
  resolvedProvider: AIProvider | undefined;
  isGuestMode: boolean;
  wasAutoPromoted?: boolean;
  fallback?: {
    apiKey: string;
    provider: string;
    model: string;
    isGuestMode: boolean;
  };
}

/**
 * Try to demote a doomed promotion to its OpenRouter passthrough.
 *
 * @param llmAuth resolved auth (already established as NON-viable by the caller)
 * @param category the doom category from the caller's shared viability check
 * @returns the demoted auth (+ footer announce info), or null when not applicable
 */
export async function tryPromotionDemotion<T extends DemotableAuth>(
  llmAuth: T,
  userId: string,
  category: QuotaFallbackCategory,
  caches: QuotaFallbackCaches | undefined
): Promise<(T & { quotaFallback: QuotaFallbackInfo }) | null> {
  if (caches === undefined || llmAuth.wasAutoPromoted !== true || llmAuth.fallback === undefined) {
    return null;
  }

  // Owner-cost boundary: a guest-mode fallback resolved onto the SYSTEM
  // OpenRouter key (user has a z.ai key but no OpenRouter key). Demoting would
  // run the PAID z-ai/<model> on the owner's key every message of the doom
  // window — skip; the quota retarget below handles guest mode correctly
  // (free default on the system key).
  if (llmAuth.fallback.isGuestMode) {
    return null;
  }

  const fallbackViability = await checkModelViability({
    model: llmAuth.fallback.model,
    cacheKeyId: deriveCacheKeyId(llmAuth.fallback.apiKey, userId),
    caches,
  });
  if (!fallbackViability.viable) {
    return null; // both pools doomed — let the quota retarget pick a new model
  }

  logger.info(
    {
      userId,
      promotedModel: llmAuth.effectivePersonality.model,
      fallbackModel: llmAuth.fallback.model,
      category,
    },
    'Promoted z.ai route known-doomed — demoting to OpenRouter passthrough (same model)'
  );

  return {
    ...llmAuth,
    effectivePersonality: {
      ...llmAuth.effectivePersonality,
      model: llmAuth.fallback.model,
      provider: llmAuth.fallback.provider,
    },
    resolvedApiKey: llmAuth.fallback.apiKey,
    isGuestMode: llmAuth.fallback.isGuestMode,
    resolvedProvider: AIProvider.OpenRouter,
    // The footer renders this as "glm-5.2 → z-ai/glm-5.2 (rate limited)" —
    // the user sees the demotion, mirroring the quota-retarget announce path.
    quotaFallback: {
      fromModel: llmAuth.effectivePersonality.model,
      toModel: llmAuth.fallback.model,
      category,
      mode: 'proactive',
    },
    // The passthrough is consumed; a failure downstream must not retry the
    // demoted-away z.ai route.
    wasAutoPromoted: undefined,
    fallback: undefined,
  };
}
