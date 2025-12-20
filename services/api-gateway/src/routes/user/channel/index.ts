/**
 * Channel Activation Routes
 * Manage personality activation in Discord channels
 *
 * Endpoints:
 * - POST /user/channel/activate - Activate a personality in a channel
 * - DELETE /user/channel/deactivate - Deactivate personality from a channel
 * - GET /user/channel/:channelId - Get activation status for a channel
 * - GET /user/channel/list - List all activated channels
 * - PATCH /user/channel/update-guild - Update guildId for backfill
 */

import { Router } from 'express';
import { type PrismaClient } from '@tzurot/common-types';
import { createActivateHandler } from './activate.js';
import { createDeactivateHandler } from './deactivate.js';
import { createGetHandler } from './get.js';
import { createListHandler } from './list.js';
import { createUpdateGuildHandler } from './updateGuild.js';

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

  // Get activation status - GET /:channelId
  router.get('/:channelId', ...createGetHandler(prisma));

  return router;
}
