/**
 * AI Generation Routes
 *
 * Handles requests for AI-powered personality responses.
 */

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { createLogger, TIMEOUTS, generateRequestSchema } from '@tzurot/common-types';
import { aiQueue, queueEvents } from '../queue.js';
import {
  checkDuplicate,
  cacheRequest
} from '../utils/requestDeduplication.js';
import { downloadAndStoreAttachments } from '../utils/tempAttachmentStorage.js';
import type {
  GenerateRequest,
  GenerateResponse
} from '../types.js';
import { ErrorResponses, getStatusCode } from '../utils/errorResponses.js';

const logger = createLogger('AIRouter');

export const aiRouter: Router = Router();

/**
 * POST /ai/generate
 *
 * Create an AI generation job and optionally wait for completion.
 *
 * Query parameters:
 * - wait=true: Wait for job completion using Redis pub/sub (no polling)
 * - wait=false (default): Return job ID immediately
 *
 * Handles request deduplication - identical requests within 5s return the same job.
 */
aiRouter.post('/generate', async (req, res) => {
  const startTime = Date.now();
  let userId: string | undefined;
  let personalityName: string | undefined;

  // Check if client wants to wait for completion
  const waitForCompletion = req.query.wait === 'true';

  try {
    // Validate request body
    const validationResult = generateRequestSchema.safeParse(req.body);

    if (!validationResult.success) {
      const errorResponse = ErrorResponses.validationError('Invalid request body');
      logger.warn(
        {
          errors: validationResult.error.issues,
          userId: req.body?.context?.userId,
          personalityName: req.body?.personality?.name
        },
        '[AI] Validation error'
      );
      res.status(getStatusCode(errorResponse.error)).json(errorResponse);
      return;
    }

    const request = validationResult.data as GenerateRequest;

    // Capture context for error logging
    userId = request.context.userId;
    personalityName = request.personality.name;

    // Check for duplicate requests
    const duplicate = checkDuplicate(request);
    if (duplicate !== null) {
      const response: GenerateResponse = {
        jobId: duplicate.jobId,
        requestId: duplicate.requestId,
        status: 'queued'
      };

      logger.info(
        `[AI] Returning cached job ${duplicate.jobId} for duplicate request`
      );

      res.json(response);
      return;
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
      localAttachments = await downloadAndStoreAttachments(requestId, localAttachments);
    }

    // Create job data with local attachment URLs
    const jobData = {
      requestId,
      jobType: 'generate' as const,
      personality: request.personality,
      message: request.message,
      context: {
        ...request.context,
        attachments: localAttachments // Use local URLs instead of Discord CDN
      },
      userApiKey: request.userApiKey,
      responseDestination: {
        type: 'api' as const,
        // TODO: Add callback URL support
      }
    };

    // Debug: Log referenced messages if present
    if (request.context.referencedMessages && request.context.referencedMessages.length > 0) {
      logger.info({
        requestId,
        referencedMessagesCount: request.context.referencedMessages.length
      }, `[AI] Request includes ${request.context.referencedMessages.length} referenced message(s)`);
    }

    // Add job to queue
    const job = await aiQueue.add('generate', jobData, {
      jobId: `req-${requestId}` // Use predictable job ID for tracking
    });

    // Cache request to prevent duplicates
    cacheRequest(request, requestId, job.id ?? requestId);

    const creationTime = Date.now() - startTime;

    logger.info(
      `[AI] Created job ${job.id} for ${request.personality.name} (${creationTime}ms)`
    );

    // If client wants to wait, use Redis pub/sub to wait for completion
    if (waitForCompletion) {
      try {
        // Calculate timeout based on attachments (images take longer)
        const imageCount = request.context.attachments?.filter(
          att => att.contentType.startsWith('image/') && !att.isVoiceMessage
        ).length ?? 0;

        // Base timeout: 2 minutes, scale by image count
        // Cap at 4.5 minutes - allows 3 retry passes + 30s buffer under Railway's 5-minute limit
        const timeoutMs = Math.min(TIMEOUTS.JOB_WAIT, TIMEOUTS.JOB_BASE * Math.max(1, imageCount));

        logger.debug(
          `[AI] Waiting for job ${job.id} completion (timeout: ${timeoutMs}ms, images: ${imageCount})`
        );

        // Wait for job completion via Redis pub/sub (no HTTP polling!)
        const result = await job.waitUntilFinished(queueEvents, timeoutMs);

        const totalTime = Date.now() - startTime;

        logger.info(
          `[AI] Job ${job.id} completed after ${totalTime}ms`
        );

        // Note: Cleanup happens via queue event listener, not here
        // This ensures ai-worker has finished fetching all attachments

        // Return result directly
        res.json({
          jobId: job.id ?? requestId,
          requestId,
          status: 'completed',
          result,
          timestamp: new Date().toISOString()
        });
        return;

      } catch (error) {
        const totalTime = Date.now() - startTime;

        logger.error(
          {
            err: error,
            jobId: job.id,
            userId,
            personalityName,
            totalTimeMs: totalTime
          },
          `[AI] Job ${job.id} failed or timed out after ${totalTime}ms`
        );

        // Note: Cleanup happens via queue event listener, not here

        const errorResponse = ErrorResponses.jobFailed(
          error instanceof Error ? error.message : 'Job failed or timed out'
        );

        res.status(getStatusCode(errorResponse.error)).json(errorResponse);
        return;
      }
    }

    // Default behavior: return job ID immediately (backward compatible)
    const response: GenerateResponse = {
      jobId: job.id ?? requestId,
      requestId,
      status: 'queued'
    };

    res.json(response);

  } catch (error) {
    const processingTime = Date.now() - startTime;

    logger.error(
      {
        err: error,
        userId,
        personalityName,
        processingTimeMs: processingTime
      },
      `[AI] Error creating job (${processingTime}ms)`
    );

    const errorResponse = ErrorResponses.internalError(
      error instanceof Error ? error.message : 'Unknown error'
    );

    res.status(getStatusCode(errorResponse.error)).json(errorResponse);
  }
});

