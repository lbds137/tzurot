/**
 * AI Generation Routes
 *
 * Handles requests for AI-powered personality responses.
 */

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { createLogger } from '@tzurot/common-types';
import { z } from 'zod';
import { aiQueue } from '../queue.js';
import {
  checkDuplicate,
  cacheRequest
} from '../utils/requestDeduplication.js';
import type {
  GenerateRequest,
  GenerateResponse,
  ErrorResponse
} from '../types.js';

const logger = createLogger('AIRouter');

export const aiRouter: Router = Router();

// Validation schema for generate request
const generateRequestSchema = z.object({
  personality: z.object({
    name: z.string(),
    displayName: z.string().optional(),
    systemPrompt: z.string(),
    model: z.string().optional(),
    temperature: z.number().optional(),
    maxTokens: z.number().optional(),
    memoryEnabled: z.boolean().optional(),
    contextWindow: z.number().optional(),
    avatarUrl: z.string().optional()
  }),
  message: z.union([z.string(), z.object({}).passthrough()]),
  context: z.object({
    userId: z.string(),
    userName: z.string().optional(),
    channelId: z.string().optional(),
    serverId: z.string().optional(),
    sessionId: z.string().optional(),
    isProxyMessage: z.boolean().optional(),
    conversationHistory: z.array(z.object({
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string()
    })).optional()
  }),
  userApiKey: z.string().optional()
});

/**
 * POST /ai/generate
 *
 * Create an AI generation job and return the job ID.
 * Handles request deduplication - identical requests within 5s return the same job.
 */
aiRouter.post('/generate', async (req, res) => {
  const startTime = Date.now();

  try {
    // Validate request body
    const validationResult = generateRequestSchema.safeParse(req.body);

    if (!validationResult.success) {
      const errorResponse: ErrorResponse = {
        error: 'VALIDATION_ERROR',
        message: 'Invalid request body',
        timestamp: new Date().toISOString()
      };
      logger.warn('[AI] Validation error:', validationResult.error.errors);
      res.status(400).json(errorResponse);
      return;
    }

    const request = validationResult.data as GenerateRequest;

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

    // Create job data
    const jobData = {
      requestId,
      jobType: 'generate' as const,
      personality: request.personality,
      message: request.message,
      context: request.context,
      userApiKey: request.userApiKey,
      responseDestination: {
        type: 'api' as const,
        // TODO: Add callback URL support
      }
    };

    // Add job to queue
    const job = await aiQueue.add('generate', jobData, {
      jobId: `req-${requestId}` // Use predictable job ID for tracking
    });

    // Cache request to prevent duplicates
    cacheRequest(request, requestId, job.id ?? requestId);

    const processingTime = Date.now() - startTime;

    logger.info(
      `[AI] Created job ${job.id} for ${request.personality.name} (${processingTime}ms)`
    );

    // Return job info
    const response: GenerateResponse = {
      jobId: job.id ?? requestId,
      requestId,
      status: 'queued'
    };

    res.json(response);

  } catch (error) {
    const processingTime = Date.now() - startTime;

    logger.error(`[AI] Error creating job (${processingTime}ms):`, error);

    const errorResponse: ErrorResponse = {
      error: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    };

    res.status(500).json(errorResponse);
  }
});

/**
 * GET /ai/job/:jobId
 *
 * Get the status of a specific job.
 */
aiRouter.get('/job/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await aiQueue.getJob(jobId);

    if (job === undefined) {
      const errorResponse: ErrorResponse = {
        error: 'JOB_NOT_FOUND',
        message: `Job ${jobId} not found`,
        timestamp: new Date().toISOString()
      };
      res.status(404).json(errorResponse);
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
    logger.error('[AI] Error fetching job status:', error);

    const errorResponse: ErrorResponse = {
      error: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    };

    res.status(500).json(errorResponse);
  }
});
