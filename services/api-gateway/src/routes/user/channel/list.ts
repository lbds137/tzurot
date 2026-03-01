/**
 * GET /user/channel/list
 * List all channel settings with activated personalities
 *
 * Query params:
 * - guildId (optional): Filter to only show channels in a specific guild
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  type PrismaClient,
  ListChannelSettingsResponseSchema,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import type { AuthenticatedRequest } from '../../../types.js';

const logger = createLogger('channel-list');

/**
 * Create handler for GET /user/channel/list
 * Returns all channel settings with activated personalities, optionally filtered by guildId.
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

    // Build where clause - only include channels with activated personalities
    // Include records with null guildId (legacy data) so bot-client can backfill them
    const whereClause = {
      activatedPersonalityId: { not: null },
      ...(guildId !== undefined ? { OR: [{ guildId }, { guildId: null }] } : {}),
    };

    // Get settings with activated personalities (optionally filtered by guild)
    const settingsList = await prisma.channelSettings.findMany({
      where: whereClause,
      select: {
        id: true,
        channelId: true,
        guildId: true,
        activatedPersonalityId: true,
        autoRespond: true,
        createdBy: true,
        createdAt: true,
        activatedPersonality: {
          select: {
            slug: true,
            displayName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 500, // Bounded query - reasonable limit for channel list
    });

    logger.debug(
      {
        discordUserId,
        settingsCount: settingsList.length,
        guildIdFilter: guildId ?? 'all',
      },
      '[Channel] Listed channel settings'
    );

    // Build response matching schema
    const response = {
      settings: settingsList.map(s => ({
        id: s.id,
        channelId: s.channelId,
        guildId: s.guildId,
        activatedPersonalityId: s.activatedPersonalityId,
        personalitySlug: s.activatedPersonality?.slug ?? null,
        personalityName: s.activatedPersonality?.displayName ?? null,
        autoRespond: s.autoRespond,
        activatedBy: s.createdBy,
        createdAt: s.createdAt.toISOString(),
      })),
    };

    ListChannelSettingsResponseSchema.parse(response);

    sendCustomSuccess(res, response, StatusCodes.OK);
  });

  return [requireUserAuth(), handler];
}
