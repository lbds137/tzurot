/**
 * Vision Config Resolver
 *
 * Resolves the API key + provider + model for a vision call **independently**
 * from the main-model auth resolution. The personality's vision model may live
 * on a different provider than its main model (e.g., main=`glm-5.1` on
 * z.ai-coding, vision=`qwen/qwen3.5-...` on OpenRouter); using the main-model
 * key for the vision call results in a 401 from the vision provider's API.
 *
 * `resolveVisionConfig` returns a discriminated union:
 * - `{ kind: 'resolved', config }` — caller proceeds with the vision call,
 *   passing `config.model` through so the chosen model (which may be a forced
 *   free-tier downgrade) is honored rather than re-selected.
 * - `{ kind: 'failFast', provider }` — caller MUST short-circuit. Only happens
 *   when even the free-model system fallback is unavailable (no system
 *   OpenRouter key configured).
 *
 * Policy: an authenticated user lacking a key for the vision provider does NOT
 * fail-fast; they downgrade to the free vision model
 * (`MODEL_DEFAULTS.VISION_FALLBACK_FREE`) on the system OpenRouter key. This is
 * the BROAD free-fallback behavior — it applies to ALL authenticated users who
 * can't auth the vision provider, not a specific provider's users.
 *
 * Use `buildVisionAuthFailureResults` to construct the synthetic-failure
 * `ProcessedAttachment[]` when the resolver returns `failFast`. That helper
 * writes to the negative cache so subsequent retries within the 5-min window
 * hit cache instead of re-resolving and re-failing.
 */

import {
  createLogger,
  AIProvider,
  AttachmentType,
  ApiErrorCategory,
  MODEL_DEFAULTS,
  type AttachmentMetadata,
  type LoadedPersonality,
} from '@tzurot/common-types';
import { detectVisionProvider } from '../ProviderRouter.js';
import { selectVisionModel } from './VisionProcessor.js';
import { visionDescriptionCache } from '../../redis.js';
import type { ApiKeyResolver } from '../ApiKeyResolver.js';
import type { ProcessedAttachment } from '../MultimodalProcessor.js';

const logger = createLogger('VisionAuthResolver');

/**
 * Source-aware fallback description shown to the LLM when an authenticated
 * user lacks a key for the vision provider. Exported as a constant rather
 * than inlined at call sites so the two paths that produce this UX —
 * `buildVisionAuthFailureResults` (channel-history images via DependencyStep)
 * and `ImageDescriptionJob.buildFailFastResult` (upload-time images) — stay
 * synchronized. A string update in one place would otherwise diverge silently.
 *
 * The wording is read by the LLM in the chat context, so it's phrased as a
 * description (not a UI error). The user sees the personality acknowledge
 * the missing image with the embedded "/settings apikey set" hint.
 */
export const VISION_AUTH_FAIL_FAST_DESCRIPTION =
  '[Image unavailable: your API key was rejected — check /settings apikey set for the vision provider key]';

/**
 * Resolved auth + model context for a vision call. Unifies the auth decision
 * (which key, which provider) with the model decision (which vision model) so a
 * downgraded authenticated user gets the system key AND the free model together —
 * resolving them in separate functions risks handing the system key to a paid
 * model (`selectVisionModel` returns the PAID fallback for `isGuestMode === false`).
 */
export interface VisionConfig {
  apiKey: string;
  provider: AIProvider;
  /** Final resolved vision model — what `describeImage` should actually invoke. */
  model: string;
  source: 'user' | 'system';
  /**
   * PRESERVED meaning: "no keys anywhere" (genuine guest). A downgraded
   * authenticated user (no vision-provider key, falling back to the free model
   * on the system key) is NOT a guest — `isGuestMode` stays `false` for them.
   * Downstream consumers that branch on `isGuestMode` must not conflate it with
   * "using the system key."
   */
  isGuestMode: boolean;
}

