/**
 * Admin Routes
 * Owner-only administrative endpoints
 *
 * Note: Service authentication (X-Service-Auth) is applied globally in index.ts.
 * These routes are already protected by requireServiceAuth middleware.
 */

import { Router } from 'express';
import {
  type PrismaClient,
  type CacheInvalidationService,
  type LlmConfigCacheInvalidationService,
  type ConversationRetentionService,
} from '@tzurot/common-types';
import { createDbSyncRoute } from './dbSync.js';
import { createCreatePersonalityRoute } from './createPersonality.js';
import { createUpdatePersonalityRoute } from './updatePersonality.js';
import { createInvalidateCacheRoute } from './invalidateCache.js';
import { createAdminLlmConfigRoutes } from './llm-config.js';
import { createAdminUsageRoutes } from './usage.js';
import { createCleanupRoute } from './cleanup.js';
import { createAdminSettingsRoutes } from './settings.js';
import { createDiagnosticRoutes } from './diagnostic.js';

/**
 * Create admin router with injected dependencies
 * @param prisma - Prisma client for database operations
 * @param cacheInvalidationService - Service for invalidating personality caches across all services
 * @param llmConfigCacheInvalidation - Service for invalidating LLM config caches across all services
 * @param retentionService - Service for conversation retention operations (cleanup)
 */
export function createAdminRouter(
  prisma: PrismaClient,
  cacheInvalidationService: CacheInvalidationService,
  llmConfigCacheInvalidation?: LlmConfigCacheInvalidationService,
  retentionService?: ConversationRetentionService
): Router {
  const router = Router();

  // Note: Service auth is applied globally - no need to apply here

  // Database sync endpoint
  router.use('/db-sync', createDbSyncRoute());

  // Personality management endpoints
  router.use('/personality', createCreatePersonalityRoute(prisma, cacheInvalidationService));
  router.use('/personality', createUpdatePersonalityRoute(prisma, cacheInvalidationService));

  // LLM config management endpoints
  router.use('/llm-config', createAdminLlmConfigRoutes(prisma, llmConfigCacheInvalidation));

  // Cache invalidation endpoint
  router.use('/invalidate-cache', createInvalidateCacheRoute(cacheInvalidationService));

  // Usage statistics endpoint
  router.use('/usage', createAdminUsageRoutes(prisma));

  // Bot settings endpoint
  router.use('/settings', createAdminSettingsRoutes(prisma));

  // Cleanup endpoint (for conversation history and tombstones)
  if (retentionService !== undefined) {
    router.use('/cleanup', createCleanupRoute(retentionService));
  }

  // Diagnostic logs endpoint (flight recorder for LLM requests)
  router.use('/diagnostic', createDiagnosticRoutes(prisma));

  return router;
}
