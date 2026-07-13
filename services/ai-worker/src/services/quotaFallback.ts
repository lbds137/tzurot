/**
 * Tier-aware quota fallback (profiles Phase 0).
 *
 * When generation fails on a quota-class error — or the resolved model is
 * already known-doomed via the exhaustion/rate caches — retarget ONCE to the
 * tier-aware admin default instead of failing the turn:
 *
 *   QUOTA_EXCEEDED  + BYOK  → global (paid) default on the user's own key
 *                             (model-scoped block; a different model has its
 *                             own headroom on the same account)
 *   QUOTA_EXCEEDED  + guest → free default (already on the system key)
 *   CREDIT_EXHAUSTION + BYOK → free default FORCED onto the system key —
 *                             the account is broke across ALL models, and a
 *                             user has exactly one OpenRouter key, so the only
 *                             different billing entity is the system key.
 *                             Guest-mode semantics (free model, zero owner
 *                             cost); topping up restores instantly via the
 *                             wallet-update cache-clear edge.
 *   CREDIT_EXHAUSTION + guest → terminal (the system key itself is broke —
 *                             no different billing entity exists)
 *
 * Every fire is announced (footer names both models) and audit-logged.
 * Retargeting is ONE hop and swaps the FULL parameter set from the target
 * config — the primary preset's sampling params were tuned for a different
 * model and must not leak onto the fallback.
 */

import { AIProvider, FREE_ROUTER_MODEL, isFreeModel } from '@tzurot/common-types/constants/ai';
import { getSystemSetting } from '@tzurot/common-types/services/SystemSettingsService';
import { ApiErrorCategory } from '@tzurot/common-types/constants/error';
import { LLM_CONFIG_OVERRIDE_KEYS } from '@tzurot/common-types/schemas/llmAdvancedParams';
import { type ResolvedLlmConfig } from '@tzurot/common-types/types/configResolution';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { LlmConfigResolver } from '@tzurot/config-resolver';
import { ApiError, parseApiError } from '../utils/apiErrorParser.js';
import { RetryError } from '../utils/retry.js';
import type { CreditExhaustionCache } from './CreditExhaustionCache.js';
import type { RateLimitCache } from './RateLimitCache.js';

const logger = createLogger('QuotaFallback');

/** The retargetable failure classes. Everything else is not our business. */
export type QuotaFallbackCategory =
  | ApiErrorCategory.QUOTA_EXCEEDED
  | ApiErrorCategory.CREDIT_EXHAUSTION
  | ApiErrorCategory.RATE_LIMIT;

/** Announce/audit carrier — rides result metadata to the footer. */
export interface QuotaFallbackInfo {
  fromModel: string;
  toModel: string;
  category: QuotaFallbackCategory;
  mode: 'proactive' | 'reactive';
}

export interface QuotaFallbackCaches {
  creditExhaustion: CreditExhaustionCache;
  rateLimit: RateLimitCache;
}

/** A selected retarget: the target config, and whether the billing entity changes. */
export interface QuotaFallbackTarget {
  config: ResolvedLlmConfig;
  /**
   * True only on the credit-exhausted-BYOK path: the retry must run on the
   * system key with guest-mode semantics (the user's own account is broke
   * across all models).
   */
  forceSystemKey: boolean;
}

function isQuotaFallbackCategory(category: ApiErrorCategory): category is QuotaFallbackCategory {
  return (
    category === ApiErrorCategory.QUOTA_EXCEEDED ||
    category === ApiErrorCategory.CREDIT_EXHAUSTION ||
    // A live 429 classifies as RATE_LIMIT; retarget the SAME way as
    // QUOTA_EXCEEDED (different default model, same key) so the FAILING turn is
    // rescued in-turn instead of only subsequent turns (proactive cache path).
    category === ApiErrorCategory.RATE_LIMIT
  );
}

/**
 * The `isViable` seam (design D2): is `model` currently attemptable for this
 * account scope? Consults the same doom-caches the failure path writes.
 * Returns the blocking category on a non-viable model so proactive callers
 * can label the retarget correctly. Cache errors degrade to viable — the
 * caches are an optimisation, never a correctness gate.
 */
export async function checkModelViability(options: {
  model: string;
  cacheKeyId: string;
  caches: QuotaFallbackCaches;
}): Promise<{ viable: true } | { viable: false; category: QuotaFallbackCategory }> {
  const { model, cacheKeyId, caches } = options;
  const exhausted = await caches.creditExhaustion.isCreditExhausted({ cacheKeyId });
  if (exhausted.exhausted) {
    return { viable: false, category: ApiErrorCategory.CREDIT_EXHAUSTION };
  }
  const rateLimited = await caches.rateLimit.isRateLimited({ cacheKeyId, model });
  if (rateLimited.rateLimited) {
    return { viable: false, category: ApiErrorCategory.QUOTA_EXCEEDED };
  }
  return { viable: true };
}

/**
 * The GUEST-safe free default. The admin free-default config may point at the
 * z.ai piggyback preset (`z-ai/glm-4.5-air`) — a model that is NOT free on
 * OpenRouter. A guest retarget that ran it on the system OpenRouter key would
 * bill a paid model to the owner, so any non-actually-free config degrades to
 * the runtime free floor (`fallbackTextModelFree`) here — itself guarded by
 * isFreeModel with the static router as the last resort, since the floor
 * setting's write validator enforces free-route-only but an out-of-band bag
 * edit must still not bill the owner. (The z.ai upgrade happens only at
 * AuthStep admission, never on the retarget path.)
 */
