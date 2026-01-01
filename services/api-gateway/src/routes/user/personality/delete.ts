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
import { deleteAvatarFile } from '../../../utils/avatarPaths.js';
import type { AuthenticatedRequest } from '../../../types.js';
import { canUserEditPersonality } from './helpers.js';

const logger = createLogger('user-personality-delete');

/**
 * Create handler for DELETE /user/personality/:slug
 * Delete a personality and all associated data (owned personalities only)
 *
 * This is a destructive operation that:
 * 1. Deletes PendingMemory records manually (no FK cascade)
 * 2. Deletes the personality (Prisma cascades ConversationHistory, Memory, Aliases, etc.)
 * 3. Deletes cached avatar file
 * 4. Invalidates personality cache
 */
export function createDeleteHandler(
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

    // Find personality with data for deletion counts
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
            activatedChannels: true,
            aliases: true,
          },
        },
      },
    });

    if (personality === null) {
      return sendError(res, ErrorResponses.notFound('Personality not found'));
    }

    // Check ownership (bot owner can delete any personality)
    const canDelete = await canUserEditPersonality(prisma, user.id, personality.id, discordUserId);
    if (!canDelete) {
      return sendError(
        res,
        ErrorResponses.unauthorized('You do not have permission to delete this personality')
      );
    }

    // Count PendingMemory records (need manual deletion - no FK cascade)
    const pendingMemoryCount = await prisma.pendingMemory.count({
      where: { personalityId: personality.id },
    });

    // Store counts before deletion
    // Extract _count with explicit type to satisfy ESLint strict type checking
    const personalityCount = personality._count as {
      conversationHistory: number;
      memories: number;
      activatedChannels: number;
      aliases: number;
    };
    const deletedCounts = {
      conversationHistory: personalityCount.conversationHistory,
      memories: personalityCount.memories,
      pendingMemories: pendingMemoryCount,
      activatedChannels: personalityCount.activatedChannels,
      aliases: personalityCount.aliases,
    };

    logger.info(
      {
        discordUserId,
        slug,
        personalityId: personality.id,
        deletedCounts,
      },
      '[Personality] Starting deletion'
    );

    // 1. Delete PendingMemory records first (no FK cascade)
    if (pendingMemoryCount > 0) {
      await prisma.pendingMemory.deleteMany({
        where: { personalityId: personality.id },
      });
      logger.debug(
        { personalityId: personality.id, count: pendingMemoryCount },
        '[Personality] Deleted PendingMemory records'
      );
    }

    // 2. Delete personality (Prisma cascades ConversationHistory, Memory, Aliases, etc.)
    await prisma.personality.delete({
      where: { id: personality.id },
    });

    // 3. Delete cached avatar file
    await deleteAvatarFile(slug, 'Personality delete');

    // 4. Invalidate personality cache
    if (cacheInvalidationService) {
      try {
        await cacheInvalidationService.invalidatePersonality(personality.id);
        logger.debug(
          { personalityId: personality.id },
          '[Personality] Invalidated cache after deletion'
        );
      } catch (error) {
        logger.warn(
          { err: error, personalityId: personality.id },
          '[Personality] Failed to invalidate cache'
        );
      }
    }

    logger.info(
      { discordUserId, slug, deletedCounts },
      '[Personality] Successfully deleted personality and all related data'
    );

    // Build and validate response
    const validated = DeletePersonalityResponseSchema.parse({
      success: true as const,
      deletedSlug: slug,
      deletedName: personality.name,
      deletedCounts,
    });
    sendCustomSuccess(res, validated, StatusCodes.OK);
  });

  return [requireUserAuth(), handler];
}
