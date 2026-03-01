/**
 * Channel Settings Routes
 * Manage personality activation and settings in Discord channels
 *
 * Endpoints:
 * - POST /user/channel/activate - Activate a personality in a channel
 * - DELETE /user/channel/deactivate - Deactivate personality from a channel
 * - GET /user/channel/:channelId - Get settings for a channel
 * - GET /user/channel/list - List all channel settings
 * - PATCH /user/channel/update-guild - Update guildId for backfill
 * - GET /user/channel/:channelId/config-overrides - Get channel config overrides
 * - PATCH /user/channel/:channelId/config-overrides - Update channel config overrides
 * - DELETE /user/channel/:channelId/config-overrides - Clear channel config overrides
 */

import { Router } from 'express';
import {
  type PrismaClient,
  type ConfigCascadeCacheInvalidationService,
} from '@tzurot/common-types';
import { createActivateHandler } from './activate.js';
import { createDeactivateHandler } from './deactivate.js';
import { createGetHandler } from './get.js';
import { createListHandler } from './list.js';
import { createUpdateGuildHandler } from './updateGuild.js';
import {
  createGetConfigOverridesHandler,
  createPatchConfigOverridesHandler,
  createDeleteConfigOverridesHandler,
} from './configOverrides.js';

/**
 * Create channel activation router with injected dependencies
 * @param prisma - Database client
 * @param cascadeInvalidation - Config cascade cache invalidation service (optional)
 */
export function createChannelRoutes(
  prisma: PrismaClient,
  cascadeInvalidation?: ConfigCascadeCacheInvalidationService
): Router {
  const router = Router();

  // List activations - GET /list (must come before /:channelId)
  router.get('/list', ...createListHandler(prisma));

  // Activate personality - POST /activate
  router.post('/activate', ...createActivateHandler(prisma));

  // Deactivate personality - DELETE /deactivate
  router.delete('/deactivate', ...createDeactivateHandler(prisma));

  // Update guildId - PATCH /update-guild (for lazy backfill)
  router.patch('/update-guild', ...createUpdateGuildHandler(prisma));

  // Channel config overrides
  const configOverridesPath = '/:channelId/config-overrides';
  router.get(configOverridesPath, ...createGetConfigOverridesHandler(prisma));
  router.patch(
    configOverridesPath,
    ...createPatchConfigOverridesHandler(prisma, cascadeInvalidation)
  );
  router.delete(
    configOverridesPath,
    ...createDeleteConfigOverridesHandler(prisma, cascadeInvalidation)
  );

  // Get settings - GET /:channelId
  router.get('/:channelId', ...createGetHandler(prisma));

  return router;
}
