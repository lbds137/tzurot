/**
 * GET /user/channel/list
 * List all activated channels
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  type PrismaClient,
  ListChannelActivationsResponseSchema,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess } from '../../../utils/responseHelpers.js';
import type { AuthenticatedRequest } from '../../../types.js';

const logger = createLogger('channel-list');

/**
 * Create handler for GET /user/channel/list
 * Returns all activated channels.
 */
export function createListHandler(prisma: PrismaClient): RequestHandler[] {
  const handler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;

    // Get all activations
    const activations = await prisma.activatedChannel.findMany({
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
      orderBy: { createdAt: 'desc' },
    });

    logger.debug(
      {
        discordUserId,
        activationCount: activations.length,
      },
      '[Channel] Listed channel activations'
    );

    // Build response matching schema
    const response = {
      activations: activations.map(a => ({
        id: a.id,
        channelId: a.channelId,
        personalitySlug: a.personality.slug,
        personalityName: a.personality.displayName,
        activatedBy: a.createdBy,
        createdAt: a.createdAt.toISOString(),
      })),
    };

    ListChannelActivationsResponseSchema.parse(response);

    sendCustomSuccess(res, response, StatusCodes.OK);
  });

  return [requireUserAuth(), handler];
}
