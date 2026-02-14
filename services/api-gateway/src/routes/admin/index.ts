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
  type DenylistCacheInvalidationService,
} from '@tzurot/common-types';
import type { OpenRouterModelCache } from '../../services/OpenRouterModelCache.js';
import { createDbSyncRoute } from './dbSync.js';
import { createCreatePersonalityRoute } from './createPersonality.js';
import { createUpdatePersonalityRoute } from './updatePersonality.js';
import { createInvalidateCacheRoute } from './invalidateCache.js';
import { createAdminLlmConfigRoutes } from './llm-config.js';
import { createAdminUsageRoutes } from './usage.js';
import { createCleanupRoute } from './cleanup.js';
import { createAdminSettingsRoutes } from './settings.js';
import { createDiagnosticRoutes } from './diagnostic.js';
import { createDenylistRoutes } from './denylist.js';

interface AdminRouterOptions {
  prisma: PrismaClient;
  cacheInvalidationService: CacheInvalidationService;
  llmConfigCacheInvalidation?: LlmConfigCacheInvalidationService;
  retentionService?: ConversationRetentionService;
  modelCache?: OpenRouterModelCache;
  denylistInvalidation?: DenylistCacheInvalidationService;
}

/**
 * Create admin router with injected dependencies
 */
export function createAdminRouter(opts: AdminRouterOptions): Router {
  const {
    prisma,
    cacheInvalidationService,
    llmConfigCacheInvalidation,
    retentionService,
    modelCache,
    denylistInvalidation,
  } = opts;
  const router = Router();

  // Note: Service auth is applied globally - no need to apply here

  // Database sync endpoint
  router.use('/db-sync', createDbSyncRoute());

  // Personality management endpoints
  router.use('/personality', createCreatePersonalityRoute(prisma, cacheInvalidationService));
  router.use('/personality', createUpdatePersonalityRoute(prisma, cacheInvalidationService));

  // LLM config management endpoints
  router.use(
    '/llm-config',
    createAdminLlmConfigRoutes(prisma, llmConfigCacheInvalidation, modelCache)
  );

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

  // Denylist management endpoints (user/guild blocking)
  if (denylistInvalidation !== undefined) {
    router.use('/denylist', createDenylistRoutes(prisma, denylistInvalidation));
  }

  return router;
}
