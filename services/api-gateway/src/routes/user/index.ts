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
 * - GET /user/personality/:slug - Get a single personality
 * - POST /user/personality - Create a new personality
 * - PUT /user/personality/:slug - Update an owned personality
 * - PATCH /user/personality/:slug/visibility - Toggle visibility
 * - GET /user/llm-config - List LLM configs
 * - POST /user/llm-config - Create user LLM config
 * - DELETE /user/llm-config/:id - Delete user LLM config
 * - GET /user/model-override - List per-personality overrides
 * - PUT /user/model-override - Set override for a personality
 * - DELETE /user/model-override/:personalityId - Remove override
 * - GET /user/model-override/default - Get user's global default config
 * - PUT /user/model-override/default - Set user's global default config
 * - DELETE /user/model-override/default - Clear user's global default config
 * - GET /user/persona - List user's personas
 * - GET /user/persona/:id - Get a specific persona
 * - POST /user/persona - Create a new persona
 * - PUT /user/persona/:id - Update a persona
 * - DELETE /user/persona/:id - Delete a persona
 * - PATCH /user/persona/:id/default - Set persona as default
 * - PATCH /user/persona/settings - Update persona settings (share-ltm)
 * - GET /user/persona/override - List persona overrides
 * - PUT /user/persona/override/:personalitySlug - Set persona override
 * - DELETE /user/persona/override/:personalitySlug - Clear persona override
 * - POST /user/history/clear - Clear context (set epoch timestamp)
 * - POST /user/history/undo - Restore previous context epoch
 * - GET /user/history/stats - Get conversation history statistics
 * - POST /user/channel/activate - Activate personality in a channel
 * - DELETE /user/channel/deactivate - Deactivate personality from a channel
 * - GET /user/channel/:channelId - Get activation status for a channel
 * - GET /user/channel/list - List all activated channels
 * - GET /user/memory/stats - Get memory statistics for a personality
 * - GET /user/memory/focus - Get focus mode status
 * - POST /user/memory/focus - Enable/disable focus mode
 */

import { Router } from 'express';
import type {
  PrismaClient,
  LlmConfigCacheInvalidationService,
  CacheInvalidationService,
} from '@tzurot/common-types';
import { createTimezoneRoutes } from './timezone.js';
import { createUsageRoutes } from './usage.js';
import { createPersonalityRoutes } from './personality/index.js';
import { createLlmConfigRoutes } from './llm-config.js';
import { createModelOverrideRoutes } from './model-override.js';
import { createPersonaRoutes } from './persona.js';
import { createHistoryRoutes } from './history.js';
import { createChannelRoutes } from './channel/index.js';
import { createMemoryRoutes } from './memory.js';

/**
 * Create user router with injected dependencies
 * @param prisma - Prisma client instance
 * @param llmConfigCacheInvalidation - Optional cache invalidation service for LLM configs
 * @param cacheInvalidationService - Optional cache invalidation service for personality changes
 */
export function createUserRouter(
  prisma: PrismaClient,
  llmConfigCacheInvalidation?: LlmConfigCacheInvalidationService,
  cacheInvalidationService?: CacheInvalidationService
): Router {
  const router = Router();

  // Timezone routes
  router.use('/timezone', createTimezoneRoutes(prisma));

  // Usage routes
  router.use('/usage', createUsageRoutes(prisma));

  // Personality routes (with cache invalidation for avatar changes)
  router.use('/personality', createPersonalityRoutes(prisma, cacheInvalidationService));

  // LLM config routes
  router.use('/llm-config', createLlmConfigRoutes(prisma));

  // Model override routes (with cache invalidation for default config changes)
  router.use('/model-override', createModelOverrideRoutes(prisma, llmConfigCacheInvalidation));

  // Persona routes (user profiles that tell AI about the user)
  router.use('/persona', createPersonaRoutes(prisma));

  // History routes (STM management via context epochs)
  router.use('/history', createHistoryRoutes(prisma));

  // Channel activation routes (auto-respond to all messages in a channel)
  router.use('/channel', createChannelRoutes(prisma));

  // Memory routes (LTM management - stats, focus mode, search, browse)
  router.use('/memory', createMemoryRoutes(prisma));

  return router;
}
