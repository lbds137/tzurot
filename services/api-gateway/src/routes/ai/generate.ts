/**
 * POST /ai/generate
 * Create an AI generation job and return 202 Accepted immediately
 */

import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import { createLogger, generateRequestSchema, JobStatus } from '@tzurot/common-types';
import { getDeduplicationCache } from '../../utils/deduplicationCache.js';
import { createJobChain } from '../../utils/jobChainOrchestrator.js';
import type { GenerateResponse } from '../../types.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import type { AttachmentStorageService } from '../../services/AttachmentStorageService.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendSuccess, sendCustomSuccess } from '../../utils/responseHelpers.js';

const logger = createLogger('AIRouter');

export function createGenerateRoute(attachmentStorage: AttachmentStorageService): Router {
  const router = Router();

  /**
   * POST /generate
   *
   * Create an AI generation job and return 202 Accepted immediately.
   * Results are delivered asynchronously via Redis Stream to bot-client.
   *
   * Handles request deduplication - identical requests within 5s return the same job.
   */
  router.post(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const startTime = Date.now();

      // Validate request body
      const validationResult = generateRequestSchema.safeParse(req.body);

      if (!validationResult.success) {
        const body = req.body as {
          context?: { userId?: string };
          personality?: { name?: string };
        };
        logger.warn(
          {
            errors: validationResult.error.issues,
            userId: body?.context?.userId,
            personalityName: body?.personality?.name,
          },
          '[AI] Validation error'
        );
        return sendError(res, ErrorResponses.validationError('Invalid request body'));
      }

      const request = validationResult.data;
      const userId = request.context.userId;
      const personalityName = request.personality.name;

      // Check for duplicate requests
      const deduplicationCache = getDeduplicationCache();
      const duplicate = await deduplicationCache.checkDuplicate(request);
      if (duplicate !== null) {
        const response: GenerateResponse = {
          jobId: duplicate.jobId,
          requestId: duplicate.requestId,
          status: JobStatus.Queued,
        };

        logger.info(`[AI] Returning cached job ${duplicate.jobId} for duplicate request`);

        return sendSuccess(res, response);
      }

      // Generate unique request ID
      const requestId = randomUUID();

      // Download Discord CDN attachments to local storage
      // This prevents CDN expiration issues and unreliable external fetches
      let localAttachments = request.context.attachments;
      if (localAttachments && localAttachments.length > 0) {
        logger.info(
          { requestId, count: localAttachments.length },
          '[AI] Downloading attachments to local storage'
        );
        localAttachments = await attachmentStorage.downloadAndStore(requestId, localAttachments);
      }

      // Also download extended context attachments (images from recent channel messages)
      let localExtendedContextAttachments = request.context.extendedContextAttachments;
      if (localExtendedContextAttachments && localExtendedContextAttachments.length > 0) {
        logger.info(
          { requestId, count: localExtendedContextAttachments.length },
          '[AI] Downloading extended context attachments to local storage'
        );
        localExtendedContextAttachments = await attachmentStorage.downloadAndStore(
          requestId,
          localExtendedContextAttachments
        );
      }

      // Debug: Log referenced messages if present
      if (request.context.referencedMessages && request.context.referencedMessages.length > 0) {
        logger.info(
          {
            requestId,
            referencedMessagesCount: request.context.referencedMessages.length,
          },
          `[AI] Request includes ${request.context.referencedMessages.length} referenced message(s)`
        );
      }

      try {
        // Create job chain (preprocessing jobs + LLM generation job)
        const jobId = await createJobChain({
          requestId,
          personality: request.personality,
          message: request.message,
          context: {
            ...request.context,
            attachments: localAttachments, // Use local URLs instead of Discord CDN
            extendedContextAttachments: localExtendedContextAttachments, // Use local URLs
          },
          responseDestination: {
            type: 'api' as const,
          },
          userApiKey: request.userApiKey,
        });

        // Cache request to prevent duplicates
        await deduplicationCache.cacheRequest(request, requestId, jobId);

        const creationTime = Date.now() - startTime;

        logger.info(
          `[AI] Created job chain with main job ${jobId} for ${request.personality.name} (${creationTime}ms)`
        );

        // Return 202 Accepted with job ID (async pattern)
        // Results will be delivered via Redis Stream to bot-client
        const response: GenerateResponse = {
          jobId,
          requestId,
          status: JobStatus.Queued,
        };

        sendCustomSuccess(res, response, 202);
      } catch (error) {
        const processingTime = Date.now() - startTime;

        logger.error(
          {
            err: error,
            userId,
            personalityName,
            processingTimeMs: processingTime,
          },
          `[AI] Error creating job (${processingTime}ms)`
        );
        throw error; // Let asyncHandler handle it
      }
    })
  );

  return router;
}
