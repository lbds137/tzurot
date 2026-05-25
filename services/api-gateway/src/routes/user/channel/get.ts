/**
 * GET /user/channel/:channelId
 * Get settings for a specific channel
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger, GetChannelSettingsResponseSchema } from '@tzurot/common-types';
import { requireServiceAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { getParam } from '../../../utils/requestParams.js';
import type { AuthenticatedRequest } from '../../../types.js';
import type { RouteDeps } from '../../routeDeps.js';

const logger = createLogger('channel-get');

/**
 * GET /api/user/channel/:channelId — channel settings (service-only).
 */
export const handleGetChannelSettings = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
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
      'Retrieved channel settings'
    );

    // Build response matching schema
    const response = {
      hasSettings: true,
      settings: {
        id: settings.id,
        channelId: settings.channelId,
        guildId: settings.guildId,
        activatedPersonalityId: settings.activatedPersonalityId,
        personalitySlug: settings.activatedPersonality?.slug ?? null,
        personalityName: settings.activatedPersonality?.displayName ?? null,
        autoRespond: settings.autoRespond,
        activatedBy: settings.createdBy,
        createdAt: settings.createdAt.toISOString(),
      },
    };

    GetChannelSettingsResponseSchema.parse(response);

    sendCustomSuccess(res, response, StatusCodes.OK);
  });
};

// Service auth only — service-to-service lookup, not user-specific
export function createGetHandler(deps: RouteDeps): RequestHandler[] {
  return [requireServiceAuth(), handleGetChannelSettings(deps)];
}
