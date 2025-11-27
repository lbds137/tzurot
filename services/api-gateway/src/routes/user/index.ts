/**
 * User Routes
 * API endpoints for user settings and preferences
 *
 * Endpoints:
 * - GET /user/timezone - Get current timezone
 * - PUT /user/timezone - Set timezone
 * - GET /user/timezone/list - List common timezones
 * - GET /user/usage - Get token usage statistics
 * - GET /user/personality - List personalities (for autocomplete)
 * - GET /user/llm-config - List LLM configs
 * - POST /user/llm-config - Create user LLM config
 * - DELETE /user/llm-config/:id - Delete user LLM config
 * - GET /user/model-override - List per-personality overrides
 * - PUT /user/model-override - Set override for a personality
 * - DELETE /user/model-override/:personalityId - Remove override
 * - GET /user/model-override/default - Get user's global default config
 * - PUT /user/model-override/default - Set user's global default config
 * - DELETE /user/model-override/default - Clear user's global default config
 */

import { Router } from 'express';
import type { PrismaClient } from '@tzurot/common-types';
import { createTimezoneRoutes } from './timezone.js';
import { createUsageRoutes } from './usage.js';
import { createPersonalityRoutes } from './personality.js';
import { createLlmConfigRoutes } from './llm-config.js';
import { createModelOverrideRoutes } from './model-override.js';

/**
 * Create user router with injected dependencies
 */
export function createUserRouter(prisma: PrismaClient): Router {
  const router = Router();

  // Timezone routes
  router.use('/timezone', createTimezoneRoutes(prisma));

  // Usage routes
  router.use('/usage', createUsageRoutes(prisma));

  // Personality routes (for autocomplete)
  router.use('/personality', createPersonalityRoutes(prisma));

  // LLM config routes
  router.use('/llm-config', createLlmConfigRoutes(prisma));

  // Model override routes
  router.use('/model-override', createModelOverrideRoutes(prisma));

  return router;
}
