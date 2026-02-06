/**
 * POST /user/channel/activate
 * Activate a personality in a Discord channel
 *
 * Activating a personality means it will respond to ALL messages in the channel,
 * not just @mentions. Only ONE personality can be active per channel.
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  type PrismaClient,
  generateChannelSettingsUuid,
  ActivateChannelRequestSchema,
  ActivateChannelResponseSchema,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import type { AuthenticatedRequest } from '../../../types.js';
import { getOrCreateInternalUser, canUserViewPersonality } from '../personality/helpers.js';

const logger = createLogger('channel-activate');

/** Channel settings select type for upsert */
interface ChannelSettingsResult {
  id: string;
  channelId: string;
  guildId: string | null;
  autoRespond: boolean;
  createdBy: string | null;
  createdAt: Date;
  activatedPersonality: { slug: string; displayName: string | null } | null;
}

/** Activation response type */
interface ActivationResponse {
  activation: {
    id: string;
    channelId: string;
    guildId: string | null;
    personalitySlug: string | null;
    personalityName: string | null;
    autoRespond: boolean;
    activatedBy: string | null;
    createdAt: string;
  };
  replaced: boolean;
}

/**
 * Build activation response from channel settings
 */
function buildActivationResponse(
  settings: ChannelSettingsResult,
  wasReplaced: boolean
): ActivationResponse {
  const response: ActivationResponse = {
    activation: {
      id: settings.id,
      channelId: settings.channelId,
      guildId: settings.guildId,
      personalitySlug: settings.activatedPersonality?.slug ?? null,
      personalityName: settings.activatedPersonality?.displayName ?? null,
      autoRespond: settings.autoRespond,
      activatedBy: settings.createdBy,
      createdAt: settings.createdAt.toISOString(),
    },
    replaced: wasReplaced,
  };

  // Validate response matches schema
  ActivateChannelResponseSchema.parse(response);
  return response;
}

/**
 * Create handler for POST /user/channel/activate
 * Activates a personality in a channel. Replaces any existing activation.
 */
export function createActivateHandler(prisma: PrismaClient): RequestHandler[] {
  const handler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;

    // Validate request body
    const parseResult = ActivateChannelRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map(e => e.message).join(', ');
      sendError(res, ErrorResponses.validationError(errorMessage));
      return;
    }

    const { channelId, personalitySlug, guildId } = parseResult.data;

    // Look up personality by slug
    const personality = await prisma.personality.findUnique({
      where: { slug: personalitySlug },
      select: { id: true, displayName: true, isPublic: true, ownerId: true },
    });

    if (personality === null) {
      sendError(res, ErrorResponses.notFound(`Personality "${personalitySlug}"`));
      return;
    }

    // Get or create internal user and check access
    const user = await getOrCreateInternalUser(prisma, discordUserId);
    const canView = await canUserViewPersonality({
      prisma,
      userId: user.id,
      personalityId: personality.id,
      isPublic: personality.isPublic,
      ownerId: personality.ownerId,
      discordUserId,
    });

    if (!canView) {
      sendError(res, ErrorResponses.unauthorized('You do not have access to this personality'));
      return;
    }

    // Check for existing settings to determine if we're replacing
    const existingSettings = await prisma.channelSettings.findUnique({
      where: { channelId },
      select: { activatedPersonalityId: true },
    });
    const wasReplaced =
      existingSettings !== null && existingSettings.activatedPersonalityId !== personality.id;

    // Upsert channel settings (create or update)
    const settings = await prisma.channelSettings.upsert({
      where: { channelId },
      create: {
        id: generateChannelSettingsUuid(channelId),
        channelId,
        guildId,
        activatedPersonalityId: personality.id,
        autoRespond: true,
        createdBy: user.id,
      },
      update: { activatedPersonalityId: personality.id, guildId },
      select: {
        id: true,
        channelId: true,
        guildId: true,
        autoRespond: true,
        createdBy: true,
        createdAt: true,
        activatedPersonality: { select: { slug: true, displayName: true } },
      },
    });

    logger.info(
      { discordUserId, channelId, personalitySlug, replaced: wasReplaced },
      '[Channel] Activated personality in channel'
    );

    sendCustomSuccess(res, buildActivationResponse(settings, wasReplaced), StatusCodes.CREATED);
  });

  return [requireUserAuth(), handler];
}
