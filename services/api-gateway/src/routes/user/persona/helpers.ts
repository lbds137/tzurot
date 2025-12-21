/**
 * Shared helper functions for persona routes
 */

import { UserService, type PrismaClient } from '@tzurot/common-types';

/**
 * Helper to safely extract string from body with trim
 */
export function extractString(value: unknown, allowEmpty = false): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return allowEmpty || trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

/**
 * Get or create internal user from Discord ID
 * Uses centralized UserService to ensure users always get default personas
 */
export async function getOrCreateInternalUser(
  prisma: PrismaClient,
  discordUserId: string
): Promise<{ id: string; defaultPersonaId: string | null }> {
  const userService = new UserService(prisma);

  // Use centralized UserService - creates shell user with default persona if needed
  const userId = await userService.getOrCreateUser(discordUserId, discordUserId);

  // Bots should not reach here via slash commands, but handle defensively
  if (userId === null) {
    throw new Error('Cannot create user for bot');
  }

  // Look up the full user record to get defaultPersonaId
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, defaultPersonaId: true },
  });

  if (user === null) {
    throw new Error('User not found after creation');
  }

  return user;
}
