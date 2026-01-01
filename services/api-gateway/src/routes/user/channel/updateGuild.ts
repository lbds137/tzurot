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
  createLogger,
  type PrismaClient,
  UpdateChannelGuildRequestSchema,
  UpdateChannelGuildResponseSchema,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import type { AuthenticatedRequest } from '../../../types.js';

const logger = createLogger('channel-update-guild');

/**
 * Create handler for PATCH /user/channel/update-guild
 * Updates guildId for channel settings that are missing it (legacy backfill).
 */
export function createUpdateGuildHandler(prisma: PrismaClient): RequestHandler[] {
  const handler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // Validate request body
    const parseResult = UpdateChannelGuildRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map(e => e.message).join(', ');
      sendError(res, ErrorResponses.validationError(errorMessage));
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
      logger.info({ channelId, guildId }, '[Channel] Backfilled guildId for channel settings');
    } else {
      logger.debug(
        { channelId, guildId },
        '[Channel] No update needed (guildId already set or no settings found)'
      );
    }

    // Build response matching schema
    const response = { updated: wasUpdated };
    UpdateChannelGuildResponseSchema.parse(response);

    sendCustomSuccess(res, response, StatusCodes.OK);
  });

  return [requireUserAuth(), handler];
}
