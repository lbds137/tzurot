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
    // Core fields
    id: z.string().optional(), // LoadedPersonality UUID
    name: z.string(),
    displayName: z.string().optional(),
    systemPrompt: z.string(),
    // LLM config
    model: z.string().optional(),
    temperature: z.number().optional(),
    maxTokens: z.number().optional(),
    topP: z.number().optional(),
    topK: z.number().optional(),
    frequencyPenalty: z.number().optional(),
    presencePenalty: z.number().optional(),
    // Memory config
    memoryEnabled: z.boolean().optional(),
    memoryScoreThreshold: z.number().optional(),
    memoryLimit: z.number().optional(),
    contextWindow: z.number().optional(),
    avatarUrl: z.string().optional(),
    // Character fields from LoadedPersonality
    characterInfo: z.string().optional(),
    personalityTraits: z.string().optional(),
    personalityTone: z.string().optional(),
    personalityAge: z.string().optional(),
    personalityLikes: z.string().optional(),
    personalityDislikes: z.string().optional(),
    conversationalGoals: z.string().optional(),
    conversationalExamples: z.string().optional()
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
      id: z.string().optional(), // Internal UUID for LTM deduplication
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string(),
      createdAt: z.string().optional()
    })).optional(),
    attachments: z.array(z.object({
      url: z.string(),
      contentType: z.string(),
      name: z.string().optional(),
      size: z.number().optional(),
      isVoiceMessage: z.boolean().optional(),
      duration: z.number().optional(),
      waveform: z.string().optional()
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
  let userId: string | undefined;
  let personalityName: string | undefined;

  try {
    // Validate request body
    const validationResult = generateRequestSchema.safeParse(req.body);

    if (!validationResult.success) {
      const errorResponse: ErrorResponse = {
        error: 'VALIDATION_ERROR',
        message: 'Invalid request body',
        timestamp: new Date().toISOString()
      };
      logger.warn(
        {
          errors: validationResult.error.issues,
          userId: req.body?.context?.userId,
          personalityName: req.body?.personality?.name
        },
        '[AI] Validation error'
      );
      res.status(400).json(errorResponse);
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

    logger.error(
      {
        err: error,
        userId,
        personalityName,
        processingTimeMs: processingTime
      },
      `[AI] Error creating job (${processingTime}ms)`
    );

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
  const { jobId } = req.params;

  try {
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
    logger.error(
      {
        err: error,
        jobId
      },
      '[AI] Error fetching job status'
    );

    const errorResponse: ErrorResponse = {
      error: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    };

    res.status(500).json(errorResponse);
  }
});
