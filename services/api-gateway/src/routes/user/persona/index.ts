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
 * - PATCH /user/persona/settings - Update persona settings (share-ltm)
 * - GET /user/persona/override - List persona overrides for personalities
 * - GET /user/persona/override/:personalitySlug - Get personality info for override
 * - PUT /user/persona/override/:personalitySlug - Set persona override for a personality
 * - DELETE /user/persona/override/:personalitySlug - Clear persona override
 */

import { Router } from 'express';
import type { PrismaClient } from '@tzurot/common-types';
import { addCrudRoutes } from './crud.js';
import { addDefaultRoutes } from './default.js';
import { addSettingsRoutes } from './settings.js';
import { addOverrideRoutes } from './override.js';

// Re-export types for external consumers
export type {
  PersonaSummary,
  PersonaDetails,
  SettingsBody,
  OverrideBody,
  PersonaOverrideSummary,
} from './types.js';
export type { CreatePersonaBody, UpdatePersonaBody } from './crud.js';

export function createPersonaRoutes(prisma: PrismaClient): Router {
  const router = Router();

  // Order matters: routes with parameters must come after specific paths
  // Override routes have /override prefix so they won't conflict with /:id
  addOverrideRoutes(router, prisma);

  // Settings route (/settings) - before /:id routes
  addSettingsRoutes(router, prisma);

  // Default route (/:id/default) - before general /:id
  addDefaultRoutes(router, prisma);

  // CRUD routes last (/ and /:id)
  addCrudRoutes(router, prisma);

  return router;
}