/**
 * Result of `resolveVisionConfig`.
 * - `resolved` — caller proceeds with the vision call using `config`
 * - `failFast` — even the free-model system fallback is unavailable (no system
 *   OpenRouter key configured); caller short-circuits with the
 *   `buildVisionAuthFailureResults` synthetic-failure batch. `provider` is the
 *   ORIGINAL vision provider the user actually lacked, so telemetry/placeholders
 *   reflect what they were missing rather than the free-fallback provider.
 */
export type VisionConfigResult =
  | { kind: 'resolved'; config: VisionConfig }
  | { kind: 'failFast'; provider: AIProvider };

/**
 * Inputs for `resolveVisionConfig` — bundled into an options object to keep the
 * call site readable when threaded through pipeline steps.
 */
export interface ResolveVisionConfigOptions {
  /** Personality whose vision model determines the target provider + model. */
  personality: LoadedPersonality;
  /**
   * Provider that the main-model resolution landed on (typically `auth.provider`
   * from the upstream `AuthStep`). Drives the "is this same-provider, can we
   * reuse the main key?" decision. `undefined` for callers with no upstream
   * main-model context (e.g., `ImageDescriptionJob`), in which case the
   * same-provider fast path is skipped and per-provider resolution always runs.
   */
  mainProvider?: AIProvider;
  /**
   * API key the upstream resolution returned for the main model. Optional
   * because `AuthStep`'s resolution-failure recovery branch returns
   * `resolvedApiKey: undefined` (degraded guest mode); when missing or empty,
   * the same-provider fast path is skipped and per-provider resolution always
   * runs, ensuring we don't hand `createChatModel` an empty Authorization
   * header.
   */
  mainApiKey?: string;
  /** Whether the upstream resolution landed on a system fallback (genuine guest mode). */
  isGuestMode: boolean;
  /** Discord user ID, if known. Required for any user-key lookup. */
  userId: string | undefined;
  /** Resolver instance for cross-provider lookups. */
  apiKeyResolver: ApiKeyResolver;
}

/**
 * Resolve the API key + provider + model for a vision call atomically.
 *
 * Branch order:
 * 1. Compute the natural vision model + provider via `selectVisionModel`.
 * 2. Same-provider fast path — reuse the upstream main-model key.
 * 3. Genuine guest (or unknown user) — system key for the vision provider.
 * 4. Authenticated user with a vision-provider key — use it.
 * 5. BROAD FREE FALLBACK — authenticated user lacking a vision-provider key
 *    downgrades to the free vision model on the system OpenRouter key (instead
 *    of fail-fasting). Forces BOTH the free model AND its provider's system key
 *    so the system key never gets billed for a paid model.
 * 6. Fallback-of-fallback — if even the free-model system key is unavailable
 *    (no system OpenRouter key configured), `failFast` so the caller emits the
 *    "configure your key" placeholder against the ORIGINAL vision provider.
 */
