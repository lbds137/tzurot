/**
 * Personality Route Helpers
 * Shared utility functions for personality CRUD operations
 */

import { type PrismaClient, isBotOwner } from '@tzurot/common-types';

/**
 * Get or create internal user from Discord ID
 */
export async function getOrCreateInternalUser(
  prisma: PrismaClient,
  discordUserId: string
): Promise<{ id: string }> {
  let user = await prisma.user.findFirst({
    where: { discordId: discordUserId },
    select: { id: true },
  });

  // Create user if they don't exist
  user ??= await prisma.user.create({
    data: {
      discordId: discordUserId,
      username: discordUserId, // Placeholder - will be updated on next Discord interaction
    },
    select: { id: true },
  });

  return user;
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
 * Check if user has view access to a personality
 * Access is granted if:
 * - User is bot owner (admin bypass)
 * - Personality is public
 * - User owns the personality directly
 * - User is in PersonalityOwner table
 */
export async function canUserViewPersonality(
  prisma: PrismaClient,
  userId: string | null,
  personalityId: string,
  isPublic: boolean,
  ownerId: string | null,
  discordUserId: string
): Promise<boolean> {
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
