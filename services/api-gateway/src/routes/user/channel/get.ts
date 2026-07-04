/**
 * GET /user/channel/:channelId
 * Get settings for a specific channel
 */

import { type Response, type RequestHandler } from 'express';
import { GetChannelSettingsResponseSchema } from '@tzurot/common-types/schemas/api/channel';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { requireServiceAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendContractSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { getParam } from '../../../utils/requestParams.js';
import type { AuthenticatedRequest } from '../../../types.js';
import type { RouteDeps } from '../../routeDeps.js';

const logger = createLogger('channel-get');

/**
 * GET /api/user/channel/:channelId — channel settings (service-only).
 */
export const handleGetUserChannel = (deps: RouteDeps): RequestHandler => {
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
      sendContractSuccess(res, GetChannelSettingsResponseSchema, { hasSettings: false });
      return;
    }

    logger.debug(
      {
        channelId,
        personalitySlug: settings.activatedPersonality?.slug ?? null,
      },
      'Retrieved channel settings'
    );

    // Payload typed against the declared output schema — drift fails tsc.
    // This replaced an explicit .parse() runtime guard: per-request parsing
    // is redundant now that the conformance harness validates this route's
    // wire response against the same schema. Don't add the parse back.
    sendContractSuccess(res, GetChannelSettingsResponseSchema, {
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
    });
  });
};

// Service auth only — service-to-service lookup, not user-specific
export function createGetHandler(deps: RouteDeps): RequestHandler[] {
  return [requireServiceAuth(), handleGetUserChannel(deps)];
}