async function resolveGuestSafeFreeDefault(
  configResolver: LlmConfigResolver
): Promise<ResolvedLlmConfig | null> {
  const config = await configResolver.getFreeDefaultConfig();
  if (config === null || isFreeModel(config.model)) {
    return config;
  }
  logger.debug(
    { configuredModel: config.model },
    'Guest retarget: free-default model is not OpenRouter-free — using the free router'
  );
  const floor = getSystemSetting('fallbackTextModelFree');
  return {
    model: isFreeModel(floor) ? floor : FREE_ROUTER_MODEL,
    provider: AIProvider.OpenRouter,
  };
}

/**
 * Pick the tier-aware retarget for a quota-class failure, or null when the
 * turn should fail exactly as it does today (no target, same model, target
 * also doomed, or no different billing entity exists).
 */
export async function selectQuotaFallbackTarget(options: {
  category: QuotaFallbackCategory;
  isGuestMode: boolean;
  failingModel: string;
  cacheKeyId: string;
  configResolver: LlmConfigResolver;
  caches: QuotaFallbackCaches;
}): Promise<QuotaFallbackTarget | null> {
  const { category, isGuestMode, failingModel, cacheKeyId, configResolver, caches } = options;

  let config: ResolvedLlmConfig | null;
  let forceSystemKey = false;

  if (category === ApiErrorCategory.CREDIT_EXHAUSTION) {
    if (isGuestMode) {
      // The system key itself is broke — no different billing entity exists.
      return null;
    }
    config = await resolveGuestSafeFreeDefault(configResolver);
    forceSystemKey = true;
  } else {
    config = isGuestMode
      ? await resolveGuestSafeFreeDefault(configResolver)
      : await configResolver.getGlobalDefaultConfig();
  }

  if (config === null || config.model === failingModel) {
    return null;
  }

  // Target viability: skip the credit-exhaustion check when the billing
  // entity changes — the exhaustion mark belongs to the user's account, but
  // the forced-system-key retry bills a different one (the cache bucket is
  // per-user either way, so the mark would otherwise always veto this path).
  if (forceSystemKey) {
    const rateLimited = await caches.rateLimit.isRateLimited({ cacheKeyId, model: config.model });
    if (rateLimited.rateLimited) {
      return null;
    }
  } else {
    const viability = await checkModelViability({ model: config.model, cacheKeyId, caches });
    if (!viability.viable) {
      return null;
    }
  }

  return { config, forceSystemKey };
}

/**
 * Rewrite a personality to run the target config COHERENTLY: the target's
 * model, its provider, and its FULL parameter set. A key the target config
 * leaves unset is explicitly cleared (provider-default semantics for the new
 * model), never inherited from the primary preset — those params were tuned
 * for a different model.
 *
 * The provider rewrite is load-bearing: a personality auto-promoted to
 * z.ai-direct carries provider='zai-coding', and a model string is only
 * meaningful relative to its provider's catalog — leaving the stale provider
 * would send the admin default's OpenRouter model to z.ai's endpoint. Admin
 * default configs are OpenRouter-routed, so OpenRouter is the safe fallback
 * when the config predates the provider field.
 */
export function applyConfigToPersonality(
  personality: LoadedPersonality,
  config: ResolvedLlmConfig
): LoadedPersonality {
  const result = {
    ...personality,
    model: config.model,
    provider: config.provider ?? AIProvider.OpenRouter,
  };
  for (const key of LLM_CONFIG_OVERRIDE_KEYS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- dynamic key sweep over LLM_CONFIG_OVERRIDE_KEYS requires runtime indexing
    (result as any)[key] = config[key] ?? undefined;
  }
  return result;
}

/** One structured audit line per fire — "why did I get this model" answerable from logs. */
export function logQuotaFallbackAudit(
  info: QuotaFallbackInfo,
  context: { jobId: string | undefined; requestId?: string; cacheKeyId: string }
): void {
  logger.info(
    {
      jobId: context.jobId,
      requestId: context.requestId,
      fromModel: info.fromModel,
      toModel: info.toModel,
      category: info.category,
      mode: info.mode,
      cacheKeyId: context.cacheKeyId,
    },
    'Quota fallback retarget fired'
  );
}

/**
 * Extract the quota-class category from a caught generation error, unwrapping
 * the retry machinery's wrapper first (classification must run on the
 * provider's actual error, not the generic RetryError message). An `ApiError`
 * instance's own `.info.category` is authoritative — the constructor encoded
 * a deliberate classification (e.g. the cache short-circuits' synthetic
 * errors), and re-parsing its message could flip it.
 */
export function classifyQuotaFailure(error: unknown): QuotaFallbackCategory | null {
  const unwrapped = error instanceof RetryError ? error.lastError : error;
  const category =
    unwrapped instanceof ApiError ? unwrapped.info.category : parseApiError(unwrapped).category;
  return isQuotaFallbackCategory(category) ? category : null;
}