export async function resolveVisionConfig(
  options: ResolveVisionConfigOptions
): Promise<VisionConfigResult> {
  const { personality, mainProvider, mainApiKey, isGuestMode, userId, apiKeyResolver } = options;

  // Compute the natural model with the same selection logic `describeImage`
  // uses internally, so provider detection sees the actual model rather than
  // the main model (e.g. main=glm-5.1 with no native vision falls through to
  // the OpenRouter fallback model — its provider is OpenRouter, not z.ai).
  const naturalModel = await selectVisionModel(personality, isGuestMode);
  const visionProvider = detectVisionProvider(naturalModel);

  // Same-provider fast path — reuse the upstream-resolved key without a second
  // resolver call. Avoids redundant DB reads for the common case where main and
  // vision share a provider.
  //
  // Gated on a non-empty `mainApiKey` because AuthStep's resolution-failure
  // catch branch returns `resolvedApiKey: undefined` regardless of whether the
  // failing user was authenticated or guest (the rare error path where
  // ProviderRouter.resolveRoute throws). Reusing an empty key would silently
  // reach `createChatModel` with no Authorization header and reproduce the exact
  // bug this resolver exists to prevent. Falling through to per-provider
  // resolution lets the user's actual keys (if any) be picked up instead.
  if (visionProvider === mainProvider && mainApiKey !== undefined && mainApiKey.length > 0) {
    logger.debug(
      { userId, visionProvider, isGuestMode },
      'Vision config same-provider fast path — reusing main-model key'
    );
    return {
      kind: 'resolved',
      config: {
        apiKey: mainApiKey,
        provider: visionProvider,
        model: naturalModel,
        source: isGuestMode ? 'system' : 'user',
        isGuestMode,
      },
    };
  }

  // Defensive guard: an authenticated context (`isGuestMode === false`) that
  // nonetheless has no userId is contradictory — `tryResolveUserKey` requires a
  // userId to look up wallet entries. In practice the upstream pipeline only
  // sets `isGuestMode: false` after a successful user-key resolution (which
  // requires userId), so this branch isn't reachable from production code.
  // Logging at warn level + degrading to the guest path surfaces a regression
  // if any future caller violates the invariant without crashing the request.
  if (!isGuestMode && userId === undefined) {
    logger.warn(
      { mainProvider, visionProvider },
      'Vision config: !isGuestMode but userId undefined — degrading to guest path'
    );
  }
  const treatAsGuest = isGuestMode || userId === undefined;

  // Wrap the resolver calls so a transient throw (e.g. Redis blip inside the
  // resolver) degrades to a fail-fast placeholder rather than propagating out of
  // the caller's vision pipeline. Mirrors the try/catch the upload-time path
  // historically had in `resolveVisionApiKey`. (Model selection runs before this
  // block intentionally — `selectVisionModel`'s Redis reads already degrade to a
  // pattern-matching fallback, so a genuine throw there is a real error worth
  // surfacing, not masking as a placeholder.)
  try {
    if (treatAsGuest) {
      // Genuine guest — system key is the only path that works for them.
      // `selectVisionModel` already returned the free model for guests, so
      // `naturalModel` is correct here.
      const result = await apiKeyResolver.resolveApiKey(userId, visionProvider);
      logger.info(
        { userId, visionProvider, mainProvider, source: result.source },
        'Cross-provider vision config resolved (guest path)'
      );
      return {
        kind: 'resolved',
        config: {
          apiKey: result.apiKey,
          provider: visionProvider,
          model: naturalModel,
          source: result.source,
          isGuestMode: result.isGuestMode,
        },
      };
    }

    // Authenticated user — try their key for the vision provider first.
    const userKey = await apiKeyResolver.tryResolveUserKey(userId, visionProvider);
    if (userKey !== null) {
      logger.info(
        { userId, visionProvider, mainProvider, source: 'user' },
        'Cross-provider vision config resolved (authenticated user key)'
      );
      return {
        kind: 'resolved',
        config: {
          apiKey: userKey,
          provider: visionProvider,
          model: naturalModel,
          source: 'user',
          isGuestMode: false,
        },
      };
    }

    // BROAD FREE FALLBACK — authenticated user with no key for the vision
    // provider. Instead of fail-fasting, downgrade to the free vision model on
    // the system key. MUST force BOTH the free model AND its provider's key:
    // `selectVisionModel` returns the PAID fallback for authenticated users
    // (isGuestMode=false), so handing the system key to `naturalModel` would
    // bill the system key for a paid model.
    const freeModel = MODEL_DEFAULTS.VISION_FALLBACK_FREE;
    const freeProvider = detectVisionProvider(freeModel);
    const sys = await apiKeyResolver.resolveApiKey(userId, freeProvider);
    // `apiKey` is typed `string`, but guard against a null/empty result too —
    // resolveApiKey normally throws when no key is available, so reaching here
    // with no usable key is a defense-in-depth case. `sys.apiKey ?? ''` keeps
    // the length check from throwing on a null returned by a misbehaving resolver.
    if ((sys.apiKey ?? '').length === 0) {
      // Fail-fast against the ORIGINAL vision provider so the placeholder
      // reflects what they lacked.
      logger.info(
        { userId, visionProvider, freeProvider },
        'Vision free-fallback unavailable (no system key) — failing fast'
      );
      return { kind: 'failFast', provider: visionProvider };
    }
    logger.info(
      { userId, visionProvider, freeProvider, freeModel, source: sys.source },
      'Authenticated user lacks vision-provider key — downgrading to free vision model on system key'
    );
    return {
      kind: 'resolved',
      config: {
        apiKey: sys.apiKey,
        provider: freeProvider,
        model: freeModel,
        // `source` is whatever resolveApiKey returned — normally 'system'; if
        // the user happens to have an OpenRouter key it'd be 'user', which is
        // fine (they ARE authenticated, just downgraded for the vision model).
        source: sys.source,
        // NOT a guest — they're authenticated, only the vision model is downgraded.
        isGuestMode: false,
      },
    };
  } catch (error) {
    // Fallback-of-fallback unavailable path: `resolveApiKey` throws when no key
    // (user or system) is available for the requested provider. For the
    // authenticated free-fallback branch that means no system OpenRouter key is
    // configured → fail-fast against the original vision provider. For the guest
    // branch a throw is genuinely unrecoverable too, so fail-fast is consistent.
    logger.warn(
      { err: error, userId, visionProvider },
      'Vision config resolution failed — failing fast (no usable key for vision or free-fallback provider)'
    );
    return { kind: 'failFast', provider: visionProvider };
  }
}

