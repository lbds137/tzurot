/**
 * Personality Route Helpers
 * Shared utility functions for personality CRUD operations
 */

import { UserService, type PrismaClient, isBotOwner } from '@tzurot/common-types';

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
 * Get or create internal user from Discord ID
 * Uses centralized UserService to ensure users always get default personas
 */
export async function getOrCreateInternalUser(
  prisma: PrismaClient,
  discordUserId: string
): Promise<{ id: string }> {
  const userService = new UserService(prisma);

  // Use centralized UserService - creates shell user with default persona if needed
  const userId = await userService.getOrCreateUser(discordUserId, discordUserId);

  // Bots should not reach here via slash commands, but handle defensively
  if (userId === null) {
    throw new Error('Cannot create user for bot');
  }

  return { id: userId };
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
