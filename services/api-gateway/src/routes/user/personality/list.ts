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
  computePersonalityPermissions,
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
  ownerId: string;
  isPublic: boolean;
  owner: { discordId: string };
}

/**
 * Convert raw personality to PersonalitySummary
 *
 * @param p - Raw personality from database
 * @param requestingUserId - Internal user ID of the requester (null if not in DB)
 * @param discordUserId - Discord ID of the requester (for admin check)
 */
function toSummary(
  p: RawPersonality,
  requestingUserId: string | null,
  discordUserId: string
): PersonalitySummary {
  // isOwned is truthful: did this user create the personality?
  const isOwned = requestingUserId !== null && p.ownerId === requestingUserId;

  return {
    id: p.id,
    name: p.name,
    displayName: p.displayName,
    slug: p.slug,
    isOwned,
    isPublic: p.isPublic,
    ownerId: p.ownerId,
    ownerDiscordId: p.owner.discordId,
    permissions: computePersonalityPermissions(p.ownerId, requestingUserId, discordUserId),
  };
}

/**
 * Fetch all personalities for admin user
 * Admin sees all personalities with correct isOwned (truthful) but canEdit: true
 */
async function fetchAdminPersonalities(
  prisma: PrismaClient,
  requestingUserId: string | null,
  discordUserId: string
): Promise<PersonalitySummary[]> {
  const all = await prisma.personality.findMany({
    select: PERSONALITY_SELECT,
    orderBy: { name: 'asc' },
    take: 500, // Bounded query - Discord autocomplete shows max 25 anyway
  });
  return all.map(p => toSummary(p, requestingUserId, discordUserId));
}

/**
 * Fetch personalities visible to regular user
 */
async function fetchUserPersonalities(
  prisma: PrismaClient,
  userId: string | undefined,
  discordUserId: string
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
    ...publicPersonalities.map(p => toSummary(p, userId ?? null, discordUserId)),
    // Add user-owned private personalities that aren't already in the public list
    ...userOwnedPersonalities
      .filter(p => !publicIds.has(p.id))
      .map(p => toSummary(p, userId ?? null, discordUserId)),
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
      const personalities = await fetchAdminPersonalities(prisma, user?.id ?? null, discordUserId);
      logger.info(
        { discordUserId, isAdmin: true, totalCount: personalities.length },
        '[Personality] Listed all personalities (admin)'
      );
      return sendCustomSuccess(res, { personalities }, StatusCodes.OK);
    }

    const personalities = await fetchUserPersonalities(prisma, user?.id, discordUserId);
    logger.info(
      { discordUserId, totalCount: personalities.length },
      '[Personality] Listed personalities'
    );
    sendCustomSuccess(res, { personalities }, StatusCodes.OK);
  });

  return [requireUserAuth(), handler];
}
