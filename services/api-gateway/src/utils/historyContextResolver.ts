/**
 * History Context Resolver
 * Resolves user, personality, and persona context for history operations.
 */

import { createLogger, type PrismaClient, PersonaResolver } from '@tzurot/common-types';

const logger = createLogger('history-context');

interface HistoryContext {
  userId: string;
  personalityId: string;
  personaId: string;
  personaName: string;
}

/**
 * Resolves history context from Discord user ID and personality slug.
 * Returns user, personality, and persona IDs for history operations.
 *
 * @param prisma - Prisma client
 * @param discordUserId - Discord user ID
 * @param personalitySlug - Personality slug
 * @param explicitPersonaId - Optional explicit persona ID (overrides resolution)
 * @returns History context or null if not found
 */
export async function resolveHistoryContext(
  prisma: PrismaClient,
  discordUserId: string,
  personalitySlug: string,
  explicitPersonaId?: string
): Promise<HistoryContext | null> {
  // Find user
  const user = await prisma.user.findFirst({
    where: { discordId: discordUserId },
  });

  if (!user) {
    return null;
  }

  // Find personality by slug
  const personality = await prisma.personality.findUnique({
    where: { slug: personalitySlug },
  });

  if (!personality) {
    return null;
  }

  // Resolve persona: use explicit ID or resolve via PersonaResolver
  let personaId: string;
  let personaName: string;
  if (
    explicitPersonaId !== undefined &&
    explicitPersonaId !== null &&
    explicitPersonaId.length > 0
  ) {
    // Verify the persona exists and belongs to this user
    const persona = await prisma.persona.findFirst({
      where: {
        id: explicitPersonaId,
        ownerId: user.id,
      },
    });
    if (!persona) {
      logger.warn(
        { discordUserId, explicitPersonaId },
        '[History] Explicit persona not found or not owned by user'
      );
      return null;
    }
    personaId = explicitPersonaId;
    personaName = persona.name;
  } else {
    // Resolve persona using the resolver (considers personality override + user default)
    const personaResolver = new PersonaResolver(prisma);
    const resolved = await personaResolver.resolve(discordUserId, personality.id);
    if (resolved.source === 'system-default' || !resolved.config.personaId) {
      logger.warn({ discordUserId }, '[History] No persona found for user');
      return null;
    }
    personaId = resolved.config.personaId;
    personaName = resolved.config.personaName ?? 'Unknown';
  }

  return {
    userId: user.id,
    personalityId: personality.id,
    personaId,
    personaName,
  };
}
