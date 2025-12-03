/**
 * Character Command Autocomplete Handler
 * Provides autocomplete suggestions for character selection
 */

import type { AutocompleteInteraction } from 'discord.js';
import { createLogger, DISCORD_LIMITS, type PersonalitySummary } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';

const logger = createLogger('character-autocomplete');

/**
 * Handle autocomplete for /character commands
 */
export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);
  const userId = interaction.user.id;
  const subcommand = interaction.options.getSubcommand(false);

  try {
    if (focusedOption.name === 'character') {
      await handleCharacterAutocomplete(interaction, focusedOption.value, userId, subcommand);
    } else {
      await interaction.respond([]);
    }
  } catch (error) {
    logger.error(
      {
        err: error,
        option: focusedOption.name,
        query: focusedOption.value,
        userId,
        guildId: interaction.guildId,
        command: interaction.commandName,
        subcommand,
      },
      '[Character] Autocomplete error'
    );
    await interaction.respond([]);
  }
}

/**
 * Handle character autocomplete
 * - For 'edit': only shows user-owned characters
 * - For 'view': shows all public characters + user's own
 */
async function handleCharacterAutocomplete(
  interaction: AutocompleteInteraction,
  query: string,
  userId: string,
  subcommand: string | null
): Promise<void> {
  const result = await callGatewayApi<{ personalities: PersonalitySummary[] }>(
    '/user/personality',
    { userId }
  );

  if (!result.ok) {
    logger.warn({ userId, error: result.error }, '[Character] Failed to fetch characters');
    await interaction.respond([]);
    return;
  }

  const queryLower = query.toLowerCase();

  // Filter based on subcommand
  const filtered = result.data.personalities
    .filter(p => {
      // For edit and avatar, only show owned characters
      if (subcommand === 'edit' || subcommand === 'avatar') {
        if (!p.isOwned) {
          return false;
        }
      }
      // For view and list, show all (owned + public)
      // The API already returns only accessible personalities

      // Match query
      if (queryLower.length === 0) {
        return true;
      }
      return (
        p.name.toLowerCase().includes(queryLower) ||
        p.slug.toLowerCase().includes(queryLower) ||
        (p.displayName?.toLowerCase().includes(queryLower) ?? false)
      );
    })
    .slice(0, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES);

  const choices = filtered.map(p => {
    const displayName = p.displayName ?? p.name;
    const visibility = p.isOwned ? (p.isPublic ? '🌐' : '🔒') : '📖';
    return {
      name: `${visibility} ${displayName}`,
      value: p.slug,
    };
  });

  await interaction.respond(choices);
}
