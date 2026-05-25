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
import type { RouteDeps } from '../../routeDeps.js';
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
 */
export function createChannelRoutes(deps: RouteDeps): Router {
  const router = Router();

  // List activations - GET /list (must come before /:channelId)
  router.get('/list', ...createListHandler(deps));

  // Activate personality - POST /activate
  router.post('/activate', ...createActivateHandler(deps));

  // Deactivate personality - DELETE /deactivate
  router.delete('/deactivate', ...createDeactivateHandler(deps));

  // Update guildId - PATCH /update-guild (for lazy backfill)
  router.patch('/update-guild', ...createUpdateGuildHandler(deps));

  // Channel config overrides
  const configOverridesPath = '/:channelId/config-overrides';
  router.get(configOverridesPath, ...createGetConfigOverridesHandler(deps));
  router.patch(configOverridesPath, ...createPatchConfigOverridesHandler(deps));
  router.delete(configOverridesPath, ...createDeleteConfigOverridesHandler(deps));

  // Get settings - GET /:channelId
  router.get('/:channelId', ...createGetHandler(deps));

  return router;
}
