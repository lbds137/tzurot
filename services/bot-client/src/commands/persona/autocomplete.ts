/**
 * Persona Command Autocomplete Handler
 * Provides autocomplete suggestions for personality selection
 */

import type { AutocompleteInteraction } from 'discord.js';
import { createLogger, getPrismaClient, DISCORD_LIMITS } from '@tzurot/common-types';

const logger = createLogger('persona-autocomplete');

/**
 * Handle personality autocomplete for /persona override commands
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
    logger.error(
      { err: error, query, userId: interaction.user.id },
      '[Persona] Autocomplete error'
    );
    await interaction.respond([]);
  }
}
