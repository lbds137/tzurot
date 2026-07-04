/**
 * Image Description Job Processor
 *
 * Handles image description preprocessing jobs.
 * Processes image attachments using vision models to generate descriptions.
 * Results are stored in Redis for dependent jobs to consume.
 */

import { Job } from 'bullmq';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { CONTENT_TYPES } from '@tzurot/common-types/constants/media';
import { TIMEOUTS } from '@tzurot/common-types/constants/timing';
import {
  type ImageDescriptionJobData,
  type ImageDescriptionResult,
  imageDescriptionJobDataSchema,
} from '@tzurot/common-types/types/jobs';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { describeImage } from '../services/MultimodalProcessor.js';
import { describeImageWithFallback } from '../services/multimodal/describeImageWithFallback.js';
import { withRetry } from '../utils/retry.js';
import { shouldRetryError, getErrorLogContext } from '../utils/apiErrorParser.js';
import type { ApiKeyResolver } from '../services/ApiKeyResolver.js';
import {
  type VisionConfigResult,
  type ResolveVisionConfigOptions,
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
 * Synthesize the legacy no-resolver auth result. Only the legacy test-fixture
 * path reaches this — production always wires an `apiKeyResolver`, and that
 * path hands the auth INPUTS to the fallback loop instead of pre-resolving
 * (see `resolveImageJobAuth`).
 */
function resolveVisionApiKey(): VisionConfigResult {
  // Legacy/no-resolver path: proceed with no user key. `describeImage`
  // self-selects the model (model omitted) and `createChatModel` falls back
  // to the env-default provider — same as the pre-unification behavior for
  // this branch. The resolver-wired path never reaches here (it hands the
  // auth INPUTS to the fallback loop instead — see resolveImageJobAuth).
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

/** Per-image auth for `processImageDescriptionJob` — either the fallback-loop INPUTS or legacy pre-resolved fields. */
interface ImageJobAuth {
  /** Present on the resolver-wired path → routes to `describeImageWithFallback`. */
  visionAuth?: ResolveVisionConfigOptions;
  isGuestMode: boolean;
  userApiKey: string | undefined;
  visionProvider: AIProvider | undefined;
  visionModel: string | undefined;
  apiKeySource: 'user' | 'system';
}

/**
 * Resolve per-image auth for the job:
 * - Resolver wired (production): hand the auth INPUTS to the fallback loop, which resolves
 *   per tier + retries down the model chain + renders the "configure your key" placeholder on
 *   auth-exhaustion. We do NOT pre-resolve — a pre-resolve's broad-free-fallback would consume
 *   the daily free-vision quota a SECOND time against the loop's own once-per-request consume.
 * - No resolver (legacy test path): resolve once (always synthesizes a `resolved` config, never
 *   fail-fast) and expose the pre-resolved fields for the single-model describeImage.
 */
function resolveImageJobAuth(
  apiKeyResolver: ApiKeyResolver | undefined,
  userId: string,
  personality: ImageDescriptionJobData['personality']
): ImageJobAuth {
  const base: ImageJobAuth = {
    isGuestMode: false,
    userApiKey: undefined,
    visionProvider: undefined,
    visionModel: undefined,
    apiKeySource: 'system',
  };
  if (apiKeyResolver !== undefined) {
    return {
      ...base,
      visionAuth: {
        personality,
        mainProvider: undefined,
        mainApiKey: undefined,
        isGuestMode: false,
        userId,
        apiKeyResolver,
      },
    };
  }
  const authResult = resolveVisionApiKey();
  if (authResult.kind !== 'resolved') {
    return base;
  }
  const { config } = authResult;
  // Normalize the synthesized empty sentinels back to `undefined` so `describeImage`
  // self-selects the model and `createChatModel` gets no empty Authorization header.
  const userApiKey = config.apiKey.length > 0 ? config.apiKey : undefined;
  return {
    isGuestMode: config.isGuestMode,
    userApiKey,
    visionModel: config.model.length > 0 ? config.model : undefined,
    apiKeySource: config.source,
    visionProvider: userApiKey !== undefined ? config.provider : undefined,
  };
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
  /**
   * Phase-4 vision fallback: the auth INPUTS. When present, the image routes through
   * `describeImageWithFallback` (per-tier auth + retry-down-the-chain, never throws — the
   * loop IS the retry, so no `withRetry` wrapper). When absent (legacy no-resolver path),
   * the single-model `describeImage` runs under `withRetry` with the pre-resolved fields.
   */
  visionAuth?: ResolveVisionConfigOptions;
  loggingContext: {
    userId?: string;
    apiKeySource?: 'user' | 'system';
    jobId?: string;
  };
}

/**
 * Process a single image attachment. With `visionAuth`, the fallback loop owns the retry
 * (down the model chain); otherwise the legacy single-model path retries in place.
 */
async function processSingleImage(options: ProcessSingleImageOptions): Promise<ImageProcessResult> {
  const {
    attachment,
    personality,
    isGuestMode,
    userApiKey,
    visionProvider,
    model,
    visionAuth,
    loggingContext,
  } = options;
  if (visionAuth !== undefined) {
    // The loop never throws — it returns a description or a placeholder — so there's no
    // withRetry (the tier walk IS the retry) and no catch: a placeholder is a valid result.
    const description = await describeImageWithFallback(attachment, personality, visionAuth, {
      loggingContext,
    });
    return { url: attachment.url, description, success: true };
  }
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

  logger.info(
    { jobId: job.id, requestId, imageCount: attachments.length, personalityName: personality.name },
    'Processing image description job'
  );

  const { visionAuth, isGuestMode, userApiKey, visionProvider, visionModel, apiKeySource } =
    resolveImageJobAuth(apiKeyResolver, context.userId, personality);

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
          visionAuth,
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
