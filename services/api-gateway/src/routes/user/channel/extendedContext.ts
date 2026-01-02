/**
 * PATCH /user/channel/extended-context/:channelId
 * Update extended context setting for a channel
 *
 * This allows users to override the global extended context default
 * for specific channels. Set to null to use global default.
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  type PrismaClient,
  generateChannelSettingsUuid,
  UpdateChannelExtendedContextRequestSchema,
  UpdateChannelExtendedContextResponseSchema,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import type { AuthenticatedRequest } from '../../../types.js';
import { getOrCreateInternalUser } from '../personality/helpers.js';

const logger = createLogger('channel-extended-context');

/**
 * Create handler for PATCH /user/channel/extended-context/:channelId
 * Updates the extended context setting for a channel.
 */
export function createExtendedContextHandler(prisma: PrismaClient): RequestHandler[] {
  const handler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const { channelId } = req.params;

    if (!channelId) {
      sendError(res, ErrorResponses.validationError('channelId is required'));
      return;
    }

    // Validate request body
    const parseResult = UpdateChannelExtendedContextRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map(e => e.message).join(', ');
      sendError(res, ErrorResponses.validationError(errorMessage));
      return;
    }

    const {
      extendedContext,
      extendedContextMaxMessages,
      extendedContextMaxAge,
      extendedContextMaxImages,
    } = parseResult.data;

    // Build update object with only specified fields
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: Record<string, any> = {};
    if (extendedContext !== undefined) {updateData.extendedContext = extendedContext;}
    if (extendedContextMaxMessages !== undefined)
      {updateData.extendedContextMaxMessages = extendedContextMaxMessages;}
    if (extendedContextMaxAge !== undefined)
      {updateData.extendedContextMaxAge = extendedContextMaxAge;}
    if (extendedContextMaxImages !== undefined)
      {updateData.extendedContextMaxImages = extendedContextMaxImages;}

    // Get or create internal user
    const user = await getOrCreateInternalUser(prisma, discordUserId);

    // Generate deterministic UUID for this channel
    const settingsId = generateChannelSettingsUuid(channelId);

    // Upsert channel settings - create if doesn't exist, update if it does
    const settings = await prisma.channelSettings.upsert({
      where: { channelId },
      create: {
        id: settingsId,
        channelId,
        ...updateData,
        createdBy: user.id,
      },
      update: updateData,
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

    logger.info(
      {
        discordUserId,
        channelId,
        updates: updateData,
      },
      '[Channel] Updated extended context settings'
    );

    // Build response matching schema
    const response = {
      updated: true,
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

    // Validate response matches schema
    UpdateChannelExtendedContextResponseSchema.parse(response);

    sendCustomSuccess(res, response, StatusCodes.OK);
  });

  return [requireUserAuth(), handler];
}
