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
  type ImageDescriptionJobData,
  type ImageDescriptionResult,
  imageDescriptionJobDataSchema,
} from '@tzurot/common-types';
import { describeImage } from '../services/MultimodalProcessor.js';
import { withRetry } from '../utils/retry.js';
import { shouldRetryError, getErrorLogContext } from '../utils/apiErrorParser.js';
import type { ApiKeyResolver } from '../services/ApiKeyResolver.js';
import {
  resolveVisionConfig,
  VISION_AUTH_FAIL_FAST_DESCRIPTION,
  type VisionConfigResult,
} from '../services/multimodal/visionAuthResolver.js';

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
 * Resolve auth + model for vision processing via the unified `resolveVisionConfig`.
 *
 * `ImageDescriptionJob` runs as a standalone preprocessing job at upload time,
 * so it has no upstream main-model auth context — `mainProvider`/`mainApiKey`
 * are undefined (the same-provider fast path is skipped; per-provider resolution
 * always runs). `isGuestMode` is passed as `false`: the resolver discriminates
 * genuine-guest-vs-authenticated by probing the vision provider's user key, and
 * a genuine guest with no keys anywhere still resolves correctly to the system
 * key + free model via the broad free-fallback branch.
 *
 * Returns the unified `VisionConfigResult` directly. When `apiKeyResolver` is
 * undefined (legacy test-fixture path; production always wires it via the
 * worker bootstrap), we synthesize a `resolved` result that proceeds with no
 * user key — matching the pre-unification legacy behavior.
 */
async function resolveVisionApiKey(
  apiKeyResolver: ApiKeyResolver | undefined,
  userId: string,
  personality: ImageDescriptionJobData['personality']
): Promise<VisionConfigResult> {
  if (!apiKeyResolver) {
    // Legacy/no-resolver path: proceed with no user key. `describeImage`
    // self-selects the model (model omitted) and `createChatModel` falls back
    // to the env-default provider — same as the pre-unification behavior for
    // this branch.
    return {
      kind: 'resolved',
      config: {
        apiKey: '',
        provider: AIProvider.OpenRouter,
        model: '',
        source: 'system',
        isGuestMode: false,
      },
    };
  }

  return resolveVisionConfig({
    personality,
    // No upstream main-model context at upload time — skip the same-provider
    // fast path so per-provider resolution always runs.
    mainProvider: undefined,
    mainApiKey: undefined,
    isGuestMode: false,
    userId,
    apiKeyResolver,
  });
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
  /**
   * Pre-resolved vision model from `resolveVisionConfig`. Forwarded to
   * `describeImage` so a forced free-tier downgrade is honored rather than
   * re-selected. `undefined` falls back to `describeImage`'s self-selection.
   */
  model: string | undefined;
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
  const {
    attachment,
    personality,
    isGuestMode,
    userApiKey,
    visionProvider,
    model,
    loggingContext,
  } = options;
  try {
    const result = await withRetry(
      () =>
        describeImage(attachment, personality, isGuestMode, userApiKey, {
          skipNegativeCache: true,
          provider: visionProvider,
          model,
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
 * Each image gets a "configure your key" description (visible to the LLM when it
 * consumes the dependency-job result) — the same fallback string the
 * channel-history path emits via `buildVisionAuthFailureResults`, so the user
 * sees consistent behavior regardless of how the image arrived.
 */
function buildFailFastResult(opts: {
  requestId: string;
  attachments: ImageDescriptionJobData['attachments'];
  visionProvider: AIProvider;
  sourceReferenceNumber: number | undefined;
  startTime: number;
}): ImageDescriptionResult {
  const { requestId, attachments, visionProvider, sourceReferenceNumber, startTime } = opts;

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

  // Fail-fast: even the free-model system fallback is unavailable (no system
  // OpenRouter key configured) for an authenticated user lacking a vision key.
  // Mirrors DependencyStep's `buildVisionAuthFailureResults` behavior so direct
  // upload and channel-history paths produce the same "configure your key"
  // fallback for the same user setup.
  if (authResult.kind === 'failFast') {
    return buildFailFastResult({
      requestId,
      attachments,
      visionProvider: authResult.provider,
      sourceReferenceNumber,
      startTime,
    });
  }

  const { config } = authResult;
  // The no-resolver legacy path synthesizes empty apiKey/model sentinels —
  // normalize them back to `undefined` so `describeImage` self-selects the model
  // and `createChatModel` doesn't receive an empty Authorization header.
  const isGuestMode = config.isGuestMode;
  const userApiKey = config.apiKey.length > 0 ? config.apiKey : undefined;
  const visionModel = config.model.length > 0 ? config.model : undefined;
  const apiKeySource = config.source;
  // The legacy no-resolver path resolves to provider=OpenRouter with an empty
  // apiKey; in that case leave `visionProvider` undefined so `createChatModel`
  // falls back to the env default exactly as the pre-unification path did.
  const visionProvider = userApiKey !== undefined ? config.provider : undefined;
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
          model: visionModel,
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
