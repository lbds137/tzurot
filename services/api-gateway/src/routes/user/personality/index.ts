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
import type { RouteDeps } from '../../routeDeps.js';
import { createListHandler } from './list.js';
import { createGetHandler } from './get.js';
import { createCreateHandler } from './create.js';
import { createUpdateHandler } from './update.js';
import { createVisibilityHandler } from './visibility.js';
import { createDeleteHandler } from './delete.js';

/**
 * Create personality router with injected dependencies
 */
export function createPersonalityRoutes(deps: RouteDeps): Router {
  const router = Router();

  router.get('/', ...createListHandler(deps));
  router.get('/:slug', ...createGetHandler(deps));
  router.post('/', ...createCreateHandler(deps));
  router.put('/:slug', ...createUpdateHandler(deps));
  router.patch('/:slug/visibility', ...createVisibilityHandler(deps));
  router.delete('/:slug', ...createDeleteHandler(deps));

  return router;
}
