/**
 * Shared helper functions for persona routes
 */

import type { PrismaClient } from '@tzurot/common-types';

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
 */
export async function getOrCreateInternalUser(
  prisma: PrismaClient,
  discordUserId: string
): Promise<{ id: string; defaultPersonaId: string | null }> {
  let user = await prisma.user.findFirst({
    where: { discordId: discordUserId },
    select: { id: true, defaultPersonaId: true },
  });

  // Create user if they don't exist
  user ??= await prisma.user.create({
    data: {
      discordId: discordUserId,
      username: discordUserId, // Placeholder
    },
    select: { id: true, defaultPersonaId: true },
  });

  return user;
}
