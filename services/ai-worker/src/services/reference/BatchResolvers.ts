/**
 * BatchResolvers - Batch database resolution for user references.
 *
 * Resolves multiple user IDs in single database queries to avoid N+1 patterns.
 * Supports three lookup strategies: shapes.inc user IDs, Discord IDs, and usernames.
 *
 * Extracted from UserReferenceResolver to reduce file size.
 */

import type { PrismaClient } from '@tzurot/common-types';
import { createLogger } from '@tzurot/common-types';
import type { ResolvedPersona } from './UserReferencePatterns.js';

const logger = createLogger('UserReferenceResolver');

/**
 * Batch resolve personas by shapes.inc user IDs
 *
 * Looks up multiple shapes user IDs in a single query and returns a map.
 */
export async function batchResolveByShapesUserIds(
  prisma: PrismaClient,
  shapesUserIds: string[]
): Promise<Map<string, ResolvedPersona>> {
  const result = new Map<string, ResolvedPersona>();
  if (shapesUserIds.length === 0) {
    return result;
  }

  try {
    const mappings = await prisma.shapesPersonaMapping.findMany({
      where: { shapesUserId: { in: shapesUserIds } },
      include: {
        persona: {
          select: {
            id: true,
            name: true,
            preferredName: true,
            pronouns: true,
            content: true,
          },
        },
      },
      take: shapesUserIds.length, // Bounded by input size
    });

    for (const mapping of mappings) {
      if (mapping.persona !== null) {
        result.set(mapping.shapesUserId, {
          personaId: mapping.persona.id,
          personaName: mapping.persona.preferredName ?? mapping.persona.name,
          preferredName: mapping.persona.preferredName,
          pronouns: mapping.persona.pronouns,
          content: mapping.persona.content ?? '',
        });
      }
    }
  } catch (error) {
    logger.error(
      { err: error, count: shapesUserIds.length },
      '[UserReferenceResolver] Error batch resolving shapes user IDs'
    );
  }

  return result;
}

/**
 * Batch resolve personas by Discord user IDs
 *
 * Looks up multiple Discord user IDs in a single query and returns a map.
 */
export async function batchResolveByDiscordIds(
  prisma: PrismaClient,
  discordIds: string[]
): Promise<Map<string, ResolvedPersona>> {
  const result = new Map<string, ResolvedPersona>();
  if (discordIds.length === 0) {
    return result;
  }

  try {
    const users = await prisma.user.findMany({
      where: { discordId: { in: discordIds } },
      include: {
        defaultPersona: {
          select: {
            id: true,
            name: true,
            preferredName: true,
            pronouns: true,
            content: true,
          },
        },
      },
      take: discordIds.length, // Bounded by input size
    });

    for (const user of users) {
      if (user.defaultPersona !== null) {
        result.set(user.discordId, {
          personaId: user.defaultPersona.id,
          personaName: user.defaultPersona.preferredName ?? user.defaultPersona.name,
          preferredName: user.defaultPersona.preferredName,
          pronouns: user.defaultPersona.pronouns,
          content: user.defaultPersona.content ?? '',
        });
      }
    }
  } catch (error) {
    logger.error(
      { err: error, count: discordIds.length },
      '[UserReferenceResolver] Error batch resolving Discord IDs'
    );
  }

  return result;
}

/**
 * Batch resolve personas by usernames
 *
 * Looks up multiple usernames in a single query and returns a map.
 * Uses case-insensitive matching. For duplicate case-insensitive matches,
 * keeps the first (oldest) user for consistency.
 */
export async function batchResolveByUsernames(
  prisma: PrismaClient,
  usernames: string[]
): Promise<Map<string, ResolvedPersona>> {
  const result = new Map<string, ResolvedPersona>();
  if (usernames.length === 0) {
    return result;
  }

  try {
    // For case-insensitive batch lookup, use OR conditions for each username
    const users = await prisma.user.findMany({
      where: {
        OR: usernames.map(username => ({
          username: { equals: username, mode: 'insensitive' as const },
        })),
      },
      include: {
        defaultPersona: {
          select: {
            id: true,
            name: true,
            preferredName: true,
            pronouns: true,
            content: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(usernames.length * 2, 1000), // Allow buffer for case variants, capped for safety
    });

    // Group by lowercase username to handle case-insensitive matches
    // Keep only the first (oldest) user per case-insensitive username
    const seenUsernames = new Set<string>();

    for (const user of users) {
      const lowerUsername = user.username.toLowerCase();

      // Skip if we already have a match for this case-insensitive username
      if (seenUsernames.has(lowerUsername)) {
        continue;
      }

      if (user.defaultPersona !== null) {
        // Find the original case username from input that matches
        const matchingInput = usernames.find(u => u.toLowerCase() === lowerUsername);
        if (matchingInput !== undefined) {
          seenUsernames.add(lowerUsername);
          result.set(matchingInput, {
            personaId: user.defaultPersona.id,
            personaName: user.defaultPersona.preferredName ?? user.defaultPersona.name,
            preferredName: user.defaultPersona.preferredName,
            pronouns: user.defaultPersona.pronouns,
            content: user.defaultPersona.content ?? '',
          });
        }
      }
    }
  } catch (error) {
    logger.error(
      { err: error, count: usernames.length },
      '[UserReferenceResolver] Error batch resolving usernames'
    );
  }

  return result;
}
