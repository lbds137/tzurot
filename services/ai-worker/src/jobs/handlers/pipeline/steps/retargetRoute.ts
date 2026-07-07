/**
 * Retarget route resolution for the proactive quota fallback (kept out of
 * AuthStep for the 400-line cap; pure functions over injected deps).
 *
 * Resolves the (config, key, guest-mode) triple a quota retarget should run
 * on. The load-bearing policy: when the paid target needs the user's own
 * OpenRouter key and they have none, degrade to the FREE default on the
 * system key (guest semantics, zero owner cost) — a failed request is a worse
 * experience than a degraded one (owner policy), and the paid default must
 * never ride the system key.
 */

import { AIProvider } from '@tzurot/common-types/constants/ai';
import type { LlmConfigResolver } from '@tzurot/config-resolver';
import type { ApiKeyResolver } from '../../../../services/ApiKeyResolver.js';
import {
  selectQuotaFallbackTarget,
  type QuotaFallbackCaches,
  type QuotaFallbackCategory,
} from '../../../../services/quotaFallback.js';

type QuotaTarget = NonNullable<Awaited<ReturnType<typeof selectQuotaFallbackTarget>>>;

export interface RetargetRouteDeps {
  apiKeyResolver: ApiKeyResolver | undefined;
  configResolver: LlmConfigResolver | undefined;
  caches: QuotaFallbackCaches | undefined;
}

export interface ResolvedRetargetRoute {
  config: QuotaTarget['config'];
  apiKey: string | undefined;
  isGuestMode: boolean;
}

/**
 * Resolve the credential + config triple for a selected quota target.
 * Null aborts the retarget (the doomed request proceeds and fails as before).
 */
export async function resolveRetargetRoute(options: {
  target: QuotaTarget;
  personality: { model: string; provider?: string };
  apiKey: string | undefined;
  isGuestMode: boolean;
  userId: string;
  category: QuotaFallbackCategory;
  cacheKeyId: string;
  deps: RetargetRouteDeps;
}): Promise<ResolvedRetargetRoute | null> {
  const { target, personality, apiKey, isGuestMode, userId, category, cacheKeyId, deps } = options;

  if (target.forceSystemKey) {
    const systemKey = await deps.apiKeyResolver?.resolveSystemOpenRouterKey();
    return systemKey === undefined
      ? null
      : { config: target.config, apiKey: systemKey, isGuestMode: true };
  }

  const isCrossProvider =
    personality.provider !== undefined &&
    personality.provider !== (AIProvider.OpenRouter as string);
  if (!isCrossProvider) {
    return { config: target.config, apiKey, isGuestMode };
  }

  // Cross-provider (e.g. a z.ai-promoted request carries the user's z.ai
  // key): the OpenRouter retarget needs the user's OWN OpenRouter key.
  const openRouterKey = await deps.apiKeyResolver?.resolveUserOpenRouterKey(userId);
  if (openRouterKey !== undefined) {
    return { config: target.config, apiKey: openRouterKey, isGuestMode };
  }
  return downgradeToFreeDefault({ personality, category, cacheKeyId, deps });
}

/** The degraded-beats-failed downgrade: free default, system key, guest semantics. */
async function downgradeToFreeDefault(options: {
  personality: { model: string };
  category: QuotaFallbackCategory;
  cacheKeyId: string;
  deps: RetargetRouteDeps;
}): Promise<ResolvedRetargetRoute | null> {
  const { personality, category, cacheKeyId, deps } = options;
  if (deps.caches === undefined || deps.configResolver === undefined) {
    return null;
  }
  const guestTarget = await selectQuotaFallbackTarget({
    category,
    isGuestMode: true,
    failingModel: personality.model,
    cacheKeyId,
    configResolver: deps.configResolver,
    caches: deps.caches,
  });
  const systemKey = await deps.apiKeyResolver?.resolveSystemOpenRouterKey();
  if (guestTarget === null || systemKey === undefined) {
    return null;
  }
  return { config: guestTarget.config, apiKey: systemKey, isGuestMode: true };
}
