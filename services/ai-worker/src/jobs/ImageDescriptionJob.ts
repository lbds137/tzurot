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
  type ImageDescriptionJobData,
  type ImageDescriptionResult,
} from '@tzurot/common-types';
import { describeImage } from '../services/MultimodalProcessor.js';
import { withRetry } from '../utils/retryService.js';

const logger = createLogger('ImageDescriptionJob');

/**
 * Process image description job
 */
export async function processImageDescriptionJob(
  job: Job<ImageDescriptionJobData>
): Promise<ImageDescriptionResult> {
  const startTime = Date.now();
  const { requestId, attachments, personality } = job.data;

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
        const result = await withRetry(() => describeImage(attachment, personality), {
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
      metadata: {
        processingTimeMs,
        imageCount: attachments.length,
      },
    };
  }
}
