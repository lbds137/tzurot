/**
 * Admin Routes
 * Owner-only administrative endpoints
 *
 * All admin routes require authentication via X-Admin-Key header.
 */

import { Router } from 'express';
import {
  type PrismaClient,
  type CacheInvalidationService,
  type LlmConfigCacheInvalidationService,
} from '@tzurot/common-types';
import { createDbSyncRoute } from './dbSync.js';
import { createCreatePersonalityRoute } from './createPersonality.js';
import { createUpdatePersonalityRoute } from './updatePersonality.js';
import { createInvalidateCacheRoute } from './invalidateCache.js';
import { createAdminLlmConfigRoutes } from './llm-config.js';
import { createAdminUsageRoutes } from './usage.js';
import { requireAdminAuth } from '../../services/AuthMiddleware.js';

/**
 * Create admin router with injected dependencies
 * @param prisma - Prisma client for database operations
 * @param cacheInvalidationService - Service for invalidating personality caches across all services
 * @param llmConfigCacheInvalidation - Service for invalidating LLM config caches across all services
 */
export function createAdminRouter(
  prisma: PrismaClient,
  cacheInvalidationService: CacheInvalidationService,
  llmConfigCacheInvalidation?: LlmConfigCacheInvalidationService
): Router {
  const router = Router();

  // Apply admin authentication to ALL admin routes
  router.use(requireAdminAuth());

  // Database sync endpoint
  router.use('/db-sync', createDbSyncRoute());

  // Personality management endpoints
  router.use('/personality', createCreatePersonalityRoute(prisma));
  router.use('/personality', createUpdatePersonalityRoute(prisma));

  // LLM config management endpoints
  router.use('/llm-config', createAdminLlmConfigRoutes(prisma, llmConfigCacheInvalidation));

  // Cache invalidation endpoint
  router.use('/invalidate-cache', createInvalidateCacheRoute(cacheInvalidationService));

  // Usage statistics endpoint
  router.use('/usage', createAdminUsageRoutes(prisma));

  return router;
}
