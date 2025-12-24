/**
 * POST /ai/transcribe
 * Transcribe audio attachments using Whisper
 */

import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import type { Queue, QueueEvents } from 'bullmq';
import {
  createLogger,
  TIMEOUTS,
  JobStatus,
  JobType,
  JOB_PREFIXES,
  type AudioTranscriptionResult,
} from '@tzurot/common-types';
import { ErrorResponses } from '../../utils/errorResponses.js';
import type { AttachmentStorageService } from '../../services/AttachmentStorageService.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { addValidatedJob } from '../../utils/validatedQueue.js';

const logger = createLogger('AIRouter');

export function createTranscribeRoute(
  aiQueue: Queue,
  queueEvents: QueueEvents,
  attachmentStorage: AttachmentStorageService
): Router {
  const router = Router();

  /**
   * POST /transcribe
   *
   * Transcribe audio attachments using Whisper.
   * Creates an AudioTranscriptionJob for each audio attachment.
   *
   * Query parameters:
   * - wait=true: Wait for job completion using Redis pub/sub (no polling)
   * - wait=false (default): Return job ID immediately
   */
  router.post(
    '/',
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

      // Add job to queue with automatic validation
      // Throws error if validation fails (caught by asyncHandler)
      const job = await addValidatedJob(aiQueue, JobType.AudioTranscription, jobData, {
        jobId: `${JOB_PREFIXES.AUDIO_TRANSCRIPTION}${requestId}`,
      });

      logger.info(`[AI] Created transcribe job ${job.id} (${Date.now() - startTime}ms)`);

      // If client wants to wait, use Redis pub/sub
      if (waitForCompletion) {
        try {
          const result = (await job.waitUntilFinished(
            queueEvents,
            TIMEOUTS.JOB_WAIT
          )) as AudioTranscriptionResult;

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

  return router;
}