/**
 * POST /ai/transcribe
 *
 * Transcribe audio attachments using Whisper.
 *
 * Query parameters:
 * - wait=true: Wait for job completion using Redis pub/sub (no polling)
 * - wait=false (default): Return job ID immediately
 */
aiRouter.post('/transcribe', async (req, res) => {
  const startTime = Date.now();
  const waitForCompletion = req.query.wait === 'true';

  try {
    // Validate request has attachments
    if (!req.body.attachments || !Array.isArray(req.body.attachments) || req.body.attachments.length === 0) {
      const errorResponse = ErrorResponses.validationError('Missing or invalid attachments array');
      res.status(getStatusCode(errorResponse.error)).json(errorResponse);
      return;
    }

    const requestId = randomUUID();

    // Download attachments to local storage
    const localAttachments = await downloadAndStoreAttachments(requestId, req.body.attachments);

    // Create transcribe job
    const jobData = {
      requestId,
      jobType: 'transcribe' as const,
      personality: {}, // Not used for transcription
      message: '',
      context: {
        userId: 'system',
        attachments: localAttachments
      },
      responseDestination: {
        type: 'api' as const
      }
    };

    const job = await aiQueue.add('transcribe', jobData, {
      jobId: `transcribe-${requestId}`
    });

    logger.info(`[AI] Created transcribe job ${job.id} (${Date.now() - startTime}ms)`);

    // If client wants to wait, use Redis pub/sub
    if (waitForCompletion) {
      try {
        const result = await job.waitUntilFinished(queueEvents, TIMEOUTS.JOB_WAIT);

        logger.info(`[AI] Transcribe job ${job.id} completed after ${Date.now() - startTime}ms`);

        res.json({
          jobId: job.id ?? requestId,
          requestId,
          status: 'completed',
          result,
          timestamp: new Date().toISOString()
        });
        return;

      } catch (error) {
        logger.error({ err: error, jobId: job.id }, `[AI] Transcribe job ${job.id} failed`);

        const errorResponse = ErrorResponses.jobFailed(
          error instanceof Error ? error.message : 'Transcription failed or timed out'
        );

        res.status(getStatusCode(errorResponse.error)).json(errorResponse);
        return;
      }
    }

    // Default: return job ID immediately
    res.json({
      jobId: job.id ?? requestId,
      requestId,
      status: 'queued'
    });

  } catch (error) {
    logger.error({ err: error }, '[AI] Error creating transcribe job');

    const errorResponse = ErrorResponses.internalError(
      error instanceof Error ? error.message : 'Unknown error'
    );

    res.status(getStatusCode(errorResponse.error)).json(errorResponse);
  }
});

/**
 * GET /ai/job/:jobId
 *
 * Get the status of a specific job.
 */
aiRouter.get('/job/:jobId', async (req, res) => {
  const { jobId } = req.params;

  try {
    const job = await aiQueue.getJob(jobId);

    if (job === undefined) {
      const errorResponse = ErrorResponses.jobNotFound(jobId);
      res.status(getStatusCode(errorResponse.error)).json(errorResponse);
      return;
    }

    const state = await job.getState();
    const progress = job.progress;
    const returnvalue = job.returnvalue;

    res.json({
      jobId: job.id,
      status: state,
      progress,
      result: returnvalue,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error(
      {
        err: error,
        jobId
      },
      '[AI] Error fetching job status'
    );

    const errorResponse = ErrorResponses.internalError(
      error instanceof Error ? error.message : 'Unknown error'
    );

    res.status(getStatusCode(errorResponse.error)).json(errorResponse);
  }
});
