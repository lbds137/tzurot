/**
 * Post-route LLM auth assembly for AuthStep.
 *
 * Shapes the intermediate `ResolvedLlmAuth` record from a `ProviderRouter`
 * decision (plus any guest-mode override result) and converts the final
 * post-quota `ResolvedLlmAuth` into the pipeline's `ResolvedAuth` (`context.auth`).
 *
 * Extracted from AuthStep to keep that file within the 400-line cap.
 */

import { AIProvider } from '@tzurot/common-types/constants/ai';
import { type AudioProviderId } from '@tzurot/common-types/types/audio-provider';
import { type SttDispatch } from '@tzurot/common-types/types/sttProvider';
import {
  type EffectiveTier,
  type KeyProvenance,
  resolveEffectiveTier,
} from '../../../../services/effectiveTier.js';
import type { ResolvedRoute } from '../../../../services/ProviderRouter.js';
import type {
  QuotaFallbackCategory,
  QuotaFallbackInfo,
} from '../../../../services/quotaFallback.js';
import type { GenerationContext, ResolvedAuth } from '../types.js';
import { piggybackFields, type GuestOverrideResult } from './guestModeOverrides.js';

type EffectivePersonality = NonNullable<GenerationContext['config']>['effectivePersonality'];

/**
 * Translate a `ProviderRouter` / `ApiKeyResolver` credential pair into `KeyProvenance`.
 *
 * - Missing or empty key → `'none'`
 * - Guest/system-fallback route (`isGuestMode === true`) → `'system'`
 * - Non-guest route with a resolved key → `'user'`
 */
export function provenanceFromResolution(
  isGuestMode: boolean,
  resolvedApiKey: string | undefined,
  _userId?: string
): KeyProvenance {
  if (resolvedApiKey === undefined || resolvedApiKey.length === 0) {
    return 'none';
  }
  return isGuestMode ? 'system' : 'user';
}

/**
 * Extract the effective key string used for provenance classification on a
 * `ResolvedRoute`, falling back to a non-guest auto-promotion passthrough key
 * when a test fixture mocks `resolveApiKey` without `tryResolveUserKey`.
 */
export function routeKeyForProvenance(route: ResolvedRoute): string | undefined {
  if (route.apiKey !== undefined) {
    return route.apiKey;
  }
  if (
    route.wasAutoPromoted === true &&
    route.fallback !== undefined &&
    !route.fallback.isGuestMode
  ) {
    return route.fallback.apiKey;
  }
  return undefined;
}

/** What `resolveLlmAuth` resolves — the shape every downstream hop (quota
 *  retarget, demotion, process()) spreads or reads. */
export interface ResolvedLlmAuth {
  resolvedApiKey: string | undefined;
  resolvedProvider: AIProvider | undefined;
  isGuestMode: boolean;
  keyProvenance?: KeyProvenance;
  effectiveTier?: EffectiveTier;
  effectivePersonality: EffectivePersonality;
  wasAutoPromoted?: boolean;
  fallthroughTriggered?: boolean;
  fallback?: ResolvedAuth['fallback'];
  /** Set when guest mode or proactive quota check substituted the configured model (footer announce). */
  quotaFallback?: QuotaFallbackInfo;
  /** Set when the guest-mode z.ai piggyback admission denied (footer note). */
  piggybackSkipped?: boolean;
  piggybackModel?: string;
  /**
   * Set ONLY by the demotion tier. A demotion keeps the user's model and
   * merely changes pool, so the reactive quota retarget is still owed if
   * the passthrough fails — but after a demotion the original quota error
   * never surfaces to be classified. This carries the category that was
   * classified up here. Absent on the retarget path, which already spent
   * that tier.
   */
  inheritedQuotaCategory?: QuotaFallbackCategory;
}

/**
 * Assemble the post-route `ResolvedLlmAuth` from a `ProviderRouter` decision
 * and optional guest-mode overrides. Carries `route.fallthroughTriggered`
 * across every post-route return arm (including the guest z.ai system-key
 * upgrade arm; the footer renderer gates the suffix on `provider === 'openrouter'`).
 */
