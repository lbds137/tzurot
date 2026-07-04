/**
 * PATCH /user/channel/update-guild
 * Update guildId for an existing channel settings record (lazy backfill)
 *
 * This endpoint is called by bot-client when it encounters settings
 * without guildId (legacy data) and resolves the guildId via Discord.js.
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  UpdateChannelGuildRequestSchema,
  UpdateChannelGuildResponseSchema,
} from '@tzurot/common-types/schemas/api/channel';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { requireUserAuth, requireProvisionedUser } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess } from '../../../utils/responseHelpers.js';
import { sendZodError } from '../../../utils/zodHelpers.js';
import type { AuthenticatedRequest } from '../../../types.js';
import type { RouteDeps } from '../../routeDeps.js';

const logger = createLogger('channel-update-guild');

/**
 * PATCH /api/user/channel/update-guild — backfill missing guildId.
 */
export const handleUpdateChannelGuild = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // Validate request body
    const parseResult = UpdateChannelGuildRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendZodError(res, parseResult.error);
      return;
    }

    const { channelId, guildId } = parseResult.data;

    // Update only if guildId is currently null (don't overwrite existing data)
    const result = await prisma.channelSettings.updateMany({
      where: {
        channelId,
        guildId: null, // Only update if not already set
      },
      data: { guildId },
    });

    const wasUpdated = result.count > 0;

    if (wasUpdated) {
      logger.info({ channelId, guildId }, 'Backfilled guildId for channel settings');
    } else {
      logger.debug(
        { channelId, guildId },
        'No update needed (guildId already set or no settings found)'
      );
    }

    // Build response matching schema
    const response = { updated: wasUpdated };
    UpdateChannelGuildResponseSchema.parse(response);

    sendCustomSuccess(res, response, StatusCodes.OK);
  });
};

export function createUpdateGuildHandler(deps: RouteDeps): RequestHandler[] {
  return [requireUserAuth(), requireProvisionedUser(deps.prisma), handleUpdateChannelGuild(deps)];
}
