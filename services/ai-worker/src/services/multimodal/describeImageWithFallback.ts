/**
 * Vision fallback loop.
 *
 * Wraps the single-model `describeImage` with a runtime retry-down-the-chain: when the
 * chosen vision model FAILS on a RETRYABLE category, try the next fallback tier (the
 * gateway-stamped `visionFallbackModels`, then the hardcoded floor) before surfacing a
 * terminal placeholder. Terminate immediately on an IMAGE-intrinsic failure (content
 * filtered / censored / unreadable) — another model won't help.
 *
 * All DB resolution stays gateway-side (the tiers are stamped on the personality); this
 * loop only picks the next model + resolves its per-tier auth via `resolveVisionAuth`.
 * It NEVER throws `VisionModelError` — the loop is the boundary that turns a failure into
 * the prompt-facing `[Image … couldn't be processed …]` placeholder.
 */

import { ApiErrorCategory } from '@tzurot/common-types/constants/error';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getSystemSetting } from '@tzurot/common-types/services/SystemSettingsService';
import { getFreeVisionFloor } from '../freeFloors.js';
import {
  describeImage,
  selectVisionModel,
  buildFailureFallback,
  VisionModelError,
  VISION_TERMINATE_CATEGORIES,
  type DescribeImageOptions,
} from './VisionProcessor.js';
import {
  resolveVisionAuth,
  createVisionQuotaTracker,
  visionAuthFailFastDescription,
  type ResolveVisionConfigOptions,
  type VisionConfig,
} from './visionAuthResolver.js';

const logger = createLogger('VisionFallbackLoop');

/** Hard cap on vision attempts per attachment — each tier is a ~1-3s + $ API call. */
const MAX_VISION_FALLBACK_TIERS = 3;

/**
 * Outcome of a single resolved tier:
 * - `resolved` — return this string (a real description, OR a terminate-category placeholder
 *   the image itself earned — no other tier would do better).
 * - `advance` — this tier failed on a retryable category; try the next one.
 */
type TierOutcome =
  { kind: 'resolved'; description: string } | { kind: 'advance'; category: ApiErrorCategory };

/** Run one already-resolved tier: describe, or classify its failure into terminate-vs-advance. */
async function runVisionTier(
  config: VisionConfig,
  attachment: AttachmentMetadata,
  personality: LoadedPersonality,
  describeOptions: DescribeImageOptions
): Promise<TierOutcome> {
  try {
    const description = await describeImage(
      attachment,
      personality,
      config.isGuestMode,
      config.apiKey,
      {
        ...describeOptions,
        model: config.model,
        provider: config.provider,
        // Retry-loop semantics: honor only ATTACHMENT-BOUND cached failures (a model
        // genuinely dead for this image); let transient cached failures re-attempt.
        skipNegativeCache: true,
        // The loop IS the boundary: make describeImage throw the typed error on BOTH a fresh
        // failure AND a negative-cache hit, so a cached placeholder isn't mistaken for success.
        throwOnFailure: true,
      }
    );
    return { kind: 'resolved', description };
  } catch (error) {
    if (!(error instanceof VisionModelError)) {
      // Non-vision throw raised OUTSIDE invokeVisionModel's try — e.g. createChatModel's
      // synchronous missing-key throw, or a malformed-URL TypeError. The loop is the
      // graceful-degradation boundary (callers rely on "never throws" for per-image
      // isolation), so advance to the next tier rather than propagate and fail the batch.
      logger.error(
        { err: error, model: config.model, attachmentId: attachment.id },
        'Vision tier threw a non-VisionModelError — advancing to the next fallback model'
      );
      return { kind: 'advance', category: ApiErrorCategory.UNKNOWN };
    }
    if (VISION_TERMINATE_CATEGORIES.has(error.category)) {
      logger.info(
        { attachmentId: attachment.id, model: config.model, category: error.category },
        'Vision terminate category — image itself rejected, not retrying other tiers'
      );
      return {
        kind: 'resolved',
        description: buildFailureFallback(error.category, config.source, attachment.name),
      };
    }
    logger.info(
      { attachmentId: attachment.id, model: config.model, category: error.category },
      'Vision tier failed on a retryable category — advancing to the next fallback model'
    );
    return { kind: 'advance', category: error.category };
  }
}

/**
 * Compose the ordered, deduped tier list for one attachment: the resolved primary model
 * (the gateway-stamped `visionModel` or `selectVisionModel`, which already folds in the
 * native-main-model + hardcoded picks) → the stamped DB fallbacks (`visionFallbackModels`)
 * → the hardcoded floor. Capped at `MAX_VISION_FALLBACK_TIERS` so the worst case is a
 * bounded number of API calls.
 *
 * NOTE the cap can trim the TAIL: with a primary + 2 stamped fallbacks (the max — the global
 * + free vision defaults), the hardcoded floor is the 4th item and gets sliced off. That's
 * acceptable because the stamped FREE vision default already fills the free-tier last-resort
 * role when present; the hardcoded floor only needs to survive when there's ≤1 stamped
 * fallback (then it stays within the top 3). See the `caps the tier list at 3` test.
 */