export function buildPostRouteLlmAuth(
  route: ResolvedRoute,
  effectivePersonality: EffectivePersonality,
  guest?: GuestOverrideResult
): ResolvedLlmAuth & { keyProvenance: KeyProvenance; effectiveTier: EffectiveTier } {
  if (guest?.zaiSystemKey !== undefined) {
    const keyProvenance: KeyProvenance = 'system';
    return {
      resolvedApiKey: guest.zaiSystemKey,
      resolvedProvider: AIProvider.ZaiCoding,
      isGuestMode: true,
      keyProvenance,
      effectiveTier: resolveEffectiveTier({ keyProvenance }),
      effectivePersonality,
      wasAutoPromoted: route.wasAutoPromoted,
      fallthroughTriggered: route.fallthroughTriggered,
      fallback: route.fallback,
      ...(guest.quotaFallback !== undefined ? { quotaFallback: guest.quotaFallback } : {}),
      ...piggybackFields(guest),
    };
  }

  const keyProvenance = provenanceFromResolution(route.isGuestMode, routeKeyForProvenance(route));
  return {
    resolvedApiKey: route.apiKey,
    resolvedProvider: route.effectiveProvider,
    isGuestMode: route.isGuestMode,
    keyProvenance,
    effectiveTier: resolveEffectiveTier({ keyProvenance }),
    effectivePersonality,
    wasAutoPromoted: route.wasAutoPromoted,
    fallthroughTriggered: route.fallthroughTriggered,
    fallback: route.fallback,
    ...(guest?.quotaFallback !== undefined ? { quotaFallback: guest.quotaFallback } : {}),
    ...piggybackFields(guest),
  };
}

/**
 * Convert the final `ResolvedLlmAuth` (after any proactive quota check) plus
 * resolved audio/STT credentials into `GenerationContext['auth']`.
 */
export function toResolvedAuth(
  llmAuth: ResolvedLlmAuth,
  audioProviderKeys: ReadonlyMap<AudioProviderId, string>,
  sttDispatch: SttDispatch | undefined
): ResolvedAuth {
  const {
    resolvedApiKey,
    resolvedProvider,
    isGuestMode,
    keyProvenance,
    effectiveTier,
    wasAutoPromoted,
    fallthroughTriggered,
    fallback,
    quotaFallback,
    piggybackSkipped,
    piggybackModel,
    inheritedQuotaCategory,
  } = llmAuth;
  const resolvedProvenance = keyProvenance ?? provenanceFromResolution(isGuestMode, resolvedApiKey);
  const resolvedTier = effectiveTier ?? resolveEffectiveTier({ keyProvenance: resolvedProvenance });

  return {
    apiKey: resolvedApiKey,
    provider: resolvedProvider,
    isGuestMode,
    keyProvenance: resolvedProvenance,
    effectiveTier: resolvedTier,
    audioProviderKeys,
    sttDispatch,
    // wasAutoPromoted usually arrives with a fallback, but
    // ProviderRouter.tryAutoPromoteToZai promotes without one when the
    // OpenRouter catalog confirms the model absent or the OpenRouter key
    // cannot be resolved. GenerationStep reads the swap route
    // as `wasAutoPromoted ? fallback : undefined`, so that case simply has no
    // retry-with-fallback. Each is spread separately because both are optional.
    ...(wasAutoPromoted === true ? { wasAutoPromoted: true } : {}),
    ...(fallthroughTriggered === true ? { fallthroughTriggered: true } : {}),
    ...(fallback !== undefined ? { fallback } : {}),
    ...(quotaFallback !== undefined ? { quotaFallback } : {}),
    ...(piggybackSkipped !== undefined ? { piggybackSkipped, piggybackModel } : {}),
    // Carries the demotion's OWN classification forward so the reactive
    // retarget stays reachable once the demotion has already consumed the
    // quota error. Dropping it here is invisible to the compiler — the
    // field is optional on ResolvedAuth — and silently re-creates the
    // dead-end this thread exists to close, so the seam is asserted in
    // AuthStep.test.ts rather than only at the two endpoints.
    ...(inheritedQuotaCategory !== undefined ? { inheritedQuotaCategory } : {}),
  };
}
