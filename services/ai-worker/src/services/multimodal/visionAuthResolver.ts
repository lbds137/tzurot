/**
 * Vision Auth Resolver
 *
 * Resolves the API key + provider for a vision call **independently** from the
 * main-model auth resolution. The personality's vision model may live on a
 * different provider than its main model (e.g., main=`glm-5.1` on z.ai-coding,
 * vision=`qwen/qwen3.5-...` on OpenRouter); using the main-model key for the
 * vision call results in a 401 from the vision provider's API.
 *
 * Returns either:
 * - A `VisionAuth` triple — caller proceeds with the vision call normally
 * - `null` — caller MUST short-circuit (do NOT pass `undefined` to
 *   `createChatModel`, which would silently fall back to the system key and
 *   contradict the user-confirmed "no system fallback for authenticated users
 *   without a vision-provider key" policy)
 *
 * Use `buildVisionAuthFailureResults` to construct the synthetic-failure
 * `ProcessedAttachment[]` when the resolver returns null. That helper writes
 * to the negative cache so subsequent retries within the 5-min window hit
 * cache instead of re-resolving and re-failing.
 */

import {
  createLogger,
  AIProvider,
  AttachmentType,
  ApiErrorCategory,
  type AttachmentMetadata,
  type LoadedPersonality,
} from '@tzurot/common-types';
import { detectVisionProvider } from '../ProviderRouter.js';
import { visionDescriptionCache } from '../../redis.js';
import type { ApiKeyResolver } from '../ApiKeyResolver.js';
import type { ProcessedAttachment } from '../MultimodalProcessor.js';

const logger = createLogger('VisionAuthResolver');

/**
 * Resolved auth context for a vision call.
 */
export interface VisionAuth {
  apiKey: string;
  source: 'user' | 'system';
  provider: AIProvider;
}

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
 * the missing image with the embedded "/wallet" hint.
 */
export const VISION_AUTH_FAIL_FAST_DESCRIPTION =
  '[Image unavailable: your API key was rejected — check /wallet for the vision provider key]';

/**
 * Inputs for `resolveVisionAuth` — bundled into an options object to keep the
 * call site readable when threaded through pipeline steps.
 */
export interface ResolveVisionAuthOptions {
  /** Personality whose vision model determines the target provider */
  personality: LoadedPersonality;
  /**
   * Provider that the main-model resolution landed on (typically `auth.provider`
   * from the upstream `AuthStep`). Drives the "is this same-provider, can we
   * reuse the main key?" decision.
   */
  mainProvider: AIProvider;
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
  /**
   * Override for the vision model name. Normally `resolveVisionAuth` derives
   * the provider from `personality.visionModel ?? personality.model`. Callers
   * with a precomputed effective model name (e.g., `selectVisionModel` already
   * ran) may pass it here to keep the two decisions consistent.
   */
  effectiveVisionModel?: string;
}

/**
 * Resolve the API key + provider for a vision call, given main-model auth context.
 *
 * Returns `null` ONLY when the user is authenticated and has no key for the
 * vision provider — caller must short-circuit. Genuine guests (no main-model
 * user key either) get the system key for the vision provider via the standard
 * `resolveApiKey` fallback path.
 */
