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
  RETRY_CONFIG,
  AIProvider,
  type ImageDescriptionJobData,
  type ImageDescriptionResult,
  imageDescriptionJobDataSchema,
} from '@tzurot/common-types';
import { describeImage } from '../services/MultimodalProcessor.js';
import { withRetry } from '../utils/retry.js';
import type { ApiKeyResolver } from '../services/ApiKeyResolver.js';

const logger = createLogger('ImageDescriptionJob');

/** Result of processing a single image */
interface ImageProcessResult {
  url: string;
  description?: string;
  error?: string;
  success: boolean;
}

/**
 * Resolve guest mode status via BYOK lookup
 */
async function resolveGuestModeStatus(
  apiKeyResolver: ApiKeyResolver | undefined,
  userId: string
): Promise<boolean> {
  if (!apiKeyResolver) {
    return false;
  }

  try {
    const keyResult = await apiKeyResolver.resolveApiKey(userId, AIProvider.OpenRouter);
    logger.debug(
      { userId, isGuestMode: keyResult.isGuestMode },
      '[ImageDescriptionJob] Resolved guest mode status'
    );
    return keyResult.isGuestMode;
  } catch (error) {
    logger.warn(
      { err: error, userId },
      '[ImageDescriptionJob] Failed to resolve API key, defaulting to guest mode'
    );
    return true;
  }
}

/**
 * Process a single image attachment with retry logic
 */
async function processSingleImage(
  attachment: ImageDescriptionJobData['attachments'][0],
  personality: ImageDescriptionJobData['personality'],
  isGuestMode: boolean
): Promise<ImageProcessResult> {
  try {
    const result = await withRetry(() => describeImage(attachment, personality, isGuestMode), {
      maxAttempts: RETRY_CONFIG.MAX_ATTEMPTS,
      logger,
      operationName: `Image description (${attachment.name})`,
    });
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
    logger.error(
      { jobId: job.id, errors: validation.error.format() },
      '[ImageDescriptionJob] Job validation failed'
    );
    throw new Error(`Image description job validation failed: ${validation.error.message}`);
  }

  const { requestId, attachments, personality, context, sourceReferenceNumber } = job.data;
  const isGuestMode = await resolveGuestModeStatus(apiKeyResolver, context.userId);

  logger.info(
    { jobId: job.id, requestId, imageCount: attachments.length, personalityName: personality.name },
    '[ImageDescriptionJob] Processing image description job'
  );

  try {
    // Validate attachments
    for (const attachment of attachments) {
      if (!attachment.contentType.startsWith(CONTENT_TYPES.IMAGE_PREFIX)) {
        throw new Error(`Invalid attachment type: ${attachment.contentType}. Expected image.`);
      }
    }

    // Process all images in parallel with graceful degradation
    const results = await Promise.all(
      attachments.map(attachment => processSingleImage(attachment, personality, isGuestMode))
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
      '[ImageDescriptionJob] Image description completed'
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
    logger.error(
      { err: error, jobId: job.id, requestId },
      '[ImageDescriptionJob] Image description failed'
    );

    return {
      requestId,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      sourceReferenceNumber,
      metadata: { processingTimeMs, imageCount: attachments.length },
    };
  }
}
