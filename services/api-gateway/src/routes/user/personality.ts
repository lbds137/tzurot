/**
 * User Personality Routes
 * Read-only operations for personality listings (for autocomplete)
 *
 * Endpoints:
 * - GET /user/personality - List personalities visible to the user
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger, type PrismaClient, type PersonalitySummary } from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendCustomSuccess } from '../../utils/responseHelpers.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('user-personality');

export function createPersonalityRoutes(prisma: PrismaClient): Router {
  const router = Router();

  /**
   * GET /user/personality
   * List all personalities visible to the user
   * - Public personalities (isPublic = true)
   * - User-owned personalities (ownerId = user.id OR PersonalityOwner entry)
   */
  router.get(
    '/',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;

      // Get user's internal ID
      const user = await prisma.user.findFirst({
        where: { discordId: discordUserId },
        select: { id: true },
      });

      // Get public personalities
      const publicPersonalities = await prisma.personality.findMany({
        where: { isPublic: true },
        select: {
          id: true,
          name: true,
          displayName: true,
          slug: true,
          ownerId: true,
        },
        orderBy: { name: 'asc' },
      });

      // Get user-owned private personalities (if user exists)
      let userOwnedPersonalities: typeof publicPersonalities = [];

      if (user !== null) {
        // Get personalities user owns directly or via PersonalityOwner
        const ownedIds = await prisma.personalityOwner.findMany({
          where: { userId: user.id },
          select: { personalityId: true },
        });

        const ownedIdSet = new Set(ownedIds.map(o => o.personalityId));

        userOwnedPersonalities = await prisma.personality.findMany({
          where: {
            isPublic: false,
            OR: [{ ownerId: user.id }, { id: { in: Array.from(ownedIdSet) } }],
          },
          select: {
            id: true,
            name: true,
            displayName: true,
            slug: true,
            ownerId: true,
          },
          orderBy: { name: 'asc' },
        });
      }

      // Combine and format results
      const publicIds = new Set(publicPersonalities.map(p => p.id));
      const userOwnerId = user?.id;

      const personalities: PersonalitySummary[] = [
        ...publicPersonalities.map(p => ({
          id: p.id,
          name: p.name,
          displayName: p.displayName,
          slug: p.slug,
          isOwned: p.ownerId === userOwnerId,
        })),
        // Add user-owned private personalities that aren't already in the public list
        ...userOwnedPersonalities
          .filter(p => !publicIds.has(p.id))
          .map(p => ({
            id: p.id,
            name: p.name,
            displayName: p.displayName,
            slug: p.slug,
            isOwned: true,
          })),
      ];

      logger.info(
        {
          discordUserId,
          publicCount: publicPersonalities.length,
          privateCount: userOwnedPersonalities.length,
          totalCount: personalities.length,
        },
        '[Personality] Listed personalities'
      );

      sendCustomSuccess(res, { personalities }, StatusCodes.OK);
    })
  );

  return router;
}
