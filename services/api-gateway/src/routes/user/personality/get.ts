/**
 * GET /user/personality/:slug
 * Get a single personality by slug (if visible to user)
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger, type PrismaClient, isBotOwner } from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import type { AuthenticatedRequest } from '../../../types.js';
import { canUserEditPersonality } from './helpers.js';

const logger = createLogger('user-personality-get');

/**
 * Create handler for GET /user/personality/:slug
 * Get a single personality by slug (if visible to user)
 */
export function createGetHandler(prisma: PrismaClient): RequestHandler[] {
  const handler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const { slug } = req.params;

    // Get user's internal ID
    const user = await prisma.user.findFirst({
      where: { discordId: discordUserId },
      select: { id: true },
    });

    // Find personality
    const personality = await prisma.personality.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        displayName: true,
        slug: true,
        characterInfo: true,
        personalityTraits: true,
        personalityTone: true,
        personalityAge: true,
        personalityAppearance: true,
        personalityLikes: true,
        personalityDislikes: true,
        conversationalGoals: true,
        conversationalExamples: true,
        errorMessage: true,
        birthMonth: true,
        birthDay: true,
        birthYear: true,
        isPublic: true,
        voiceEnabled: true,
        imageEnabled: true,
        extendedContext: true,
        ownerId: true,
        avatarData: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (personality === null) {
      return sendError(res, ErrorResponses.notFound('Personality not found'));
    }

    // Check if user can view this personality
    // Bot owner can view any personality
    const isAdmin = isBotOwner(discordUserId);
    const isOwner = user !== null && personality.ownerId === user.id;
    let hasAccess = isAdmin || personality.isPublic || isOwner;

    // Check PersonalityOwner table if not already accessible
    if (!hasAccess && user !== null) {
      const ownerEntry = await prisma.personalityOwner.findUnique({
        where: {
          personalityId_userId: {
            personalityId: personality.id,
            userId: user.id,
          },
        },
      });
      hasAccess = ownerEntry !== null;
    }

    if (!hasAccess) {
      return sendError(
        res,
        ErrorResponses.unauthorized('You do not have access to this personality')
      );
    }

    // Return personality data
    const canEdit =
      user !== null &&
      (await canUserEditPersonality(prisma, user.id, personality.id, discordUserId));

    logger.info({ discordUserId, slug, canEdit }, '[Personality] Retrieved personality');

    sendCustomSuccess(
      res,
      {
        personality: {
          id: personality.id,
          name: personality.name,
          displayName: personality.displayName,
          slug: personality.slug,
          characterInfo: personality.characterInfo,
          personalityTraits: personality.personalityTraits,
          personalityTone: personality.personalityTone,
          personalityAge: personality.personalityAge,
          personalityAppearance: personality.personalityAppearance,
          personalityLikes: personality.personalityLikes,
          personalityDislikes: personality.personalityDislikes,
          conversationalGoals: personality.conversationalGoals,
          conversationalExamples: personality.conversationalExamples,
          errorMessage: personality.errorMessage,
          birthMonth: personality.birthMonth,
          birthDay: personality.birthDay,
          birthYear: personality.birthYear,
          isPublic: personality.isPublic,
          voiceEnabled: personality.voiceEnabled,
          imageEnabled: personality.imageEnabled,
          extendedContext: personality.extendedContext,
          ownerId: personality.ownerId,
          hasAvatar: personality.avatarData !== null,
          createdAt: personality.createdAt.toISOString(),
          updatedAt: personality.updatedAt.toISOString(),
        },
        canEdit,
      },
      StatusCodes.OK
    );
  });

  return [requireUserAuth(), handler];
}
