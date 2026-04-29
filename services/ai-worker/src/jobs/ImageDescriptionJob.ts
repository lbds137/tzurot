/**
 * Image Description Job Processor
 *
 * Handles image description preprocessing jobs.
 * Processes image attachments using vision models to generate descriptions.
 * Results are stored in Redis for dependent jobs to consume.
 */

import { Job } from 'bullmq';
import {
  createLogger,
  CONTENT_TYPES,
  TIMEOUTS,
  AIProvider,
  ApiErrorCategory,
  type ImageDescriptionJobData,
  type ImageDescriptionResult,
  imageDescriptionJobDataSchema,
} from '@tzurot/common-types';
import { describeImage } from '../services/MultimodalProcessor.js';
import { withRetry } from '../utils/retry.js';
import { shouldRetryError, getErrorLogContext } from '../utils/apiErrorParser.js';
import type { ApiKeyResolver } from '../services/ApiKeyResolver.js';
import { detectVisionProvider } from '../services/ProviderRouter.js';
import { VISION_AUTH_FAIL_FAST_DESCRIPTION } from '../services/multimodal/visionAuthResolver.js';

const logger = createLogger('ImageDescriptionJob');

/**
 * Vision retry cap: 2 attempts (1 initial + 1 retry). LangChain's 90s internal
 * timeout fires deterministically on provider stalls; retrying beyond 2 attempts
 * doubled wait time without measurable recovery.
 * Revisit after telemetry confirms TIMEOUT retry-success-rate.
 */
const VISION_MAX_ATTEMPTS = 2;

/** Result of processing a single image */
interface ImageProcessResult {
  url: string;
  description?: string;
  error?: string;
  success: boolean;
}

/**
 * Result of API key resolution for vision processing.
 *
 * Discriminated union: a normal `proceed` result with the resolved auth context,
 * or a `failFast` signal when the user is authenticated for some provider but
 * lacks a key for the vision provider — matches the policy enforced in
 * `DependencyStep` via `resolveVisionAuth` so a Discord user gets the same
 * fallback string regardless of which path serves their image (direct upload
 * vs. channel-history extended context).
 */
type VisionApiKeyResult =
  | {
      kind: 'proceed';
      isGuestMode: boolean;
      userApiKey?: string;
      apiKeySource?: 'user' | 'system';
      visionProvider?: AIProvider;
    }
  | {
      kind: 'failFast';
      visionProvider: AIProvider;
    };

/**
 * Providers checked when determining whether a user is "authenticated" — i.e.
 * has at least one user-configured key for SOME provider. Drives the
 * fail-fast vs system-fallback discriminator inside `resolveVisionApiKey`.
 *
 * Order doesn't matter for correctness — short-circuits on first hit. Listed
 * with OpenRouter first because it's the most common BYOK target. ElevenLabs
 * intentionally excluded: it's voice-only, not an LLM/vision provider, and
 * a user with only an ElevenLabs key shouldn't be classified as "LLM
 * authenticated" for vision purposes.
 */
const USER_AUTH_PROBE_PROVIDERS: AIProvider[] = [AIProvider.OpenRouter, AIProvider.ZaiCoding];

/**
 * Determine whether a user has at least one user-configured key for any LLM
 * provider. Used as the "authenticated vs genuine guest" discriminator
 * inside this job, since (unlike DependencyStep) ImageDescriptionJob has no
 * upstream `auth.isGuestMode` signal — it runs as a standalone preprocessing
 * job at upload time.
 *
 * Each call hits ApiKeyResolver's internal cache after the first lookup per
 * `userId × provider` pair, so the cost is bounded.
 */
async function userHasAnyKey(apiKeyResolver: ApiKeyResolver, userId: string): Promise<boolean> {
  for (const provider of USER_AUTH_PROBE_PROVIDERS) {
    const key = await apiKeyResolver.tryResolveUserKey(userId, provider);
    if (key !== null) {
      return true;
    }
  }
  return false;
}

