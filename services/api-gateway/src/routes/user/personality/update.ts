/**
 * PUT /user/personality/:slug
 * Update an owned personality
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  type PrismaClient,
  type CacheInvalidationService,
} from '@tzurot/common-types';
import { Prisma } from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { optimizeAvatar } from '../../../utils/imageProcessor.js';
import { deleteAvatarFile } from '../../../utils/avatarPaths.js';
import type { AuthenticatedRequest } from '../../../types.js';
import { canUserEditPersonality } from './helpers.js';

const logger = createLogger('user-personality-update');

interface UpdatePersonalityBody {
  name?: string;
  displayName?: string | null;
  characterInfo?: string;
  personalityTraits?: string;
  personalityTone?: string | null;
  personalityAge?: string | null;
  personalityAppearance?: string | null;
  personalityLikes?: string | null;
  personalityDislikes?: string | null;
  conversationalGoals?: string | null;
  conversationalExamples?: string | null;
  errorMessage?: string | null;
  avatarData?: string;
  /** Extended context tri-state: null=auto, true=on, false=off */
  extendedContext?: boolean | null;
  /** Max messages for extended context (null = follow channel/global) */
  extendedContextMaxMessages?: number | null;
  /** Max age in seconds for extended context (null = follow channel/global) */
  extendedContextMaxAge?: number | null;
  /** Max images for extended context (null = follow channel/global) */
  extendedContextMaxImages?: number | null;
}

/**
 * Create handler for PUT /user/personality/:slug
 * Update an owned personality
 */
