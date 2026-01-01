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
 * - PATCH /user/channel/extended-context/:channelId - Update extended context setting
 */

import { Router } from 'express';
import { type PrismaClient } from '@tzurot/common-types';
import { createActivateHandler } from './activate.js';
import { createDeactivateHandler } from './deactivate.js';
import { createGetHandler } from './get.js';
import { createListHandler } from './list.js';
import { createUpdateGuildHandler } from './updateGuild.js';
import { createExtendedContextHandler } from './extendedContext.js';

/**
 * Create channel activation router with injected dependencies
 * @param prisma - Database client
 */
export function createChannelRoutes(prisma: PrismaClient): Router {
  const router = Router();

  // List activations - GET /list (must come before /:channelId)
  router.get('/list', ...createListHandler(prisma));

  // Activate personality - POST /activate
  router.post('/activate', ...createActivateHandler(prisma));

  // Deactivate personality - DELETE /deactivate
  router.delete('/deactivate', ...createDeactivateHandler(prisma));

  // Update guildId - PATCH /update-guild (for lazy backfill)
  router.patch('/update-guild', ...createUpdateGuildHandler(prisma));

  // Update extended context - PATCH /extended-context/:channelId
  router.patch('/extended-context/:channelId', ...createExtendedContextHandler(prisma));

  // Get settings - GET /:channelId
  router.get('/:channelId', ...createGetHandler(prisma));

  return router;
}