/**
 * Resolve API key for vision processing via BYOK lookup.
 *
 * Decision tree (matches `resolveVisionAuth` policy in `DependencyStep`):
 * - User has key for vision provider → use user key
 * - User has no key for vision provider, but is authenticated for some other
 *   provider → fail fast (no silent system-key fallback for authenticated users)
 * - User has no keys anywhere → genuine guest, system-key fallback
 *
 * Detects the vision provider from the personality's vision model (vs the
 * old hardcoded `AIProvider.OpenRouter`) so that personalities with z.ai
 * vision models route to z.ai instead of mistakenly looking up the user's
 * OpenRouter key.
 */
async function resolveVisionApiKey(
  apiKeyResolver: ApiKeyResolver | undefined,
  userId: string,
  personality: ImageDescriptionJobData['personality']
): Promise<VisionApiKeyResult> {
  if (!apiKeyResolver) {
    return { kind: 'proceed', isGuestMode: false };
  }

  // Provider detection runs against the actual vision-model name. The fallback
  // chain (visionModel → main model → env default) mirrors `selectVisionModel`
  // in VisionProcessor, but we don't have hasVisionSupport access here, so we
  // take the explicit visionModel override if set, else default to the main
  // model's provider (which is what selectVisionModel would also pick when
  // the main model has native vision).
  const visionModelName =
    personality.visionModel !== undefined &&
    personality.visionModel !== null &&
    personality.visionModel.length > 0
      ? personality.visionModel
      : personality.model;
  const visionProvider = detectVisionProvider(visionModelName);

  try {
    // First: try user's key for the vision provider directly. No system
    // fallback here — that would silently consume the system key for an
    // authenticated user, contradicting the user-confirmed policy.
    const userKey = await apiKeyResolver.tryResolveUserKey(userId, visionProvider);
    if (userKey !== null) {
      logger.debug(
        { userId, visionProvider, source: 'user' },
        'Resolved user API key for vision processing'
      );
      return {
        kind: 'proceed',
        isGuestMode: false,
        userApiKey: userKey,
        apiKeySource: 'user',
        visionProvider,
      };
    }

    // No user key for vision provider. Discriminate: authenticated user
    // missing this provider's key (fail fast) vs. genuine guest (system
    // fallback).
    const isAuthenticatedForSomeProvider = await userHasAnyKey(apiKeyResolver, userId);
    if (isAuthenticatedForSomeProvider) {
      logger.info(
        { userId, visionProvider },
        'Authenticated user lacks key for vision provider — failing fast (no system fallback)'
      );
      return { kind: 'failFast', visionProvider };
    }

    // Genuine guest — no user keys configured anywhere. System fallback is
    // the only path that works for them; consistent with main-model auth
    // resolution for guests.
    const guestResult = await apiKeyResolver.resolveApiKey(userId, visionProvider);
    logger.debug(
      { userId, visionProvider, source: guestResult.source },
      'Guest path — using system key fallback for vision'
    );
    return {
      kind: 'proceed',
      isGuestMode: guestResult.isGuestMode,
      userApiKey: guestResult.source === 'user' ? guestResult.apiKey : undefined,
      apiKeySource: guestResult.source,
      visionProvider,
    };
  } catch (error) {
    logger.warn(
      { err: error, userId, visionProvider },
      'Failed to resolve API key, defaulting to guest mode'
    );
    return { kind: 'proceed', isGuestMode: true, visionProvider };
  }
}

/**
 * Per-image processing context — options-bag bundles auth + diagnostic fields
 * to keep `processSingleImage` within the max-params lint limit.
 */
interface ProcessSingleImageOptions {
  attachment: ImageDescriptionJobData['attachments'][0];
  personality: ImageDescriptionJobData['personality'];
  isGuestMode: boolean;
  userApiKey: string | undefined;
  visionProvider: AIProvider | undefined;
  loggingContext: {
    userId?: string;
    apiKeySource?: 'user' | 'system';
    jobId?: string;
  };
}

/**
 * Process a single image attachment with retry logic
 */
