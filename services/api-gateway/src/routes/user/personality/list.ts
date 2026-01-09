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

/** Prisma select clause for personality queries */
const PERSONALITY_SELECT = {
  id: true,
  name: true,
  displayName: true,
  slug: true,
  ownerId: true,
  isPublic: true,
  owner: { select: { discordId: true } },
} as const;

/** Raw personality from database query */
interface RawPersonality {
  id: string;
  name: string;
  displayName: string | null;
  slug: string;
  ownerId: string | null;
  isPublic: boolean;
  owner: { discordId: string } | null;
}

/**
 * Convert raw personality to PersonalitySummary
 */
function toSummary(p: RawPersonality, isOwned: boolean): PersonalitySummary {
  return {
    id: p.id,
    name: p.name,
    displayName: p.displayName,
    slug: p.slug,
    isOwned,
    isPublic: p.isPublic,
    ownerId: p.ownerId,
    ownerDiscordId: p.owner?.discordId ?? null,
  };
}

/**
 * Fetch all personalities for admin user
 */
async function fetchAdminPersonalities(prisma: PrismaClient): Promise<PersonalitySummary[]> {
  const all = await prisma.personality.findMany({
    select: PERSONALITY_SELECT,
    orderBy: { name: 'asc' },
    take: 500, // Bounded query - Discord autocomplete shows max 25 anyway
  });
  return all.map(p => toSummary(p, true)); // Admin "owns" all
}

/**
 * Fetch personalities visible to regular user
 */
async function fetchUserPersonalities(
  prisma: PrismaClient,
  userId: string | undefined
): Promise<PersonalitySummary[]> {
  // Get public personalities
  const publicPersonalities = await prisma.personality.findMany({
    where: { isPublic: true },
    select: PERSONALITY_SELECT,
    orderBy: { name: 'asc' },
    take: 500, // Bounded query - prevents OOM with large datasets
  });

  // Get user-owned private personalities (if user exists)
  let userOwnedPersonalities: RawPersonality[] = [];

  if (userId !== undefined) {
    const ownedIds = await prisma.personalityOwner.findMany({
      where: { userId },
      select: { personalityId: true },
      take: 100, // Bounded query - users rarely own many personalities
    });

    const ownedIdSet = new Set(ownedIds.map(o => o.personalityId));

    userOwnedPersonalities = await prisma.personality.findMany({
      where: {
        isPublic: false,
        OR: [{ ownerId: userId }, { id: { in: Array.from(ownedIdSet) } }],
      },
      select: PERSONALITY_SELECT,
      orderBy: { name: 'asc' },
      take: 100, // Bounded query - users rarely own many private personalities
    });
  }

  // Combine and format results
  const publicIds = new Set(publicPersonalities.map(p => p.id));

  return [
    ...publicPersonalities.map(p => toSummary(p, p.ownerId === userId)),
    // Add user-owned private personalities that aren't already in the public list
    ...userOwnedPersonalities.filter(p => !publicIds.has(p.id)).map(p => toSummary(p, true)),
  ];
}

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

    if (isAdmin) {
      const personalities = await fetchAdminPersonalities(prisma);
      logger.info(
        { discordUserId, isAdmin: true, totalCount: personalities.length },
        '[Personality] Listed all personalities (admin)'
      );
      return sendCustomSuccess(res, { personalities }, StatusCodes.OK);
    }

    const personalities = await fetchUserPersonalities(prisma, user?.id);
    logger.info(
      { discordUserId, totalCount: personalities.length },
      '[Personality] Listed personalities'
    );
    sendCustomSuccess(res, { personalities }, StatusCodes.OK);
  });

  return [requireUserAuth(), handler];
}
