/**
 * DELETE /user/channel/deactivate
 * Deactivate personality from a Discord channel
 *
 * Removes any personality activation from the channel, so the bot
 * will only respond to @mentions again.
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
 * Deactivates any personality from the channel.
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

    // Find existing activation
    const existingActivation = await prisma.activatedChannel.findFirst({
      where: { channelId },
      select: {
        id: true,
        personality: {
          select: {
            displayName: true,
          },
        },
      },
    });

    // If no activation exists, return success with deactivated=false
    if (existingActivation === null) {
      const response = { deactivated: false };
      DeactivateChannelResponseSchema.parse(response);
      sendCustomSuccess(res, response, StatusCodes.OK);
      return;
    }

    const personalityName = existingActivation.personality.displayName;

    // Delete the activation
    await prisma.activatedChannel.delete({
      where: { id: existingActivation.id },
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
