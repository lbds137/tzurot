/**
 * GET /user/personality
 * List all personalities visible to the user
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  type PrismaClient,
  type PersonalitySummary,
  isBotOwner,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess } from '../../../utils/responseHelpers.js';
import type { AuthenticatedRequest } from '../../../types.js';

const logger = createLogger('user-personality-list');

/**
 * Create handler for GET /user/personality
 * List all personalities visible to the user
 * - Public personalities (isPublic = true)
 * - User-owned personalities (ownerId = user.id OR PersonalityOwner entry)
 */
export function createListHandler(prisma: PrismaClient): RequestHandler[] {
  const handler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const isAdmin = isBotOwner(discordUserId);

    // Get user's internal ID
    const user = await prisma.user.findFirst({
      where: { discordId: discordUserId },
      select: { id: true },
    });

    // Bot owner gets ALL personalities and can edit any of them
    if (isAdmin) {
      const allPersonalities = await prisma.personality.findMany({
        select: {
          id: true,
          name: true,
          displayName: true,
          slug: true,
          ownerId: true,
          isPublic: true,
          owner: {
            select: { discordId: true },
          },
        },
        orderBy: { name: 'asc' },
      });

      const personalities: PersonalitySummary[] = allPersonalities.map(p => ({
        id: p.id,
        name: p.name,
        displayName: p.displayName,
        slug: p.slug,
        isOwned: true, // Bot owner "owns" all for edit/avatar purposes
        isPublic: p.isPublic,
        ownerId: p.ownerId,
        ownerDiscordId: p.owner?.discordId ?? null,
      }));

      logger.info(
        { discordUserId, isAdmin: true, totalCount: personalities.length },
        '[Personality] Listed all personalities (admin)'
      );

      return sendCustomSuccess(res, { personalities }, StatusCodes.OK);
    }

    // Regular user flow
    // Get public personalities (with owner's Discord ID for display)
    const publicPersonalities = await prisma.personality.findMany({
      where: { isPublic: true },
      select: {
        id: true,
        name: true,
        displayName: true,
        slug: true,
        ownerId: true,
        isPublic: true,
        owner: {
          select: { discordId: true },
        },
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
          isPublic: true,
          owner: {
            select: { discordId: true },
          },
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
        isPublic: p.isPublic,
        ownerId: p.ownerId,
        ownerDiscordId: p.owner?.discordId ?? null,
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
          isPublic: p.isPublic,
          ownerId: p.ownerId,
          ownerDiscordId: p.owner?.discordId ?? null,
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
  });

  return [requireUserAuth(), handler];
}
