/**
 * Shared user helpers for all user route modules
 *
 * Consolidates getOrCreateInternalUser from persona/helpers.ts and
 * personality/helpers.ts into a single canonical implementation.
 */

import { UserService, type PrismaClient } from '@tzurot/common-types';

/**
 * Get or create internal user from Discord ID.
 * Uses centralized UserService to ensure users always get default personas.
 *
 * Returns both `id` and `defaultPersonaId` — callers that don't need
 * defaultPersonaId simply ignore it (TypeScript structural typing allows this).
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
