/**
 * Preset Command Autocomplete Handler
 * Provides autocomplete suggestions for preset and model options
 */

import type { AutocompleteInteraction } from 'discord.js';
import { createLogger, DISCORD_LIMITS, type LlmConfigSummary } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { adminFetch } from '../../utils/adminApiClient.js';
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
  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand(false);

  try {
    if (focusedOption.name === 'preset') {
      await handlePresetAutocomplete(interaction, focusedOption.value, userId);
    } else if (focusedOption.name === 'model') {
      await handleModelAutocomplete(interaction, focusedOption.value);
    } else if (focusedOption.name === 'vision-model') {
      await handleVisionModelAutocomplete(interaction, focusedOption.value);
    } else if (focusedOption.name === 'config' && subcommandGroup === 'global') {
      // Global config autocomplete (for owner-only commands)
      // Note: 'config' option is currently only used in the 'global' subcommand group.
      // If future subcommands also use 'config', this condition will need updating.
      const freeOnly = subcommand === 'set-free-default';
      await handleGlobalConfigAutocomplete(interaction, focusedOption.value, freeOnly);
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

/**
 * Handle global config autocomplete for /preset global commands (owner only)
 * @param freeOnly - If true, only show free models (those with :free in model name)
 */
async function handleGlobalConfigAutocomplete(
  interaction: AutocompleteInteraction,
  query: string,
  freeOnly = false
): Promise<void> {
  try {
    const response = await adminFetch('/admin/llm-config');

    if (!response.ok) {
      await interaction.respond([]);
      return;
    }

    const data = (await response.json()) as {
      configs: {
        id: string;
        name: string;
        model: string;
        isGlobal: boolean;
        isDefault: boolean;
        isFreeDefault?: boolean;
      }[];
    };

    const queryLower = query.toLowerCase();
    const filtered = data.configs
      .filter(c => {
        // Must be global
        if (!c.isGlobal) {
          return false;
        }
        // If freeOnly, must have :free in model name
        if (freeOnly && !c.model.includes(':free')) {
          return false;
        }
        // Must match query
        return (
          c.name.toLowerCase().includes(queryLower) || c.model.toLowerCase().includes(queryLower)
        );
      })
      .slice(0, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES);

    const choices = filtered.map(c => {
      let suffix = '';
      if (c.isDefault === true) {
        suffix += ' [DEFAULT]';
      }
      if (c.isFreeDefault === true) {
        suffix += ' [FREE]';
      }
      return {
        name: `${c.name} (${c.model.split('/').pop()})${suffix}`,
        value: c.id,
      };
    });

    await interaction.respond(choices);
  } catch {
    await interaction.respond([]);
  }
}
