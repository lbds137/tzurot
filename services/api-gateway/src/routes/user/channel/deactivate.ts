/**
 * DELETE /user/channel/deactivate
 * Deactivate personality from a Discord channel
 *
 * Removes any personality activation from the channel, so the bot
 * will only respond to @mentions again. Does NOT delete channel settings.
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  DeactivateChannelRequestSchema,
  DeactivateChannelResponseSchema,
} from '@tzurot/common-types/schemas/api/channel';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { requireUserAuth, requireProvisionedUser } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess } from '../../../utils/responseHelpers.js';
import { sendZodError } from '../../../utils/zodHelpers.js';
import type { AuthenticatedRequest } from '../../../types.js';
import type { RouteDeps } from '../../routeDeps.js';

const logger = createLogger('channel-deactivate');

/**
 * DELETE /api/user/channel/deactivate — clear activated personality on a channel.
 */
export const handleDeactivateChannel = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;

    // Validate request body
    const parseResult = DeactivateChannelRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendZodError(res, parseResult.error);
      return;
    }

    const { channelId } = parseResult.data;

    // Find existing channel settings with activated personality
    const existingSettings = await prisma.channelSettings.findUnique({
      where: { channelId },
      select: {
        id: true,
        activatedPersonalityId: true,
        activatedPersonality: {
          select: {
            displayName: true,
          },
        },
      },
    });

    // If no settings or no activated personality, return success with deactivated=false
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- explicit null checks required for type narrowing
    if (existingSettings === null || existingSettings.activatedPersonalityId === null) {
      const response = { deactivated: false };
      DeactivateChannelResponseSchema.parse(response);
      sendCustomSuccess(res, response, StatusCodes.OK);
      return;
    }

    const personalityName = existingSettings.activatedPersonality?.displayName ?? 'Unknown';

    // Clear the activated personality (don't delete the settings record)
    await prisma.channelSettings.update({
      where: { id: existingSettings.id },
      data: { activatedPersonalityId: null },
    });

    logger.info(
      {
        discordUserId,
        channelId,
        personalityName,
      },
      'Deactivated personality from channel'
    );

    // Build response matching schema
    const response = {
      deactivated: true,
      personalityName,
    };

    DeactivateChannelResponseSchema.parse(response);

    sendCustomSuccess(res, response, StatusCodes.OK);
  });
};

export function createDeactivateHandler(deps: RouteDeps): RequestHandler[] {
  return [requireUserAuth(), requireProvisionedUser(deps.prisma), handleDeactivateChannel(deps)];
}
