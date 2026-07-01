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
 * `ProcessedAttachment[]` (the "configure your key" placeholders) when the
 * resolver returns `failFast`.
 */

import {
  createLogger,
  AIProvider,
  AttachmentType,
  MODEL_DEFAULTS,
  type AttachmentMetadata,
  type LoadedPersonality,
} from '@tzurot/common-types';
import { detectVisionProvider } from '../ProviderRouter.js';
import { selectVisionModel } from './VisionProcessor.js';
import { visionFallbackQuota } from '../../redis.js';
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
  { kind: 'resolved'; config: VisionConfig } | { kind: 'failFast'; provider: AIProvider };

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
 * BROAD FREE FALLBACK — authenticated user with no key for the vision provider.
 * Downgrade to the free vision model on the system key instead of fail-fasting.
 * MUST force BOTH the free model AND its provider's key: `selectVisionModel`
 * returns the PAID fallback for authenticated users (isGuestMode=false), so
 * handing the system key to the natural model would bill the system key for a
 * paid model.
 *
 * Only a SYSTEM-key downgrade spends the owner's shared free-tier quota, so only
 * it counts against the per-user daily cap (a user on their OWN OpenRouter key
 * doesn't). Over the cap → fail-fast. `resolveApiKey` throws propagate to the
 * caller's catch (→ fail-fast). `originalVisionProvider` is carried so a
 * fail-fast names what the user actually lacked, not the free-fallback provider.
 */
async function resolveBroadFreeFallback(
  userId: string | undefined,
  originalVisionProvider: AIProvider,
  apiKeyResolver: ApiKeyResolver
): Promise<VisionConfigResult> {
  const freeModel = MODEL_DEFAULTS.VISION_FALLBACK_FREE;
  const freeProvider = detectVisionProvider(freeModel);
  const sys = await apiKeyResolver.resolveApiKey(userId, freeProvider);
  // `sys.apiKey ?? ''` is defense-in-depth: resolveApiKey normally throws when
  // no key is available, but a misbehaving resolver returning null would
  // otherwise throw on `.length`.
  if ((sys.apiKey ?? '').length === 0) {
    logger.info(
      { userId, originalVisionProvider, freeProvider },
      'Vision free-fallback unavailable (no system key) — failing fast'
    );
    return { kind: 'failFast', provider: originalVisionProvider };
  }
  // `userId !== undefined` is always true here (the guest branch captured the
  // undefined case) — the guard narrows the type and fails open.
  if (
    sys.source === 'system' &&
    userId !== undefined &&
    !(await visionFallbackQuota.tryConsume(userId))
  ) {
    return { kind: 'failFast', provider: originalVisionProvider };
  }
  logger.info(
    { userId, originalVisionProvider, freeProvider, freeModel, source: sys.source },
    'Authenticated user lacks vision-provider key — downgrading to free vision model on system key'
  );
  return {
    kind: 'resolved',
    config: {
      apiKey: sys.apiKey,
      provider: freeProvider,
      model: freeModel,
      // `source` is whatever resolveApiKey returned — normally 'system'; if the
      // user happens to have an OpenRouter key it'd be 'user', which is fine
      // (they ARE authenticated, just downgraded for the vision model).
      source: sys.source,
      // NOT a guest — they're authenticated, only the vision model is downgraded.
      isGuestMode: false,
    },
  };
}

/**
 * Resolve the API key + provider for a SPECIFIC vision model. Parameterized by the
 * target model so a caller can resolve auth for ANY tier (Phase 4's runtime fallback
 * loop), not just the primary — a cross-provider fallback and a free-tier downgrade
 * each need their own key. `resolveVisionConfig` is the primary-model entry point that
 * computes the natural model then delegates here.
 *
 * Branch order:
 * 1. Same-provider fast path — reuse the upstream main-model key.
 * 2. Genuine guest (or unknown user) — system key for the vision provider.
 * 3. Authenticated user with a vision-provider key — use it.
 * 4. BROAD FREE FALLBACK — authenticated user lacking a vision-provider key
 *    downgrades to the free vision model on the system OpenRouter key (instead
 *    of fail-fasting). Forces BOTH the free model AND its provider's system key
 *    so the system key never gets billed for a paid model.
 * 5. Fallback-of-fallback — if even the free-model system key is unavailable
 *    (no system OpenRouter key configured), `failFast` so the caller emits the
 *    "configure your key" placeholder against the ORIGINAL vision provider.
 */
export async function resolveVisionAuth(
  targetModel: string,
  visionProvider: AIProvider,
  options: ResolveVisionConfigOptions
): Promise<VisionConfigResult> {
  const { mainProvider, mainApiKey, isGuestMode, userId, apiKeyResolver } = options;

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
        model: targetModel,
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
  // block intentionally in `resolveVisionConfig` — `selectVisionModel`'s Redis
  // reads already degrade to a pattern-matching fallback, so a genuine throw
  // there is a real error worth surfacing, not masking as a placeholder.)
  try {
    if (treatAsGuest) {
      // Genuine guest — system key is the only path that works for them.
      // For the primary path `selectVisionModel` already returned the free model,
      // so `targetModel` is correct here.
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
          model: targetModel,
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
          model: targetModel,
          source: 'user',
          isGuestMode: false,
        },
      };
    }

    // Authenticated user with no key for the vision provider → broad free
    // fallback (downgrade to the free vision model on the system key). Extracted
    // to keep this function under the line limit; runs inside this try so its
    // `resolveApiKey` throw still degrades to fail-fast via the catch below.
    return await resolveBroadFreeFallback(userId, visionProvider, apiKeyResolver);
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
 * Resolve the API key + provider + model for the PRIMARY vision call atomically.
 * Computes the natural vision model via `selectVisionModel`, then delegates auth
 * resolution to `resolveVisionAuth`. (Phase 4's fallback loop calls `resolveVisionAuth`
 * directly, once per tier, with that tier's model.)
 */
export async function resolveVisionConfig(
  options: ResolveVisionConfigOptions
): Promise<VisionConfigResult> {
  // Compute the natural model with the same selection logic `describeImage`
  // uses internally, so provider detection sees the actual model rather than
  // the main model (e.g. main=glm-5.1 with no native vision falls through to
  // the OpenRouter fallback model — its provider is OpenRouter, not z.ai).
  const naturalModel = await selectVisionModel(options.personality, options.isGuestMode);
  const visionProvider = detectVisionProvider(naturalModel);
  return resolveVisionAuth(naturalModel, visionProvider, options);
}

/**
 * Build synthetic AUTHENTICATION-failure ProcessedAttachment entries for a
 * batch of image attachments when `resolveVisionConfig` returns `failFast`
 * (no usable key for the vision provider AND no system free-fallback key).
 *
 * Each entry gets the source-aware "configure your key" fallback description.
 * The placeholders are always returned so the caller's outer catch can't turn
 * the fail-fast into an empty result (which would silently drop the images
 * instead of showing the "[Image unavailable…]" fallback). The fail-fast path is
 * reachable by an authenticated user lacking both the vision-provider key and
 * the system free-fallback key, OR by a transient resolver throw — so it is not
 * exclusively an authentication condition.
 */
export function buildVisionAuthFailureResults(
  attachments: AttachmentMetadata[]
): ProcessedAttachment[] {
  const results: ProcessedAttachment[] = attachments.map(attachment => ({
    type: AttachmentType.Image,
    description: VISION_AUTH_FAIL_FAST_DESCRIPTION,
    originalUrl: attachment.url,
    metadata: attachment,
  }));

  logger.info(
    { count: attachments.length },
    'Built synthetic vision-auth-failure results (no usable key for vision or free-fallback provider)'
  );
  return results;
}
