/**
 * Me Command Autocomplete Handler
 * Provides autocomplete suggestions for personality and profile selection
 */

import type { AutocompleteInteraction } from 'discord.js';
import { createLogger, getPrismaClient, DISCORD_LIMITS } from '@tzurot/common-types';

const logger = createLogger('me-autocomplete');

/**
 * Special value for "Create new profile" option in autocomplete
 */
export const CREATE_NEW_PERSONA_VALUE = '__create_new__';

/**
 * Handle personality autocomplete for /me override commands
 */
export async function handlePersonalityAutocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);

  if (focusedOption.name !== 'personality') {
    await interaction.respond([]);
    return;
  }

  const query = focusedOption.value.toLowerCase();

  try {
    const prisma = getPrismaClient();

    // Fetch personalities matching the query
    const personalities = await prisma.personality.findMany({
      where: {
        isPublic: true,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { displayName: { contains: query, mode: 'insensitive' } },
          { slug: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: {
        slug: true,
        name: true,
        displayName: true,
      },
      orderBy: { name: 'asc' },
      take: DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES,
    });

    const choices = personalities.map(p => ({
      name: p.displayName ?? p.name,
      value: p.slug, // Use slug as value since that's what commands use
    }));

    await interaction.respond(choices);
  } catch (error) {
    logger.error({ err: error, query, userId: interaction.user.id }, '[Me] Autocomplete error');
    await interaction.respond([]);
  }
}

/**
 * Handle profile autocomplete for /me commands
 * Lists user's profiles with option to create new
 *
 * @param includeCreateNew - Whether to include "Create new profile..." option
 */
export async function handlePersonaAutocomplete(
  interaction: AutocompleteInteraction,
  includeCreateNew = false
): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);

  if (focusedOption.name !== 'profile') {
    await interaction.respond([]);
    return;
  }

  const query = focusedOption.value.toLowerCase();
  const discordId = interaction.user.id;

  try {
    const prisma = getPrismaClient();

    // Get user with their personas
    const user = await prisma.user.findUnique({
      where: { discordId },
      select: {
        defaultPersonaId: true,
        ownedPersonas: {
          where: query
            ? {
                OR: [
                  { name: { contains: query, mode: 'insensitive' } },
                  { preferredName: { contains: query, mode: 'insensitive' } },
                ],
              }
            : undefined,
          select: {
            id: true,
            name: true,
            preferredName: true,
          },
          orderBy: { name: 'asc' },
          // Leave room for "Create new" option
          take: includeCreateNew
            ? DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES - 1
            : DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES,
        },
      },
    });

    const choices: { name: string; value: string }[] = [];

    // Add user's personas
    if (user?.ownedPersonas) {
      for (const persona of user.ownedPersonas) {
        const isDefault = persona.id === user.defaultPersonaId;
        const displayName = persona.preferredName ?? persona.name;
        choices.push({
          name: isDefault ? `${displayName} ⭐ (default)` : displayName,
          value: persona.id,
        });
      }
    }

    // Add "Create new profile" option at the end if requested and query matches
    if (includeCreateNew) {
      const createNewLabel = '➕ Create new profile...';
      if (query === '' || createNewLabel.toLowerCase().includes(query)) {
        choices.push({
          name: createNewLabel,
          value: CREATE_NEW_PERSONA_VALUE,
        });
      }
    }

    await interaction.respond(choices);
  } catch (error) {
    logger.error({ err: error, query, userId: discordId }, '[Me] Profile autocomplete error');
    await interaction.respond([]);
  }
}
