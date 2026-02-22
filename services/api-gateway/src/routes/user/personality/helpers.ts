/**
 * Personality Route Helpers
 * Shared utility functions for personality CRUD operations
 */

import type { Response } from 'express';
import { Prisma, type PrismaClient, isBotOwner } from '@tzurot/common-types';
import { sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';

// Re-export from canonical shared location
export { getOrCreateInternalUser } from '../userHelpers.js';

/**
 * Options for checking if user can view a personality
 */
interface CanUserViewPersonalityOptions {
  /** Prisma client instance */
  prisma: PrismaClient;
  /** Internal database user ID (null if not found) */
  userId: string | null;
  /** Personality ID to check */
  personalityId: string;
  /** Whether the personality is public */
  isPublic: boolean;
  /** Owner ID of the personality */
  ownerId: string;
  /** Discord user ID (for bot owner check) */
  discordUserId: string;
}

/**
 * Check if user can edit a personality (owns it directly or via PersonalityOwner)
 * Bot owner can edit any personality.
 *
 * @param prisma - Prisma client
 * @param userId - Internal database user ID
 * @param personalityId - Personality ID to check
 * @param discordUserId - Discord user ID (for bot owner check)
 */
export async function canUserEditPersonality(
  prisma: PrismaClient,
  userId: string,
  personalityId: string,
  discordUserId?: string
): Promise<boolean> {
  // Bot owner bypass - can edit any personality
  if (discordUserId !== undefined && isBotOwner(discordUserId)) {
    return true;
  }

  // Single query to check both direct ownership and PersonalityOwner table
  const personality = await prisma.personality.findUnique({
    where: { id: personalityId },
    select: { ownerId: true },
    // Note: We can't nest relations in select, so we do a separate check
  });

  if (personality === null) {
    return false;
  }

  // Check direct ownership first (most common case)
  if (personality.ownerId === userId) {
    return true;
  }

  // Check PersonalityOwner table for co-ownership
  const ownerEntry = await prisma.personalityOwner.findUnique({
    where: {
      personalityId_userId: {
        personalityId,
        userId,
      },
    },
  });

  return ownerEntry !== null;
}

/**
 * Look up the internal user ID for a Discord user.
 * Returns the user ID or null if not found.
 *
 * Extracted from personality route handlers to reduce duplication.
 */
export async function findInternalUser(
  prisma: PrismaClient,
  discordUserId: string
): Promise<{ id: string } | null> {
  return prisma.user.findFirst({
    where: { discordId: discordUserId },
    select: { id: true },
  });
}

/**
 * Check if user has view access to a personality
 * Access is granted if:
 * - User is bot owner (admin bypass)
 * - Personality is public
 * - User owns the personality directly
 * - User is in PersonalityOwner table
 */
export async function canUserViewPersonality(
  options: CanUserViewPersonalityOptions
): Promise<boolean> {
  const { prisma, userId, personalityId, isPublic, ownerId, discordUserId } = options;

  // Bot owner can view any personality
  if (isBotOwner(discordUserId)) {
    return true;
  }

  // Public personalities are viewable by everyone
  if (isPublic) {
    return true;
  }

  // User must exist and be owner
  if (userId === null) {
    return false;
  }

  // Check direct ownership
  if (ownerId === userId) {
    return true;
  }

  // Check PersonalityOwner table
  const ownerEntry = await prisma.personalityOwner.findUnique({
    where: {
      personalityId_userId: {
        personalityId,
        userId,
      },
    },
  });

  return ownerEntry !== null;
}

/**
 * Look up user, personality by slug, and verify edit permission.
 * Sends appropriate error responses and returns null if any check fails.
 *
 * Callers specify a Prisma select clause; the result personality is cast to T.
 */
export async function resolvePersonalityForEdit<T extends { id: string; ownerId: string }>(
  prisma: PrismaClient,
  slug: string,
  discordUserId: string,
  res: Response,
  select: Prisma.PersonalitySelect
): Promise<{ user: { id: string }; personality: T } | null> {
  const user = await findInternalUser(prisma, discordUserId);
  if (user === null) {
    sendError(res, ErrorResponses.unauthorized('User not found'));
    return null;
  }

  const personality = await prisma.personality.findUnique({ where: { slug }, select });
  if (personality === null) {
    sendError(res, ErrorResponses.notFound('Personality'));
    return null;
  }

  const canEdit = await canUserEditPersonality(
    prisma,
    user.id,
    (personality as { id: string }).id,
    discordUserId
  );
  if (!canEdit) {
    sendError(
      res,
      ErrorResponses.unauthorized('You do not have permission to edit this personality')
    );
    return null;
  }

  // Cast through unknown: Prisma's full model type doesn't structurally overlap with T,
  // but the select clause ensures only the requested fields are present at runtime.
  return { user, personality: personality as unknown as T };
}
