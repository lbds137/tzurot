/**
 * DELETE /user/personality/:slug
 * Delete a personality and all associated data (owned personalities only)
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  type PrismaClient,
  type CacheInvalidationService,
  DeletePersonalityResponseSchema,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { deleteAllAvatarVersions } from '../../../utils/avatarPaths.js';
import type { AuthenticatedRequest } from '../../../types.js';
import { getParam } from '../../../utils/requestParams.js';
import { canUserEditPersonality } from './helpers.js';

const logger = createLogger('user-personality-delete');

// --- Helper Functions ---

async function deletePendingMemories(
  prisma: PrismaClient,
  personalityId: string,
  count: number
): Promise<void> {
  if (count > 0) {
    await prisma.pendingMemory.deleteMany({ where: { personalityId } });
    logger.debug({ personalityId, count }, '[Personality] Deleted PendingMemory records');
  }
}

async function invalidateCacheSafely(
  cacheInvalidationService: CacheInvalidationService | undefined,
  personalityId: string
): Promise<void> {
  if (!cacheInvalidationService) {
    return;
  }

  try {
    await cacheInvalidationService.invalidatePersonality(personalityId);
    logger.debug({ personalityId }, '[Personality] Invalidated cache after deletion');
  } catch (error) {
    logger.warn({ err: error, personalityId }, '[Personality] Failed to invalidate cache');
  }
}

// --- Handler Factory ---

function createHandler(prisma: PrismaClient, cacheInvalidationService?: CacheInvalidationService) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const slug = getParam(req.params.slug);
    if (slug === undefined || slug === '') {
      return sendError(res, ErrorResponses.validationError('slug is required'));
    }

    const user = await prisma.user.findFirst({
      where: { discordId: discordUserId },
      select: { id: true },
    });

    if (user === null) {
      return sendError(res, ErrorResponses.unauthorized('User not found'));
    }

    const personality = await prisma.personality.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        ownerId: true,
        _count: {
          select: {
            conversationHistory: true,
            memories: true,
            channelSettings: true,
            aliases: true,
          },
        },
      },
    });

    if (personality === null) {
      return sendError(res, ErrorResponses.notFound('Personality not found'));
    }

    const canDelete = await canUserEditPersonality(prisma, user.id, personality.id, discordUserId);
    if (!canDelete) {
      return sendError(
        res,
        ErrorResponses.unauthorized('You do not have permission to delete this personality')
      );
    }

    const pendingMemoryCount = await prisma.pendingMemory.count({
      where: { personalityId: personality.id },
    });

    const counts = personality._count as {
      conversationHistory: number;
      memories: number;
      channelSettings: number;
      aliases: number;
    };
    const deletedCounts = {
      conversationHistory: counts.conversationHistory,
      memories: counts.memories,
      pendingMemories: pendingMemoryCount,
      channelSettings: counts.channelSettings,
      aliases: counts.aliases,
    };

    logger.info(
      { discordUserId, slug, personalityId: personality.id, deletedCounts },
      '[Personality] Starting deletion'
    );

    await deletePendingMemories(prisma, personality.id, pendingMemoryCount);
    await prisma.personality.delete({ where: { id: personality.id } });
    await deleteAllAvatarVersions(slug, 'Personality delete');
    await invalidateCacheSafely(cacheInvalidationService, personality.id);

    logger.info(
      { discordUserId, slug, deletedCounts },
      '[Personality] Successfully deleted personality and all related data'
    );

    const validated = DeletePersonalityResponseSchema.parse({
      success: true as const,
      deletedSlug: slug,
      deletedName: personality.name,
      deletedCounts,
    });
    sendCustomSuccess(res, validated, StatusCodes.OK);
  };
}

// --- Route Factory ---

export function createDeleteHandler(
  prisma: PrismaClient,
  cacheInvalidationService?: CacheInvalidationService
): RequestHandler[] {
  return [requireUserAuth(), asyncHandler(createHandler(prisma, cacheInvalidationService))];
}
