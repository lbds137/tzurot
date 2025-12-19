/**
 * GET /user/channel/:channelId
 * Get activation status for a specific channel
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  type PrismaClient,
  GetChannelActivationResponseSchema,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import type { AuthenticatedRequest } from '../../../types.js';

const logger = createLogger('channel-get');

/**
 * Create handler for GET /user/channel/:channelId
 * Returns whether the channel has an activated personality.
 */
export function createGetHandler(prisma: PrismaClient): RequestHandler[] {
  const handler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const { channelId } = req.params;

    // Validate channelId
    if (channelId === undefined || channelId.length === 0) {
      sendError(res, ErrorResponses.validationError('channelId is required'));
      return;
    }

    // Find activation for this channel
    const activation = await prisma.activatedChannel.findFirst({
      where: { channelId },
      select: {
        id: true,
        channelId: true,
        createdBy: true,
        createdAt: true,
        personality: {
          select: {
            slug: true,
            displayName: true,
          },
        },
      },
    });

    // No activation found
    if (activation === null) {
      const response = { isActivated: false };
      GetChannelActivationResponseSchema.parse(response);
      sendCustomSuccess(res, response, StatusCodes.OK);
      return;
    }

    logger.debug(
      {
        discordUserId,
        channelId,
        personalitySlug: activation.personality.slug,
      },
      '[Channel] Retrieved channel activation'
    );

    // Build response matching schema
    const response = {
      isActivated: true,
      activation: {
        id: activation.id,
        channelId: activation.channelId,
        personalitySlug: activation.personality.slug,
        personalityName: activation.personality.displayName,
        activatedBy: activation.createdBy,
        createdAt: activation.createdAt.toISOString(),
      },
    };

    GetChannelActivationResponseSchema.parse(response);

    sendCustomSuccess(res, response, StatusCodes.OK);
  });

  return [requireUserAuth(), handler];
}
