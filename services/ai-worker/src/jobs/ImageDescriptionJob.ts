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
import { withRetry } from '../utils/retryService.js';
import type { ApiKeyResolver } from '../services/ApiKeyResolver.js';

const logger = createLogger('ImageDescriptionJob');

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
      {
        jobId: job.id,
        errors: validation.error.format(),
      },
      '[ImageDescriptionJob] Job validation failed'
    );
    throw new Error(`Image description job validation failed: ${validation.error.message}`);
  }

  const { requestId, attachments, personality, context, sourceReferenceNumber } = job.data;

  // Resolve guest mode status via BYOK lookup
  let isGuestMode = false;
  if (apiKeyResolver) {
    try {
      const keyResult = await apiKeyResolver.resolveApiKey(context.userId, AIProvider.OpenRouter);
      isGuestMode = keyResult.isGuestMode;
      logger.debug(
        { userId: context.userId, isGuestMode },
        '[ImageDescriptionJob] Resolved guest mode status'
      );
    } catch (error) {
      // If resolution fails, default to guest mode (use free vision model)
      isGuestMode = true;
      logger.warn(
        { err: error, userId: context.userId },
        '[ImageDescriptionJob] Failed to resolve API key, defaulting to guest mode'
      );
    }
  }

  logger.info(
    {
      jobId: job.id,
      requestId,
      imageCount: attachments.length,
      personalityName: personality.name,
    },
    '[ImageDescriptionJob] Processing image description job'
  );

  try {
    // Validate attachments
    for (const attachment of attachments) {
      if (!attachment.contentType.startsWith(CONTENT_TYPES.IMAGE_PREFIX)) {
        throw new Error(`Invalid attachment type: ${attachment.contentType}. Expected image.`);
      }
    }

    // Process all images in parallel with graceful degradation (partial failures allowed)
    const descriptionPromises = attachments.map(async attachment => {
      try {
        const result = await withRetry(() => describeImage(attachment, personality, isGuestMode), {
          maxAttempts: RETRY_CONFIG.MAX_ATTEMPTS,
          logger,
          operationName: `Image description (${attachment.name})`,
        });
        return {
          url: attachment.url,
          description: result.value,
          success: true as const,
        };
      } catch (error) {
        logger.warn(
          { url: attachment.url, err: error },
          'Image description failed after retries - continuing with other images'
        );
        return {
          url: attachment.url,
          error: error instanceof Error ? error.message : String(error),
          success: false as const,
        };
      }
    });

    const results = await Promise.all(descriptionPromises);

    // Filter for successful descriptions only
    const descriptions = results
      .filter((r): r is Extract<typeof r, { success: true }> => r.success)
      .map(r => ({ url: r.url, description: r.description }));

    const failedCount = results.length - descriptions.length;

    // If ALL images failed, return error with details
    if (descriptions.length === 0) {
      // Collect error details for debugging
      const failureDetails = results
        .filter((r): r is Extract<typeof r, { success: false }> => !r.success)
        .map(r => `${r.url}: ${r.error}`)
        .join('; ');

      logger.error(
        { requestId, totalImages: attachments.length, failureDetails },
        'All image descriptions failed'
      );

      return {
        requestId,
        success: false,
        error: `All images failed processing. Details: ${failureDetails}`,
        sourceReferenceNumber,
      };
    }

    // Log partial failure warning if some failed
    if (failedCount > 0) {
      logger.warn(
        { requestId, successCount: descriptions.length, failedCount },
        'Some images failed processing - proceeding with partial results'
      );
    }

    const processingTimeMs = Date.now() - startTime;

    logger.info(
      {
        jobId: job.id,
        requestId,
        processingTimeMs,
        imageCount: descriptions.length,
      },
      '[ImageDescriptionJob] Image description completed'
    );

    return {
      requestId,
      success: true,
      descriptions,
      sourceReferenceNumber,
      metadata: {
        processingTimeMs,
        imageCount: descriptions.length,
        failedCount,
      },
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
      metadata: {
        processingTimeMs,
        imageCount: attachments.length,
      },
    };
  }
}
