/**
 * AI Routes
 * Handles requests for AI-powered personality responses
 */

import { Router } from 'express';
import type { RouteDeps } from '../routeDeps.js';
import { createGenerateRoute } from './generate.js';
import { createTranscribeRoute } from './transcribe.js';
import { createJobStatusRoute } from './jobStatus.js';
import { createConfirmDeliveryRoute } from './confirmDelivery.js';

/**
 * Create AI router. The required deps are aiQueue + queueEvents;
 * transcribe also needs prisma.
 */
export function createAIRouter(deps: RouteDeps): Router {
  const router = Router();
  const { prisma, aiQueue, queueEvents } = deps;

  // Hard-fail at startup: aiQueue + queueEvents are not optional for the AI
  // routes (no degraded mode makes sense — the BullMQ queue IS the routing
  // pipeline). Contrast with admin/cleanup, which graceful-degrades to 503
  // when retentionService is absent, and shapes, which logs and skips the
  // affected routes when aiQueue is absent.
  if (aiQueue === undefined || queueEvents === undefined) {
    throw new Error('createAIRouter requires aiQueue and queueEvents in RouteDeps');
  }

  // AI generation endpoint
  router.use('/generate', createGenerateRoute());

  // Audio transcription endpoint
  router.use('/transcribe', createTranscribeRoute(prisma, aiQueue, queueEvents));

  // Job status and delivery confirmation endpoints
  router.use('/', createJobStatusRoute(aiQueue));
  router.use('/', createConfirmDeliveryRoute(prisma));

  return router;
}
