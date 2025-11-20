/**
 * AI Generation Routes
 *
 * Handles requests for AI-powered personality responses.
 */

import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import type { Queue, QueueEvents } from 'bullmq';
import {
  createLogger,
  TIMEOUTS,
  generateRequestSchema,
  JobStatus,
  JobType,
  JOB_PREFIXES,
} from '@tzurot/common-types';
import type { PrismaClient } from '@prisma/client';
import { deduplicationCache } from '../utils/deduplicationCache.js';
import { createJobChain } from '../utils/jobChainOrchestrator.js';
import type { GenerateResponse } from '../types.js';
import { ErrorResponses } from '../utils/errorResponses.js';
import type { AttachmentStorageService } from '../services/AttachmentStorageService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendError, sendSuccess, sendCustomSuccess } from '../utils/responseHelpers.js';

const logger = createLogger('AIRouter');

/**
 * Create AI router with injected dependencies
 * @param prisma - Prisma client for database operations
 * @param aiQueue - BullMQ queue for AI job processing
 * @param queueEvents - BullMQ queue events for job completion waiting
 * @param attachmentStorage - Service for downloading and storing attachments
 */
export function createAIRouter(
  prisma: PrismaClient,
  aiQueue: Queue,
  queueEvents: QueueEvents,
  attachmentStorage: AttachmentStorageService
): Router {
  const router: Router = Router();

  /**
   * POST /ai/generate
   *
   * Create an AI generation job and return 202 Accepted immediately.
   * Results are delivered asynchronously via Redis Stream to bot-client.
   *
   * Handles request deduplication - identical requests within 5s return the same job.
   */
  router.post(
    '/generate',
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
      const duplicate = deduplicationCache.checkDuplicate(request);
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
          },
          responseDestination: {
            type: 'api' as const,
            // TODO: Add callback URL support
          },
          userApiKey: request.userApiKey,
        });

        // Cache request to prevent duplicates
        deduplicationCache.cacheRequest(request, requestId, jobId);

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

  /**
   * POST /ai/transcribe
   *
   * Transcribe audio attachments using Whisper.
   * Creates an AudioTranscriptionJob for each audio attachment.
   *
   * Query parameters:
   * - wait=true: Wait for job completion using Redis pub/sub (no polling)
   * - wait=false (default): Return job ID immediately
   */
  router.post(
    '/transcribe',
    asyncHandler(async (req: Request, res: Response) => {
      const startTime = Date.now();
      const waitForCompletion = req.query.wait === 'true';

      const body = req.body as {
        attachments?: {
          url: string;
          contentType: string;
          name?: string;
          size?: number;
        }[];
      };

      // Validate request has attachments
      if (
        body.attachments === undefined ||
        !Array.isArray(body.attachments) ||
        body.attachments.length === 0
      ) {
        return sendError(
          res,
          ErrorResponses.validationError('Missing or invalid attachments array')
        );
      }

      const requestId = randomUUID();

      // Download attachments to local storage
      const localAttachments = await attachmentStorage.downloadAndStore(
        requestId,
        body.attachments
      );

      // Use first audio attachment (transcribe endpoint expects single audio file)
      const audioAttachment = localAttachments[0];

      // Create audio transcription job using new job type
      const jobData = {
        requestId,
        jobType: JobType.AudioTranscription,
        attachment: audioAttachment,
        context: {
          userId: 'system',
          channelId: 'api',
        },
        responseDestination: {
          type: 'api' as const,
        },
      };

      const job = await aiQueue.add(JobType.AudioTranscription, jobData, {
        jobId: `${JOB_PREFIXES.AUDIO_TRANSCRIPTION}${requestId}`,
      });

      logger.info(`[AI] Created transcribe job ${job.id} (${Date.now() - startTime}ms)`);

      // If client wants to wait, use Redis pub/sub
      if (waitForCompletion) {
        try {
          const result: { transcription: string } = (await job.waitUntilFinished(
            queueEvents,
            TIMEOUTS.JOB_WAIT
          )) as { transcription: string };

          logger.info(`[AI] Transcribe job ${job.id} completed after ${Date.now() - startTime}ms`);

          return sendCustomSuccess(res, {
            jobId: job.id ?? requestId,
            requestId,
            status: JobStatus.Completed,
            result,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          logger.error({ err: error, jobId: job.id }, `[AI] Transcribe job ${job.id} failed`);

          return sendError(
            res,
            ErrorResponses.jobFailed(
              error instanceof Error ? error.message : 'Transcription failed or timed out'
            )
          );
        }
      }

      // Default: return job ID immediately
      sendCustomSuccess(res, {
        jobId: job.id ?? requestId,
        requestId,
        status: JobStatus.Queued,
      });
    })
  );

  /**
   * GET /ai/job/:jobId
   *
   * Get the status of a specific job.
   */
  router.get(
    '/job/:jobId',
    asyncHandler(async (req: Request, res: Response) => {
      const { jobId } = req.params;

      const job = await aiQueue.getJob(jobId);

      if (job === undefined) {
        return sendError(res, ErrorResponses.jobNotFound(jobId));
      }

      const state = await job.getState();
      const progress: number | object = job.progress as number | object;
      const returnvalue: unknown = job.returnvalue;

      sendCustomSuccess(res, {
        jobId: job.id,
        status: state,
        progress,
        result: returnvalue,
        timestamp: new Date().toISOString(),
      });
    })
  );

  /**
   * POST /ai/job/:jobId/confirm-delivery
   *
   * Confirm that a job result has been successfully delivered to Discord.
   * Updates the job_results table status from PENDING_DELIVERY to DELIVERED.
   */
  router.post(
    '/job/:jobId/confirm-delivery',
    asyncHandler(async (req: Request, res: Response) => {
      const { jobId } = req.params;

      // Update job result status to DELIVERED
      const updated = await prisma.jobResult.updateMany({
        where: {
          jobId,
          status: 'PENDING_DELIVERY', // Only update if still pending
        },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
        },
      });

      if (updated.count === 0) {
        // Either job doesn't exist or already delivered
        const existing = await prisma.jobResult.findUnique({
          where: { jobId },
          select: { status: true },
        });

        if (!existing) {
          return sendError(res, ErrorResponses.jobNotFound(jobId));
        }

        // Already delivered - this is fine (idempotent)
        logger.debug({ jobId, status: existing.status }, '[AI] Job already delivered');
        return sendCustomSuccess(res, {
          jobId,
          status: existing.status,
          message: 'Already confirmed',
        });
      }

      logger.info({ jobId }, '[AI] Job delivery confirmed');

      sendCustomSuccess(res, {
        jobId,
        status: 'DELIVERED',
        message: 'Delivery confirmed',
      });
    })
  );

  return router;
}
