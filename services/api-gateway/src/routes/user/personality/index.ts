/**
 * User Personality Routes
 * CRUD operations for user-owned personalities (characters)
 *
 * Endpoints:
 * - GET /user/personality - List personalities visible to the user
 * - GET /user/personality/:slug - Get a single personality (if visible)
 * - POST /user/personality - Create a new personality
 * - PUT /user/personality/:slug - Update an owned personality
 * - PATCH /user/personality/:slug/visibility - Toggle visibility
 * - DELETE /user/personality/:slug - Delete an owned personality and all related data
 */

import { Router } from 'express';
import { type PrismaClient, type CacheInvalidationService } from '@tzurot/common-types';
import { createListHandler } from './list.js';
import { createGetHandler } from './get.js';
import { createCreateHandler } from './create.js';
import { createUpdateHandler } from './update.js';
import { createVisibilityHandler } from './visibility.js';
import { createDeleteHandler } from './delete.js';

/**
 * Create personality router with injected dependencies
 * @param prisma - Database client
 * @param cacheInvalidationService - Service for invalidating personality caches across all services
 */
export function createPersonalityRoutes(
  prisma: PrismaClient,
  cacheInvalidationService?: CacheInvalidationService
): Router {
  const router = Router();

  // List personalities - GET /
  router.get('/', ...createListHandler(prisma));

  // Get single personality - GET /:slug
  router.get('/:slug', ...createGetHandler(prisma));

  // Create personality - POST /
  router.post('/', ...createCreateHandler(prisma));

  // Update personality - PUT /:slug
  router.put('/:slug', ...createUpdateHandler(prisma, cacheInvalidationService));

  // Toggle visibility - PATCH /:slug/visibility
  router.patch('/:slug/visibility', ...createVisibilityHandler(prisma));

  // Delete personality - DELETE /:slug
  router.delete('/:slug', ...createDeleteHandler(prisma, cacheInvalidationService));

  return router;
}

// Re-export helpers for use by other modules if needed
