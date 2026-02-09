/**
 * POST /ai/generate
 * Create an AI generation job and return 202 Accepted immediately
 */

import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import {
  createLogger,
  generateRequestSchema,
  JobStatus,
  type AttachmentMetadata,
} from '@tzurot/common-types';
import { getDeduplicationCache } from '../../utils/deduplicationCache.js';
import { createJobChain } from '../../utils/jobChainOrchestrator.js';
import type { GenerateResponse } from '../../types.js';
import type { AttachmentStorageService } from '../../services/AttachmentStorageService.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { sendZodError } from '../../utils/zodHelpers.js';

const logger = createLogger('AIRouter');

/**
 * Download attachments to local storage if present
 */
async function downloadAttachmentsIfPresent(
  attachmentStorage: AttachmentStorageService,
  requestId: string,
  attachments: AttachmentMetadata[] | undefined,
  logLabel: string
): Promise<AttachmentMetadata[] | undefined> {
  if (!attachments || attachments.length === 0) {
    return attachments;
  }
  logger.info(
    { requestId, count: attachments.length },
    `[AI] Downloading ${logLabel} to local storage`
  );
  return attachmentStorage.downloadAndStore(requestId, attachments);
}

export function createGenerateRoute(attachmentStorage: AttachmentStorageService): Router {
  const router = Router();

  router.post(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const startTime = Date.now();

      // Validate request body
      const validationResult = generateRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        logger.warn({ errors: validationResult.error.issues }, '[AI] Validation error');
        return sendZodError(res, validationResult.error);
      }

      const request = validationResult.data;

      // Check for duplicate requests
      const deduplicationCache = getDeduplicationCache();
      const duplicate = await deduplicationCache.checkDuplicate(request);
      if (duplicate !== null) {
        logger.info(`[AI] Returning cached job ${duplicate.jobId} for duplicate request`);
        return sendSuccess(res, {
          jobId: duplicate.jobId,
          requestId: duplicate.requestId,
          status: JobStatus.Queued,
        } as GenerateResponse);
      }

      const requestId = randomUUID();

      // Download attachments to local storage (prevents CDN expiration issues)
      const localAttachments = await downloadAttachmentsIfPresent(
        attachmentStorage,
        requestId,
        request.context.attachments,
        'attachments'
      );
      const localExtendedContextAttachments = await downloadAttachmentsIfPresent(
        attachmentStorage,
        requestId,
        request.context.extendedContextAttachments,
        'extended context attachments'
      );

      if (request.context.referencedMessages && request.context.referencedMessages.length > 0) {
        logger.info(
          { requestId, referencedMessagesCount: request.context.referencedMessages.length },
          `[AI] Request includes ${request.context.referencedMessages.length} referenced message(s)`
        );
      }

      try {
        const jobId = await createJobChain({
          requestId,
          personality: request.personality,
          message: request.message,
          context: {
            ...request.context,
            attachments: localAttachments,
            extendedContextAttachments: localExtendedContextAttachments,
          },
          responseDestination: { type: 'api' as const },
          userApiKey: request.userApiKey,
        });

        await deduplicationCache.cacheRequest(request, requestId, jobId);
        const creationTime = Date.now() - startTime;
        logger.info(
          `[AI] Created job chain with main job ${jobId} for ${request.personality.name} (${creationTime}ms)`
        );

        sendCustomSuccess(
          res,
          { jobId, requestId, status: JobStatus.Queued } as GenerateResponse,
          202
        );
      } catch (error) {
        const processingTime = Date.now() - startTime;
        logger.error(
          {
            err: error,
            userId: request.context.userId,
            personalityName: request.personality.name,
            processingTimeMs: processingTime,
          },
          `[AI] Error creating job (${processingTime}ms)`
        );
        throw error;
      }
    })
  );

  return router;
}