export async function resolveVisionAuth(
  options: ResolveVisionAuthOptions
): Promise<VisionAuth | null> {
  const { personality, mainProvider, mainApiKey, isGuestMode, userId, apiKeyResolver } = options;

  const visionModelName =
    options.effectiveVisionModel ??
    (personality.visionModel !== undefined &&
    personality.visionModel !== null &&
    personality.visionModel.length > 0
      ? personality.visionModel
      : personality.model);

  const visionProvider = detectVisionProvider(visionModelName);

  // Same-provider fast path — reuse the upstream-resolved key without a
  // second resolver call. Avoids redundant DB reads for the common case where
  // main and vision share a provider.
  //
  // Gated on a non-empty `mainApiKey` because AuthStep's resolution-failure
  // catch branch returns `resolvedApiKey: undefined` regardless of whether
  // the failing user was authenticated or guest (it's the rare error path
  // where ProviderRouter.resolveRoute throws — see AuthStep.ts:192-197).
  // Reusing an empty key would silently reach `createChatModel` with no
  // Authorization header and reproduce the exact bug this resolver exists
  // to prevent. Falling through to per-provider resolution lets the user's
  // actual keys (if any) be picked up via apiKeyResolver, rather than
  // blindly trusting a degraded upstream context.
  if (visionProvider === mainProvider && mainApiKey !== undefined && mainApiKey.length > 0) {
    logger.debug(
      { userId, visionProvider, isGuestMode },
      'Vision auth same-provider fast path — reusing main-model key'
    );
    return {
      apiKey: mainApiKey,
      source: isGuestMode ? 'system' : 'user',
      provider: visionProvider,
    };
  }

  // Defensive guard: an authenticated context (`isGuestMode === false`)
  // that nonetheless has no userId is contradictory — `tryResolveUserKey`
  // requires a userId to look up wallet entries. In practice the upstream
  // pipeline only sets `isGuestMode: false` after a successful user-key
  // resolution (which requires userId), so this branch isn't reachable from
  // production code. Logging at warn level + degrading to the guest path
  // surfaces a regression if any future caller violates the invariant
  // without crashing the request.
  if (!isGuestMode && userId === undefined) {
    logger.warn(
      { mainProvider, visionProvider },
      'Vision auth: !isGuestMode but userId undefined — degrading to guest path'
    );
  }
  const treatAsGuest = isGuestMode || userId === undefined;

  // Cross-provider: re-resolve for the vision provider.
  if (treatAsGuest) {
    // Genuine guest — system key is the only path that works for them. Vision
    // requests in guest mode are restricted to free models by the provider
    // anyway, so this is consistent with main-model auth behavior.
    const result = await apiKeyResolver.resolveApiKey(userId, visionProvider);
    logger.info(
      { userId, visionProvider, mainProvider, source: result.source },
      'Cross-provider vision auth resolved (guest path)'
    );
    return {
      apiKey: result.apiKey,
      source: result.source,
      provider: visionProvider,
    };
  }

  // Authenticated user — user key only, no system fallback. If user has no
  // key for the vision provider, return null so caller can short-circuit
  // with a "configure your key" fallback string.
  const userKey = await apiKeyResolver.tryResolveUserKey(userId, visionProvider);
  if (userKey === null) {
    logger.info(
      { userId, visionProvider, mainProvider },
      'Cross-provider vision auth: authenticated user has no key for vision provider — failing fast'
    );
    return null;
  }
  logger.info(
    { userId, visionProvider, mainProvider, source: 'user' },
    'Cross-provider vision auth resolved (authenticated user key)'
  );
  return {
    apiKey: userKey,
    source: 'user',
    provider: visionProvider,
  };
}

/**
 * Build synthetic AUTHENTICATION-failure ProcessedAttachment entries for a
 * batch of image attachments when `resolveVisionAuth` returned null. Writes
 * each entry to the negative cache so subsequent retries within the 5-min
 * window hit cache instead of re-resolving — same UX as a real auth rejection
 * by the upstream API.
 */
export async function buildVisionAuthFailureResults(
  attachments: AttachmentMetadata[]
): Promise<ProcessedAttachment[]> {
  // Synthetic failures use AUTHENTICATION category so the source-aware fallback
  // string fires. apiKeySource is 'user' here because the caller is an
  // authenticated user (only path that returns null from resolveVisionAuth).
  // Cache writes parallelize because they're independent — each attachment has
  // a distinct cache key.
  await Promise.all(
    attachments.map(attachment =>
      visionDescriptionCache.storeFailure({
        attachmentId: attachment.id,
        url: attachment.url,
        category: ApiErrorCategory.AUTHENTICATION,
      })
    )
  );
  const results: ProcessedAttachment[] = attachments.map(attachment => ({
    type: AttachmentType.Image,
    description: VISION_AUTH_FAIL_FAST_DESCRIPTION,
    originalUrl: attachment.url,
    metadata: attachment,
  }));
  logger.info(
    { count: attachments.length },
    'Built synthetic vision-auth-failure results (no user key for vision provider)'
  );
  return results;
}
