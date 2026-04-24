/**
 * POST /ai/generate
 * Create an AI generation job and return 202 Accepted immediately
 */

import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import { createLogger, generateRequestSchema, JobStatus } from '@tzurot/common-types';
import { getDeduplicationCache } from '../../utils/deduplicationCache.js';
import { createJobChain } from '../../utils/jobChainOrchestrator.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { sendZodError } from '../../utils/zodHelpers.js';

const logger = createLogger('AIRouter');

export function createGenerateRoute(): Router {
  const router = Router();

  router.post(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const startTime = Date.now();

      // Validate request body
      const validationResult = generateRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        logger.warn({ errors: validationResult.error.issues }, 'Validation error');
        return sendZodError(res, validationResult.error);
      }

      const request = validationResult.data;

      // Check for duplicate requests
      const deduplicationCache = getDeduplicationCache();
      const duplicate = await deduplicationCache.checkDuplicate(request);
      if (duplicate !== null) {
        logger.info({ jobId: duplicate.jobId }, 'Returning cached job for duplicate request');
        return sendSuccess(res, {
          jobId: duplicate.jobId,
          requestId: duplicate.requestId,
          status: JobStatus.Queued,
        });
      }

      const requestId = randomUUID();

      if (request.context.referencedMessages && request.context.referencedMessages.length > 0) {
        logger.info(
          { requestId, referencedMessagesCount: request.context.referencedMessages.length },
          `Request includes ${request.context.referencedMessages.length} referenced message(s)`
        );
      }

      try {
        // Attachment URLs flow through unchanged. Bytes are downloaded inside
        // ai-worker's DownloadAttachmentsStep so this handler never blocks on
        // network I/O regardless of attachment size or count.
        const jobId = await createJobChain({
          requestId,
          personality: request.personality,
          message: request.message,
          context: request.context,
          responseDestination: { type: 'api' as const },
          userApiKey: request.userApiKey,
        });

        await deduplicationCache.cacheRequest(request, requestId, jobId);
        const creationTime = Date.now() - startTime;
        logger.info(
          { jobId, personalityName: request.personality.name, creationTimeMs: creationTime },
          'Created job chain'
        );

        sendCustomSuccess(res, { jobId, requestId, status: JobStatus.Queued }, 202);
      } catch (error) {
        const processingTime = Date.now() - startTime;
        logger.error(
          {
            err: error,
            userId: request.context.userId,
            personalityName: request.personality.name,
            processingTimeMs: processingTime,
          },
          `Error creating job (${processingTime}ms)`
        );
        throw error;
      }
    })
  );

  return router;
}
