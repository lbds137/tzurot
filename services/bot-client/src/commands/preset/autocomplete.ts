/**
 * Preset Command Autocomplete Handler
 * Provides autocomplete suggestions for preset and model options
 */

import type { AutocompleteInteraction } from 'discord.js';
import { createLogger, DISCORD_LIMITS, type LlmConfigSummary } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import {
  fetchTextModels,
  fetchVisionModels,
  formatModelChoice,
} from '../../utils/modelAutocomplete.js';

const logger = createLogger('preset-autocomplete');

/**
 * Handle autocomplete for /preset commands
 */
export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);
  const userId = interaction.user.id;

  try {
    if (focusedOption.name === 'preset') {
      await handlePresetAutocomplete(interaction, focusedOption.value, userId);
    } else if (focusedOption.name === 'model') {
      await handleModelAutocomplete(interaction, focusedOption.value);
    } else if (focusedOption.name === 'vision-model') {
      await handleVisionModelAutocomplete(interaction, focusedOption.value);
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
      '[Preset] Autocomplete error'
    );
    await interaction.respond([]);
  }
}

/**
 * Handle preset autocomplete - only shows user-owned presets for delete
 */
async function handlePresetAutocomplete(
  interaction: AutocompleteInteraction,
  query: string,
  userId: string
): Promise<void> {
  const result = await callGatewayApi<{ configs: LlmConfigSummary[] }>('/user/llm-config', {
    userId,
  });

  if (!result.ok) {
    logger.warn({ userId, error: result.error }, '[Preset] Failed to fetch presets');
    await interaction.respond([]);
    return;
  }

  // For delete command, only show user-owned presets (not global)
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

/**
 * Handle model autocomplete - fetches text generation models from OpenRouter
 */
async function handleModelAutocomplete(
  interaction: AutocompleteInteraction,
  query: string
): Promise<void> {
  const models = await fetchTextModels(query, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES);

  const choices = models.map(m => formatModelChoice(m));

  await interaction.respond(choices);
}

/**
 * Handle vision-model autocomplete - fetches vision-capable models from OpenRouter
 */
async function handleVisionModelAutocomplete(
  interaction: AutocompleteInteraction,
  query: string
): Promise<void> {
  const models = await fetchVisionModels(query, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES);

  const choices = models.map(m => formatModelChoice(m));

  await interaction.respond(choices);
}
