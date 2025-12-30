/**
 * GET /user/channel/list
 * List all activated channels
 *
 * Query params:
 * - guildId (optional): Filter to only show channels in a specific guild
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
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import type { AuthenticatedRequest } from '../../../types.js';

const logger = createLogger('channel-list');

/**
 * Create handler for GET /user/channel/list
 * Returns all activated channels, optionally filtered by guildId.
 */
export function createListHandler(prisma: PrismaClient): RequestHandler[] {
  const handler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;

    // Optional guildId filter from query params
    const guildId = req.query.guildId as string | undefined;

    // Validate guildId if provided - empty string is invalid
    if (guildId?.trim() === '') {
      return sendError(res, ErrorResponses.validationError('guildId cannot be empty'));
    }

    // Build where clause based on whether guildId filter is provided
    // Include records with null guildId (legacy data) so bot-client can backfill them
    const whereClause =
      guildId !== undefined
        ? {
            OR: [{ guildId }, { guildId: null }],
          }
        : undefined;

    // Get activations (optionally filtered by guild)
    const activations = await prisma.activatedChannel.findMany({
      where: whereClause,
      select: {
        id: true,
        channelId: true,
        guildId: true,
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
        guildIdFilter: guildId ?? 'all',
      },
      '[Channel] Listed channel activations'
    );

    // Build response matching schema
    const response = {
      activations: activations.map(a => ({
        id: a.id,
        channelId: a.channelId,
        guildId: a.guildId,
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
