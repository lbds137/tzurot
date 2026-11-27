/**
 * Post-route LLM auth assembly for AuthStep.
 *
 * Shapes the intermediate `ResolvedLlmAuth` record from a `ProviderRouter`
 * decision (plus any guest-mode override result) and converts the final
 * post-quota `ResolvedLlmAuth` into the pipeline's `ResolvedAuth` (`context.auth`).
 *
 * Extracted from AuthStep to keep that file within the 400-line cap.
 */

import { AIProvider, isFreeModel } from '@tzurot/common-types/constants/ai';
import { ApiErrorCategory, KEY_INVALID_CATEGORY } from '@tzurot/common-types/constants/error';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type AudioProviderId } from '@tzurot/common-types/types/audio-provider';
import { type SttDispatch } from '@tzurot/common-types/types/sttProvider';
import {
  type EffectiveTier,
  type KeyProvenance,
  type KeyState,
  provenanceFromResolution,
  resolveEffectiveTier,
} from '../../../../services/effectiveTier.js';
import type { ResolvedRoute } from '../../../../services/ProviderRouter.js';
import type {
  QuotaFallbackCategory,
  QuotaFallbackInfo,
} from '../../../../services/quotaFallback.js';
import type { GenerationContext, ResolvedAuth } from '../types.js';
import { piggybackFields, type GuestOverrideResult } from './guestModeOverrides.js';

const logger = createLogger('postRouteLlmAuth');

type EffectivePersonality = NonNullable<GenerationContext['config']>['effectivePersonality'];

/** What `resolveLlmAuth` resolves — the shape every downstream hop (quota
 *  retarget, demotion, process()) spreads or reads. */