async function processSingleImage(options: ProcessSingleImageOptions): Promise<ImageProcessResult> {
  const { attachment, personality, isGuestMode, userApiKey, visionProvider, loggingContext } =
    options;
  try {
    const result = await withRetry(
      () =>
        describeImage(attachment, personality, isGuestMode, userApiKey, {
          skipNegativeCache: true,
          provider: visionProvider,
          loggingContext: { ...loggingContext, provider: visionProvider },
        }),
      {
        maxAttempts: VISION_MAX_ATTEMPTS,
        globalTimeoutMs: TIMEOUTS.VISION_MODEL * VISION_MAX_ATTEMPTS,
        logger,
        operationName: `Image description (${attachment.name})`,
        shouldRetry: shouldRetryError,
        // Enrich failure logs with errorCategory, statusCode, etc. so post-deploy
        // telemetry can answer: "retry success rate per errorCategory".
        getErrorContext: getErrorLogContext,
      }
    );
    return { url: attachment.url, description: result.value, success: true };
  } catch (error) {
    logger.warn(
      { url: attachment.url, err: error },
      'Image description failed after retries - continuing with other images'
    );
    return {
      url: attachment.url,
      error: error instanceof Error ? error.message : String(error),
      success: false,
    };
  }
}

/**
 * Build a fail-fast `ImageDescriptionResult` for the case where the user is
 * authenticated for some provider but lacks a key for the vision provider.
 *
 * Each image gets a "configure your key" description (visible to the LLM
 * when it consumes the dependency-job result) and a synthetic AUTHENTICATION
 * cache entry so subsequent retries within the 5-min window hit cache and
 * skip re-resolving + re-failing — same UX shape as a real auth-rejection
 * from the upstream provider's API.
 *
 * Mirrors `buildVisionAuthFailureResults` in `visionAuthResolver.ts` (the
 * channel-history path's equivalent helper). The two paths produce identical
 * fallback strings + cache shapes so the user sees consistent behavior
 * regardless of how the image arrived.
 */
async function buildFailFastResult(opts: {
  requestId: string;
  attachments: ImageDescriptionJobData['attachments'];
  visionProvider: AIProvider;
  sourceReferenceNumber: number | undefined;
  startTime: number;
}): Promise<ImageDescriptionResult> {
  const { requestId, attachments, visionProvider, sourceReferenceNumber, startTime } = opts;

  // Lazy import only for `visionDescriptionCache` — `redis.js` instantiates
  // a Redis client singleton at module-load, which we want to defer past
  // test-time imports. The other dependencies (`ApiErrorCategory` enum,
  // `VISION_AUTH_FAIL_FAST_DESCRIPTION` string constant) have no init-time
  // side effects and live in the static import block at the top.
  const { visionDescriptionCache } = await import('../redis.js');

  // Cache writes parallelize because each cache key is distinct (per attachment).
  await Promise.all(
    attachments.map(attachment =>
      visionDescriptionCache.storeFailure({
        attachmentId: attachment.id,
        url: attachment.url,
        category: ApiErrorCategory.AUTHENTICATION,
      })
    )
  );

  const descriptions = attachments.map(attachment => ({
    url: attachment.url,
    description: VISION_AUTH_FAIL_FAST_DESCRIPTION,
  }));

  const processingTimeMs = Date.now() - startTime;
  logger.info(
    { requestId, visionProvider, imageCount: attachments.length, processingTimeMs },
    'Vision auth fail-fast — authenticated user has no key for vision provider'
  );

  return {
    requestId,
    success: true, // "successful" in that we have a description for each image
    descriptions,
    sourceReferenceNumber,
    metadata: { processingTimeMs, imageCount: descriptions.length, failedCount: 0 },
  };
}

/**
 * Build error result when all images fail
 */
