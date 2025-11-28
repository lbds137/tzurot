/**
 * LLM Config Command Autocomplete Handler
 * Provides autocomplete suggestions for config options
 */

import type { AutocompleteInteraction } from 'discord.js';
import { createLogger, DISCORD_LIMITS, type LlmConfigSummary } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';

const logger = createLogger('llm-config-autocomplete');

/**
 * Handle autocomplete for /llm-config commands
 */
export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);
  const userId = interaction.user.id;

  try {
    if (focusedOption.name === 'config') {
      await handleConfigAutocomplete(interaction, focusedOption.value, userId);
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
      '[LlmConfig] Autocomplete error'
    );
    await interaction.respond([]);
  }
}

/**
 * Handle config autocomplete - only shows user-owned configs for delete
 */
async function handleConfigAutocomplete(
  interaction: AutocompleteInteraction,
  query: string,
  userId: string
): Promise<void> {
  const result = await callGatewayApi<{ configs: LlmConfigSummary[] }>('/user/llm-config', {
    userId,
  });

  if (!result.ok) {
    logger.warn({ userId, error: result.error }, '[LlmConfig] Failed to fetch configs');
    await interaction.respond([]);
    return;
  }

  // For delete command, only show user-owned configs (not global)
  const queryLower = query.toLowerCase();
  const filtered = result.data.configs
    .filter(
      c =>
        c.isOwned &&
        (c.name.toLowerCase().includes(queryLower) ||
          c.model.toLowerCase().includes(queryLower) ||
          (c.description?.toLowerCase().includes(queryLower) ?? false))
    )
    .slice(0, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES);

  const choices = filtered.map(c => ({
    // Show model info in the name for clarity
    name: `${c.name} (${c.model.split('/').pop()})`,
    value: c.id,
  }));

  await interaction.respond(choices);
}
