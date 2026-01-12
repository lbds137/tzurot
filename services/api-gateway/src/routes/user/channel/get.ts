/**
 * GET /user/channel/:channelId
 * Get settings for a specific channel
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  type PrismaClient,
  GetChannelSettingsResponseSchema,
} from '@tzurot/common-types';
import { requireServiceAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { getParam } from '../../../utils/requestParams.js';
import type { AuthenticatedRequest } from '../../../types.js';

const logger = createLogger('channel-get');

/**
 * Create handler for GET /user/channel/:channelId
 * Returns channel settings including activation status.
 */
export function createGetHandler(prisma: PrismaClient): RequestHandler[] {
  const handler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const channelId = getParam(req.params.channelId);

    // Validate channelId
    if (channelId === undefined || channelId.length === 0) {
      sendError(res, ErrorResponses.validationError('channelId is required'));
      return;
    }

    // Find settings for this channel
    const settings = await prisma.channelSettings.findUnique({
      where: { channelId },
      select: {
        id: true,
        channelId: true,
        guildId: true,
        autoRespond: true,
        extendedContext: true,
        extendedContextMaxMessages: true,
        extendedContextMaxAge: true,
        extendedContextMaxImages: true,
        createdBy: true,
        createdAt: true,
        activatedPersonality: {
          select: {
            slug: true,
            displayName: true,
          },
        },
      },
    });

    // No settings found
    if (settings === null) {
      const response = { hasSettings: false };
      GetChannelSettingsResponseSchema.parse(response);
      sendCustomSuccess(res, response, StatusCodes.OK);
      return;
    }

    logger.debug(
      {
        channelId,
        personalitySlug: settings.activatedPersonality?.slug ?? null,
      },
      '[Channel] Retrieved channel settings'
    );

    // Build response matching schema
    const response = {
      hasSettings: true,
      settings: {
        id: settings.id,
        channelId: settings.channelId,
        guildId: settings.guildId,
        personalitySlug: settings.activatedPersonality?.slug ?? null,
        personalityName: settings.activatedPersonality?.displayName ?? null,
        autoRespond: settings.autoRespond,
        extendedContext: settings.extendedContext,
        extendedContextMaxMessages: settings.extendedContextMaxMessages,
        extendedContextMaxAge: settings.extendedContextMaxAge,
        extendedContextMaxImages: settings.extendedContextMaxImages,
        activatedBy: settings.createdBy,
        createdAt: settings.createdAt.toISOString(),
      },
    };

    GetChannelSettingsResponseSchema.parse(response);

    sendCustomSuccess(res, response, StatusCodes.OK);
  });

  // Service auth only - this is a service-to-service lookup, not user-specific
  return [requireServiceAuth(), handler];
}
