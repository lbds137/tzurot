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
        throw new Error(
          `Invalid attachment type: ${attachment.contentType}. Expected image.`
        );
      }
    }

    // Process all images in parallel with retry logic (3 attempts each)
    const descriptionPromises = attachments.map(async attachment => {
      const result = await withRetry(
        () => describeImage(attachment, personality),
        {
          maxAttempts: RETRY_CONFIG.MAX_ATTEMPTS,
          logger,
          operationName: `Image description (${attachment.name})`,
        }
      );
      return {
        url: attachment.url,
        description: result.value,
      };
    });

    const descriptions = await Promise.all(descriptionPromises);

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
