/**
 * User Routes
 * API endpoints for user settings and preferences
 *
 * Endpoints:
 * - GET /user/timezone - Get current timezone
 * - PUT /user/timezone - Set timezone
 * - GET /user/timezone/list - List common timezones
 * - GET /user/usage - Get token usage statistics
 * - GET /user/llm-config - List LLM configs
 * - POST /user/llm-config - Create user LLM config
 * - DELETE /user/llm-config/:id - Delete user LLM config
 * - GET /user/model-override - List model overrides
 * - PUT /user/model-override - Set model override for personality
 * - DELETE /user/model-override/:personalityId - Remove override
 */

import { Router } from 'express';
import type { PrismaClient } from '@tzurot/common-types';
import { createTimezoneRoutes } from './timezone.js';
import { createUsageRoutes } from './usage.js';
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

  // LLM config routes
  router.use('/llm-config', createLlmConfigRoutes(prisma));

  // Model override routes
  router.use('/model-override', createModelOverrideRoutes(prisma));

  return router;
}
