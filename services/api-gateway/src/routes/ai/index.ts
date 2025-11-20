/**
 * AI Routes
 * Handles requests for AI-powered personality responses
 */

import { Router } from 'express';
import type { Queue, QueueEvents } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import type { AttachmentStorageService } from '../../services/AttachmentStorageService.js';
import { createGenerateRoute } from './generate.js';
import { createTranscribeRoute } from './transcribe.js';
import { createJobStatusRoute } from './jobStatus.js';
import { createConfirmDeliveryRoute } from './confirmDelivery.js';

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
  const router = Router();

  // AI generation endpoint
  router.use('/generate', createGenerateRoute(attachmentStorage));

  // Audio transcription endpoint
  router.use('/transcribe', createTranscribeRoute(aiQueue, queueEvents, attachmentStorage));

  // Job status and delivery confirmation endpoints
  router.use('/', createJobStatusRoute(aiQueue));
  router.use('/', createConfirmDeliveryRoute(prisma));

  return router;
}