export function composeVisionTiers(
  primaryModel: string,
  personality: LoadedPersonality,
  isGuestMode: boolean
): string[] {
  // The floor is the paid model unless we KNOW this is a guest. Some callers (e.g.
  // ImageDescriptionJob) pass isGuestMode=false even for a genuine guest — that's safe: the
  // paid floor is only a MODEL NAME here; when the loop actually reaches it, resolveVisionAuth
  // downgrades a keyless user onto the free model on the system key anyway (broad-free-fallback).
  // So a "wrong" isGuestMode picks a floor model name that auth-time resolution converges to free.
  const floor = isGuestMode ? getFreeVisionFloor() : getSystemSetting('fallbackVisionModel');
  const ordered = [primaryModel, ...(personality.visionFallbackModels ?? []), floor];
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const model of ordered) {
    if (model.length > 0 && !seen.has(model)) {
      seen.add(model);
      deduped.push(model);
    }
  }
  return deduped.slice(0, MAX_VISION_FALLBACK_TIERS);
}

/**
 * Describe an image, retrying down the vision fallback chain on a retryable failure.
 * Returns a description string on success, or a `[Image … couldn't be processed …]`
 * placeholder when a tier hits a terminate category or the whole chain is exhausted. **NEVER throws** — it is
 * the graceful-degradation boundary its callers rely on for per-image isolation, so any
 * unexpected error degrades to a generic placeholder rather than failing the whole batch.
 */
export async function describeImageWithFallback(
  attachment: AttachmentMetadata,
  personality: LoadedPersonality,
  authOptions: ResolveVisionConfigOptions,
  describeOptions: DescribeImageOptions = {}
): Promise<string> {
  try {
    return await walkFallbackChain(attachment, personality, authOptions, describeOptions);
  } catch (error) {
    // Belt-and-suspenders for the "never throws" contract: anything the per-tier loop
    // doesn't catch (e.g. selectVisionModel's Redis call throwing) degrades to a generic
    // placeholder instead of propagating and failing the whole batch of attachments.
    logger.error(
      { err: error, attachmentId: attachment.id },
      'Vision fallback loop threw unexpectedly — rendering generic fallback'
    );
    return buildFailureFallback(ApiErrorCategory.UNKNOWN, undefined, attachment.name);
  }
}

async function walkFallbackChain(
  attachment: AttachmentMetadata,
  personality: LoadedPersonality,
  authOptions: ResolveVisionConfigOptions,
  describeOptions: DescribeImageOptions
): Promise<string> {
  const isGuestMode = authOptions.isGuestMode;
  const primaryModel =
    describeOptions.model !== undefined && describeOptions.model.length > 0
      ? describeOptions.model
      : await selectVisionModel(personality, isGuestMode);

  const tiers = composeVisionTiers(primaryModel, personality, isGuestMode);
  const quota = createVisionQuotaTracker(authOptions.userId);
  // Dedup by the RESOLVED model: the broad-free-fallback can collapse several distinct
  // tiers onto the same free model, and re-invoking the same (model, attachment) is what
  // the negative cache already guards — skip it here to save the redundant call.
  const attempted = new Set<string>();
  // Track the last tier that was actually ATTEMPTED (a key resolved + describeImage ran) —
  // its category AND key source. A failFast (no key for the tier) is NOT an attempt, so it
  // never contributes here; that keeps a downstream failFast from clobbering a real failure.
  let lastAttempt: { category: ApiErrorCategory; source: 'user' | 'system' } | undefined;

  for (const [tierIndex, tierModel] of tiers.entries()) {
    // Only the FIRST tier may take the same-provider fast path (reuse the upstream
    // main key) — a fallback tier re-handing back the identical key would retry the
    // exact credential that just failed and defeat the loop's resilience purpose.
    const auth = await resolveVisionAuth(tierModel, authOptions, quota, tierIndex === 0);
    if (auth.kind === 'failFast') {
      continue; // no usable key for this tier's provider (and no free fallback) — advance
    }
    if (attempted.has(auth.config.model)) {
      continue;
    }
    attempted.add(auth.config.model);

    const outcome = await runVisionTier(auth.config, attachment, personality, describeOptions);
    if (outcome.kind === 'resolved') {
      return outcome.description;
    }
    lastAttempt = { category: outcome.category, source: auth.config.source };
  }

  logger.warn(
    { attachmentId: attachment.id, tiers, lastAttempt },
    'Vision fallback chain exhausted — all tiers failed'
  );
  // No tier ever resolved a key → genuine "no usable key anywhere" (incl. the system free
  // tier): the fixed "configure your key" guidance is right. Otherwise render the LAST
  // attempted failure honoring its key source — so a 401 on the SYSTEM key doesn't tell the
  // user to fix a key they don't own (buildFailureFallback maps system-source AUTH to a
  // non-blaming "temporarily unavailable" message).
  if (lastAttempt === undefined) {
    return visionAuthFailFastDescription(attachment.name);
  }
  return buildFailureFallback(lastAttempt.category, lastAttempt.source, attachment.name);
}
