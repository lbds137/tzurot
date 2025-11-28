/**
 * Personality Command Autocomplete Handler
 * Provides autocomplete suggestions for personality slug options
 */

import type { AutocompleteInteraction } from 'discord.js';
import { createLogger, DISCORD_LIMITS, type PersonalitySummary } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';

const logger = createLogger('personality-autocomplete');

/**
 * Handle autocomplete for /personality commands
 */
export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);
  const userId = interaction.user.id;

  try {
    if (focusedOption.name === 'slug') {
      await handleSlugAutocomplete(interaction, focusedOption.value, userId);
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
        subcommand: interaction.options.getSubcommand(false),
      },
      '[Personality] Autocomplete error'
    );
    await interaction.respond([]);
  }
}

/**
 * Handle slug autocomplete - only shows user-owned personalities
 * Since users can only edit personalities they own
 */
async function handleSlugAutocomplete(
  interaction: AutocompleteInteraction,
  query: string,
  userId: string
): Promise<void> {
  const result = await callGatewayApi<{ personalities: PersonalitySummary[] }>(
    '/user/personality',
    { userId }
  );

  if (!result.ok) {
    logger.warn({ userId, error: result.error }, '[Personality] Failed to fetch personalities');
    await interaction.respond([]);
    return;
  }

  // For edit command, only show user-owned personalities
  const queryLower = query.toLowerCase();
  const filtered = result.data.personalities
    .filter(
      p =>
        p.isOwned &&
        (p.name.toLowerCase().includes(queryLower) ||
          p.slug.toLowerCase().includes(queryLower) ||
          (p.displayName?.toLowerCase().includes(queryLower) ?? false))
    )
    .slice(0, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES);

  const choices = filtered.map(p => ({
    // Show displayName if available, otherwise name
    name: p.displayName ?? p.name,
    // Return the slug since that's what the edit command expects
    value: p.slug,
  }));

  await interaction.respond(choices);
}
