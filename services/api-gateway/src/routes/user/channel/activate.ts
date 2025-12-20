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
  generateActivatedChannelUuid,
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
      select: {
        id: true,
        displayName: true,
        isPublic: true,
        ownerId: true,
      },
    });

    if (personality === null) {
      sendError(res, ErrorResponses.notFound(`Personality "${personalitySlug}"`));
      return;
    }

    // Get or create internal user
    const user = await getOrCreateInternalUser(prisma, discordUserId);

    // Check if user can access this personality
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

    // Create new activation with deterministic UUID
    const activationId = generateActivatedChannelUuid(channelId, personality.id);

    // Use transaction to atomically delete existing + create new (prevents race conditions)
    const { activation, replaced } = await prisma.$transaction(async tx => {
      // Check if there's an existing activation for this channel (any personality)
      const existingActivation = await tx.activatedChannel.findFirst({
        where: { channelId },
        select: { id: true, personalityId: true },
      });

      const wasReplaced = existingActivation !== null;

      // If there's an existing activation, delete it first (one personality per channel)
      if (existingActivation !== null) {
        await tx.activatedChannel.delete({
          where: { id: existingActivation.id },
        });
        logger.info(
          { channelId, previousPersonalityId: existingActivation.personalityId },
          '[Channel] Removed previous activation'
        );
      }

      // Create new activation
      const newActivation = await tx.activatedChannel.create({
        data: {
          id: activationId,
          channelId,
          personalityId: personality.id,
          guildId,
          autoRespond: true,
          createdBy: user.id,
        },
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
      });

      return { activation: newActivation, replaced: wasReplaced };
    });

    logger.info(
      {
        discordUserId,
        channelId,
        personalitySlug,
        replaced,
      },
      '[Channel] Activated personality in channel'
    );

    // Build response matching schema
    const response = {
      activation: {
        id: activation.id,
        channelId: activation.channelId,
        guildId: activation.guildId,
        personalitySlug: activation.personality.slug,
        personalityName: activation.personality.displayName,
        activatedBy: activation.createdBy,
        createdAt: activation.createdAt.toISOString(),
      },
      replaced,
    };

    // Validate response matches schema
    ActivateChannelResponseSchema.parse(response);

    sendCustomSuccess(res, response, StatusCodes.CREATED);
  });

  return [requireUserAuth(), handler];
}
