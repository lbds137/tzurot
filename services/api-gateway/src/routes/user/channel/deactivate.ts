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
  createLogger,
  type PrismaClient,
  DeactivateChannelRequestSchema,
  DeactivateChannelResponseSchema,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import type { AuthenticatedRequest } from '../../../types.js';

const logger = createLogger('channel-deactivate');

/**
 * Create handler for DELETE /user/channel/deactivate
 * Deactivates any personality from the channel by clearing activatedPersonalityId.
 */
export function createDeactivateHandler(prisma: PrismaClient): RequestHandler[] {
  const handler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;

    // Validate request body
    const parseResult = DeactivateChannelRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map(e => e.message).join(', ');
      sendError(res, ErrorResponses.validationError(errorMessage));
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
      '[Channel] Deactivated personality from channel'
    );

    // Build response matching schema
    const response = {
      deactivated: true,
      personalityName,
    };

    DeactivateChannelResponseSchema.parse(response);

    sendCustomSuccess(res, response, StatusCodes.OK);
  });

  return [requireUserAuth(), handler];
}