/**
 * Build synthetic AUTHENTICATION-failure ProcessedAttachment entries for a
 * batch of image attachments when `resolveVisionConfig` returns `failFast`
 * (no usable key for the vision provider AND no system free-fallback key).
 * Writes each entry to the negative cache so subsequent retries within the
 * 5-min window hit cache instead of re-resolving — same UX as a real auth
 * rejection by the upstream API.
 *
 * The cache write is **best-effort**: the placeholder results are built and
 * returned regardless of whether the cache write succeeds. A Redis blip at the
 * moment we emit the fail-fast must NOT drop the user-facing placeholders (the
 * caller's outer catch would otherwise turn the throw into an empty result —
 * silently dropping the images instead of showing "[Image unavailable…]").
 */
export async function buildVisionAuthFailureResults(
  attachments: AttachmentMetadata[]
): Promise<ProcessedAttachment[]> {
  // Build the user-facing placeholders first so they're returned no matter what
  // happens to the cache. The fail-fast path is reachable by an authenticated
  // user lacking both the vision-provider key and the system free-fallback key,
  // OR by a transient resolver throw — so this is not exclusively authenticated.
  const results: ProcessedAttachment[] = attachments.map(attachment => ({
    type: AttachmentType.Image,
    description: VISION_AUTH_FAIL_FAST_DESCRIPTION,
    originalUrl: attachment.url,
    metadata: attachment,
  }));

  // Negative-cache writes are best-effort. Synthetic failures use the
  // AUTHENTICATION category so the source-aware fallback string fires on cache
  // hits. Writes parallelize (independent keys); a failure here is logged and
  // swallowed so it can't drop the placeholders above.
  try {
    await Promise.all(
      attachments.map(attachment =>
        visionDescriptionCache.storeFailure({
          attachmentId: attachment.id,
          url: attachment.url,
          category: ApiErrorCategory.AUTHENTICATION,
        })
      )
    );
  } catch (error) {
    logger.warn(
      { err: error, count: attachments.length },
      'Failed to write vision fail-fast entries to negative cache — returning placeholders anyway'
    );
  }

  logger.info(
    { count: attachments.length },
    'Built synthetic vision-auth-failure results (no usable key for vision or free-fallback provider)'
  );
  return results;
}
