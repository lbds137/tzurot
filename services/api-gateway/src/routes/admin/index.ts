/**
 * Admin Routes
 * Owner-only administrative endpoints
 */

import { Router } from 'express';
import { type PrismaClient } from '@tzurot/common-types';
import { type CacheInvalidationService } from '@tzurot/common-types';
import { createDbSyncRoute } from './dbSync.js';
import { createCreatePersonalityRoute } from './createPersonality.js';
import { createUpdatePersonalityRoute } from './updatePersonality.js';
import { createInvalidateCacheRoute } from './invalidateCache.js';

/**
 * Create admin router with injected dependencies
 * @param prisma - Prisma client for database operations
 * @param cacheInvalidationService - Service for invalidating personality caches across all services
 */
export function createAdminRouter(
  prisma: PrismaClient,
  cacheInvalidationService: CacheInvalidationService
): Router {
  const router = Router();

  // Database sync endpoint
  router.use('/db-sync', createDbSyncRoute());

  // Personality management endpoints
  router.use('/personality', createCreatePersonalityRoute(prisma));
  router.use('/personality', createUpdatePersonalityRoute(prisma));

  // Cache invalidation endpoint
  router.use('/invalidate-cache', createInvalidateCacheRoute(cacheInvalidationService));

  return router;
}
