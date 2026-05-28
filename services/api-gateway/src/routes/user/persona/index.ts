/**
 * User Persona Routes
 * CRUD operations for user personas (profiles that tell AI about the user)
 *
 * Endpoints:
 * - GET /user/persona - List user's personas
 * - GET /user/persona/:id - Get a specific persona
 * - POST /user/persona - Create a new persona
 * - PUT /user/persona/:id - Update a persona
 * - DELETE /user/persona/:id - Delete a persona
 * - PATCH /user/persona/:id/default - Set persona as user's default
 * - GET /user/persona/override - List persona overrides for personalities
 * - GET /user/persona/override/:personalitySlug - Get personality info for override
 * - PUT /user/persona/override/:personalitySlug - Set persona override for a personality
 * - DELETE /user/persona/override/:personalitySlug - Clear persona override
 * - POST /user/persona/override/by-id/:personalityId - Create persona + set
 *     as override (atomic, single transaction)
 */

import { Router } from 'express';
import type { RouteDeps } from '../../routeDeps.js';
import { addCrudRoutes } from './crud.js';
import { addDefaultRoutes } from './default.js';
import { addOverrideRoutes } from './override.js';

export function createPersonaRoutes(deps: RouteDeps): Router {
  const router = Router();

  // Order matters: routes with parameters must come after specific paths
  // Override routes have /override prefix so they won't conflict with /:id
  addOverrideRoutes(router, deps.prisma);

  // Default route (/:id/default) - before general /:id
  addDefaultRoutes(router, deps.prisma);

  // CRUD routes last (/ and /:id)
  addCrudRoutes(router, deps);

  return router;
}
