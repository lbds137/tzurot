/**
 * POST /ai/generate
 * Create an AI generation job and return 202 Accepted immediately
 */

import { type Request, type Response, type RequestHandler } from 'express';
import { randomUUID } from 'crypto';
import { JobStatus } from '@tzurot/common-types/constants/queue';
import { generateRequestSchema } from '@tzurot/common-types/types/schemas/generation';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getDeduplicationCache } from '../../utils/deduplicationCache.js';
import { createJobChain } from '../../utils/jobChainOrchestrator.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { sendZodError } from '../../utils/zodHelpers.js';

const logger = createLogger('AIRouter');

import type { RouteDeps } from '../routeDeps.js';

/**
 * POST /api/internal/ai/generate — create an AI generation job.
 *
 * Reads `deps.llmConfigResolver` to resolve the effective LLM config once at
 * job-chain build time (see `createJobChain`), so the conversation job and the
 * image-description child job share the same user-cascaded model rather than the
 * personality seed. The resolver is optional: when absent (tests, or wiring not
 * present), `createJobChain` falls back to the seed personality unchanged. The
 * deduplication cache and BullMQ job queue remain module-load singletons
 * accessed via getters.
 */
export const handleAiGenerate = (deps: RouteDeps): RequestHandler =>
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
        llmConfigResolver: deps.llmConfigResolver,
        visionConfigResolver: deps.visionConfigResolver,
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
  });
