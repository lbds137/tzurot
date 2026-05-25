/**
 * AI Routes
 * Handles requests for AI-powered personality responses
 */

import { Router } from 'express';
import type { RouteDeps } from '../routeDeps.js';
import { handleAiGenerate } from './generate.js';
import { handleAiTranscribe } from './transcribe.js';
import { handleAiJobStatus } from './jobStatus.js';
import { handleAiConfirmDelivery } from './confirmDelivery.js';

/**
 * Create AI router. The required deps are aiQueue + queueEvents;
 * transcribe also needs prisma. We call the handle* factories directly
 * (no legacy `createGenerateRoute()` etc. wrappers) so we don't end up
 * synthesizing `undefined as never` placeholders to satisfy them.
 */
export function createAIRouter(deps: RouteDeps): Router {
  const router = Router();
  const { aiQueue, queueEvents } = deps;

  // Hard-fail at startup: aiQueue + queueEvents are not optional for the AI
  // routes (no degraded mode makes sense — the BullMQ queue IS the routing
  // pipeline). Contrast with admin/cleanup, which graceful-degrades to 503
  // when retentionService is absent, and shapes, which logs and skips the
  // affected routes when aiQueue is absent.
  if (aiQueue === undefined || queueEvents === undefined) {
    throw new Error('createAIRouter requires aiQueue and queueEvents in RouteDeps');
  }

  router.post('/generate', handleAiGenerate(deps));
  router.post('/transcribe', handleAiTranscribe(deps));
  router.get('/job/:jobId', handleAiJobStatus(deps));
  router.post('/job/:jobId/confirm-delivery', handleAiConfirmDelivery(deps));

  return router;
}