function buildAllFailedResult(
  requestId: string,
  results: ImageProcessResult[],
  totalImages: number,
  sourceReferenceNumber?: number
): ImageDescriptionResult {
  const failureDetails = results
    .filter(r => !r.success)
    .map(r => `${r.url}: ${r.error}`)
    .join('; ');

  logger.error({ requestId, totalImages, failureDetails }, 'All image descriptions failed');

  return {
    requestId,
    success: false,
    error: `All images failed processing. Details: ${failureDetails}`,
    sourceReferenceNumber,
  };
}

/**
 * Process image description job
 *
 * @param job - BullMQ job with image description data
 * @param apiKeyResolver - Optional resolver for determining guest mode status
 */
export async function processImageDescriptionJob(
  job: Job<ImageDescriptionJobData>,
  apiKeyResolver?: ApiKeyResolver
): Promise<ImageDescriptionResult> {
  const startTime = Date.now();

  // Validate job payload against schema (contract testing)
  const validation = imageDescriptionJobDataSchema.safeParse(job.data);
  if (!validation.success) {
    logger.error({ jobId: job.id, errors: validation.error.format() }, 'Job validation failed');
    throw new Error(`Image description job validation failed: ${validation.error.message}`);
  }

  const { requestId, attachments, personality, context, sourceReferenceNumber } = job.data;
  const authResult = await resolveVisionApiKey(apiKeyResolver, context.userId, personality);

  logger.info(
    { jobId: job.id, requestId, imageCount: attachments.length, personalityName: personality.name },
    'Processing image description job'
  );

  // Fail-fast: authenticated user has no key for the vision provider. Mirrors
  // DependencyStep's `buildVisionAuthFailureResults` behavior so direct upload
  // and channel-history paths produce the same fallback shape for the same
  // user setup. Each image gets the source-aware "configure your key"
  // description and a synthetic AUTH cache entry so retries within the 5-min
  // window hit cache instead of repeating the resolution + failing again.
  if (authResult.kind === 'failFast') {
    return buildFailFastResult({
      requestId,
      attachments,
      visionProvider: authResult.visionProvider,
      sourceReferenceNumber,
      startTime,
    });
  }

  const { isGuestMode, userApiKey, apiKeySource, visionProvider } = authResult;
  const loggingContext = {
    userId: context.userId,
    apiKeySource,
    jobId: typeof job.id === 'string' ? job.id : undefined,
  };

  try {
    // Validate attachments
    for (const attachment of attachments) {
      if (!attachment.contentType.startsWith(CONTENT_TYPES.IMAGE_PREFIX)) {
        throw new Error(`Invalid attachment type: ${attachment.contentType}. Expected image.`);
      }
    }

    // Process all images in parallel with graceful degradation
    const results = await Promise.all(
      attachments.map(attachment =>
        processSingleImage({
          attachment,
          personality,
          isGuestMode,
          userApiKey,
          visionProvider,
          loggingContext,
        })
      )
    );

    // Filter for successful descriptions
    const descriptions = results
      .filter(
        (r): r is ImageProcessResult & { description: string } =>
          r.success && r.description !== undefined
      )
      .map(r => ({ url: r.url, description: r.description }));

    const failedCount = results.length - descriptions.length;

    if (descriptions.length === 0) {
      return buildAllFailedResult(requestId, results, attachments.length, sourceReferenceNumber);
    }

    if (failedCount > 0) {
      logger.warn(
        { requestId, successCount: descriptions.length, failedCount },
        'Some images failed processing - proceeding with partial results'
      );
    }

    const processingTimeMs = Date.now() - startTime;
    logger.info(
      { jobId: job.id, requestId, processingTimeMs, imageCount: descriptions.length },
      'Image description completed'
    );

    return {
      requestId,
      success: true,
      descriptions,
      sourceReferenceNumber,
      metadata: { processingTimeMs, imageCount: descriptions.length, failedCount },
    };
  } catch (error) {
    const processingTimeMs = Date.now() - startTime;
    logger.error({ err: error, jobId: job.id, requestId }, 'Image description failed');

    return {
      requestId,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      sourceReferenceNumber,
      metadata: { processingTimeMs, imageCount: attachments.length },
    };
  }
}