export function createUpdateHandler(
  prisma: PrismaClient,
  cacheInvalidationService?: CacheInvalidationService
): RequestHandler[] {
  const handler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const { slug } = req.params;

    // Get user
    const user = await prisma.user.findFirst({
      where: { discordId: discordUserId },
      select: { id: true },
    });

    if (user === null) {
      return sendError(res, ErrorResponses.unauthorized('User not found'));
    }

    // Find personality (include name for displayName defaulting)
    const personality = await prisma.personality.findUnique({
      where: { slug },
      select: { id: true, ownerId: true, name: true },
    });

    if (personality === null) {
      return sendError(res, ErrorResponses.notFound('Personality not found'));
    }

    // Check ownership (bot owner can edit any personality)
    const canEdit = await canUserEditPersonality(prisma, user.id, personality.id, discordUserId);
    if (!canEdit) {
      return sendError(
        res,
        ErrorResponses.unauthorized('You do not have permission to edit this personality')
      );
    }

    const {
      name,
      displayName,
      characterInfo,
      personalityTraits,
      personalityTone,
      personalityAge,
      personalityAppearance,
      personalityLikes,
      personalityDislikes,
      conversationalGoals,
      conversationalExamples,
      errorMessage,
      avatarData,
      extendedContext,
      extendedContextMaxMessages,
      extendedContextMaxAge,
      extendedContextMaxImages,
    } = req.body as UpdatePersonalityBody;

    // Build update data (only include fields that were provided)
    const updateData: Prisma.PersonalityUpdateInput = {};

    if (name !== undefined) {
      updateData.name = name;
      // If name changes but displayName wasn't provided, update displayName to match
      // (preserves behavior where name and displayName stay in sync by default)
      if (displayName === undefined) {
        updateData.displayName = name;
      }
    }
    // Only update displayName if explicitly provided in the request
    // This prevents avatar-only updates from overwriting Unicode displayNames
    if (displayName !== undefined) {
      // If displayName is explicitly set to null/empty, fall back to name
      const hasDisplayName = displayName !== null && displayName !== '';
      updateData.displayName = hasDisplayName ? displayName : (name ?? personality.name);
    }
    if (characterInfo !== undefined) {
      updateData.characterInfo = characterInfo;
    }
    if (personalityTraits !== undefined) {
      updateData.personalityTraits = personalityTraits;
    }
    if (personalityTone !== undefined) {
      updateData.personalityTone = personalityTone;
    }
    if (personalityAge !== undefined) {
      updateData.personalityAge = personalityAge;
    }
    if (personalityAppearance !== undefined) {
      updateData.personalityAppearance = personalityAppearance;
    }
    if (personalityLikes !== undefined) {
      updateData.personalityLikes = personalityLikes;
    }
    if (personalityDislikes !== undefined) {
      updateData.personalityDislikes = personalityDislikes;
    }
    if (conversationalGoals !== undefined) {
      updateData.conversationalGoals = conversationalGoals;
    }
    if (conversationalExamples !== undefined) {
      updateData.conversationalExamples = conversationalExamples;
    }
    if (errorMessage !== undefined) {
      updateData.errorMessage = errorMessage;
    }
    if (extendedContext !== undefined) {
      updateData.extendedContext = extendedContext;
    }
    if (extendedContextMaxMessages !== undefined) {
      updateData.extendedContextMaxMessages = extendedContextMaxMessages;
    }
    if (extendedContextMaxAge !== undefined) {
      updateData.extendedContextMaxAge = extendedContextMaxAge;
    }
    if (extendedContextMaxImages !== undefined) {
      updateData.extendedContextMaxImages = extendedContextMaxImages;
    }

    // Process avatar if provided
    const avatarWasUpdated = avatarData !== undefined && avatarData.length > 0;
    if (avatarWasUpdated) {
      try {
        const result = await optimizeAvatar(avatarData);
        updateData.avatarData = new Uint8Array(result.buffer);
      } catch (error) {
        logger.error({ err: error }, '[User] Failed to process avatar');
        return sendError(res, ErrorResponses.processingError('Failed to process avatar image.'));
      }
    }

    // Update personality - select ALL fields needed for dashboard refresh
    const updated = await prisma.personality.update({
      where: { id: personality.id },
      data: updateData,
      select: {
        id: true,
        name: true,
        slug: true,
        displayName: true,
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
        extendedContextMaxMessages: true,
        extendedContextMaxAge: true,
        extendedContextMaxImages: true,
        ownerId: true,
        avatarData: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // If avatar was updated, invalidate caches
    if (avatarWasUpdated) {
      // 1. Delete filesystem cache (avatars are cached at /data/avatars/<slug>.png)
      await deleteAvatarFile(slug, 'User avatar update');

      // 2. Invalidate in-memory personality cache across all services
      if (cacheInvalidationService) {
        try {
          await cacheInvalidationService.invalidatePersonality(personality.id);
          logger.info(
            { personalityId: personality.id },
            '[User] Invalidated personality cache after avatar update'
          );
        } catch (error) {
          // Log but don't fail the request - cache will expire via TTL
          logger.warn(
            { err: error, personalityId: personality.id },
            '[User] Failed to invalidate personality cache'
          );
        }
      }
    }

    logger.info(
      { discordUserId, slug, personalityId: personality.id, avatarUpdated: avatarWasUpdated },
      '[User] Updated personality'
    );

    // Return full personality data for dashboard refresh
    sendCustomSuccess(
      res,
      {
        success: true,
        personality: {
          id: updated.id,
          name: updated.name,
          slug: updated.slug,
          displayName: updated.displayName,
          characterInfo: updated.characterInfo,
          personalityTraits: updated.personalityTraits,
          personalityTone: updated.personalityTone,
          personalityAge: updated.personalityAge,
          personalityAppearance: updated.personalityAppearance,
          personalityLikes: updated.personalityLikes,
          personalityDislikes: updated.personalityDislikes,
          conversationalGoals: updated.conversationalGoals,
          conversationalExamples: updated.conversationalExamples,
          errorMessage: updated.errorMessage,
          birthMonth: updated.birthMonth,
          birthDay: updated.birthDay,
          birthYear: updated.birthYear,
          isPublic: updated.isPublic,
          voiceEnabled: updated.voiceEnabled,
          imageEnabled: updated.imageEnabled,
          extendedContext: updated.extendedContext,
          extendedContextMaxMessages: updated.extendedContextMaxMessages,
          extendedContextMaxAge: updated.extendedContextMaxAge,
          extendedContextMaxImages: updated.extendedContextMaxImages,
          ownerId: updated.ownerId,
          hasAvatar: updated.avatarData !== null,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        },
      },
      StatusCodes.OK
    );
  });

  return [requireUserAuth(), handler];
}