export interface ResolvedLlmAuth {
  resolvedApiKey: string | undefined;
  resolvedProvider: AIProvider | undefined;
  isGuestMode: boolean;
  keyProvenance: KeyProvenance;
  effectiveTier: EffectiveTier;
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

function announceFields(info: QuotaFallbackInfo | undefined): {
  quotaFallback?: QuotaFallbackInfo;
} {
  return info !== undefined ? { quotaFallback: info } : {};
}

/**
 * The footer announce for a TAKEN demoted arm — both the admitted z.ai
 * piggyback arm and the non-admitted system-OpenRouter arm, since the event
 * (the user's OpenRouter key is rejected/low-credit) is the same whichever
 * system credential serves the ride. The demotion's own event is
 * the key state, not the guest ladder's substitution, so it replaces the
 * ladder's `guest_mode` announce — and it fires even when the ladder changed
 * nothing (the configured model was already free), where the guest announce
 * is absent and the user would otherwise be silently moved onto the system
 * key. `fromModel` is the ladder's pre-substitution model when it announced
 * one; otherwise from === to and the renderer collapses to the bare reason.
 * An unrecognised key state (unreachable: the arm requires invalid or
 * low-credit) keeps the guest announce unchanged.
 */
function demotionAnnounce(
  keyState: KeyState | undefined,
  model: string,
  guest: GuestOverrideResult | undefined
): QuotaFallbackInfo | undefined {
  let category: QuotaFallbackInfo['category'];
  if (keyState === 'invalid') {
    category = KEY_INVALID_CATEGORY;
  } else if (keyState === 'low-credit') {
    category = ApiErrorCategory.CREDIT_EXHAUSTION;
  } else {
    return guest?.quotaFallback;
  }
  return {
    fromModel: guest?.quotaFallback?.fromModel ?? model,
    toModel: model,
    category,
    mode: 'proactive',
  };
}

/**
 * Assemble the post-route `ResolvedLlmAuth` from a `ProviderRouter` decision
 * and optional guest-mode overrides. Carries `route.fallthroughTriggered`
 * across every post-route return arm (including the guest z.ai system-key
 * upgrade arm; the footer renderer gates the suffix on `provider === 'openrouter'`).
 *
 * `keyState` + `demotedSystemKey` drive the demoted non-admitted arm: when
 * the route's own key is known-dead (`keyState` `'low-credit'`/`'invalid'`)
 * AND the z.ai piggyback did not admit (`guest` carries no `zaiSystemKey`),
 * the demoted request runs with full guest semantics on the system OpenRouter
 * key — the credential/bucket/provenance the existing guest free-default path
 * uses (`systemCredentials` shape) — instead of invoking on the dead
 * `route.apiKey`. D10 firewall: `effectivePersonality` on this arm is ALWAYS
 * the guest ladder's output (free default / free floor, or an already-free
 * model) — AuthStep runs `applyGuestModeOverrides` before every demoted call,
 * so a paid model never reaches a system key here. The route's pre-computed
 * auto-promotion passthrough is dropped with the arm: its `fallback.apiKey`
 * is the same dead user key, so carrying it would re-invoke the dead
 * credential in GenerationStep's retry-with-fallback.
 */
export function buildPostRouteLlmAuth(
  route: ResolvedRoute,
  effectivePersonality: EffectivePersonality,
  guest?: GuestOverrideResult,
  keyState?: KeyState,
  demotedSystemKey?: string
): ResolvedLlmAuth {
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
      ...announceFields(demotionAnnounce(keyState, effectivePersonality.model, guest)),
      ...piggybackFields(guest),
    };
  }

  const keyProvenance = provenanceFromResolution(route.source, route.apiKey);

  const demotedArmEligible =
    (keyState === 'low-credit' || keyState === 'invalid') && demotedSystemKey !== undefined;
  // D10: a paid model never runs on the system key, even if a future caller
  // skips the guest overrides. Fall through to the standard arm instead — the
  // dead user key bills the attempt (a visible failure), never the operator bucket.
  const demotedArmSafe = demotedArmEligible && isFreeModel(effectivePersonality.model);
  const demotedSystemKeySafe = demotedArmSafe ? demotedSystemKey : undefined;
  if (demotedArmEligible && !demotedArmSafe) {
    logger.warn(
      { model: effectivePersonality.model, keyState },
      'Demoted arm skipped: personality model is not free (D10 firewall)'
    );
  }

  if (keyState === 'invalid' && demotedSystemKey === undefined) {
    logger.warn(
      { keyState },
      'Demoted arm unavailable: no system key resolved; request stays on the invalid user key'
    );
  }

  if (demotedSystemKeySafe !== undefined) {
    const demotedProvenance: KeyProvenance = 'system';
    return {
      resolvedApiKey: demotedSystemKeySafe,
      resolvedProvider: AIProvider.OpenRouter,
      isGuestMode: true,
      keyProvenance: demotedProvenance,
      effectiveTier: resolveEffectiveTier({ keyProvenance: demotedProvenance }),
      effectivePersonality,
      fallthroughTriggered: route.fallthroughTriggered,
      ...announceFields(demotionAnnounce(keyState, effectivePersonality.model, guest)),
      ...piggybackFields(guest),
    };
  }

  return {
    resolvedApiKey: route.apiKey,
    resolvedProvider: route.effectiveProvider,
    isGuestMode: route.isGuestMode,
    keyProvenance,
    effectiveTier: resolveEffectiveTier({ keyProvenance, keyState }),
    effectivePersonality,
    wasAutoPromoted: route.wasAutoPromoted,
    fallthroughTriggered: route.fallthroughTriggered,
    fallback: route.fallback,
    ...(guest?.quotaFallback !== undefined ? { quotaFallback: guest.quotaFallback } : {}),
    ...piggybackFields(guest),
  };
}

/**
 * Assemble the guest-mode fallback `ResolvedLlmAuth` when API-key resolution
 * fails unexpectedly and degrades to the guest ladder.
 */
export function buildGuestFallbackLlmAuth(guest: GuestOverrideResult): ResolvedLlmAuth {
  const keyProvenance = provenanceFromResolution('system', guest.zaiSystemKey);
  return {
    resolvedApiKey: guest.zaiSystemKey,
    resolvedProvider: guest.zaiSystemKey !== undefined ? AIProvider.ZaiCoding : undefined,
    isGuestMode: true,
    keyProvenance,
    effectiveTier: resolveEffectiveTier({ keyProvenance }),
    effectivePersonality: guest.personality,
    ...(guest.quotaFallback !== undefined ? { quotaFallback: guest.quotaFallback } : {}),
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

  return {
    apiKey: resolvedApiKey,
    provider: resolvedProvider,
    isGuestMode,
    keyProvenance,
    effectiveTier,
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
