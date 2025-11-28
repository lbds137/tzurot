/**
 * Model Command Autocomplete Handler
 * Provides autocomplete suggestions for personality and config options
 */

import type { AutocompleteInteraction } from 'discord.js';
import {
  createLogger,
  DISCORD_LIMITS,
  type PersonalitySummary,
  type LlmConfigSummary,
} from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';

const logger = createLogger('model-autocomplete');

/**
 * Handle autocomplete for /model commands
 */
export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);
  const userId = interaction.user.id;

  try {
    if (focusedOption.name === 'personality') {
      await handlePersonalityAutocomplete(interaction, focusedOption.value, userId);
    } else if (focusedOption.name === 'config') {
      await handleConfigAutocomplete(interaction, focusedOption.value, userId);
    } else {
      await interaction.respond([]);
    }
  } catch (error) {
    logger.error({ err: error, option: focusedOption.name }, '[Model] Autocomplete error');
    await interaction.respond([]);
  }
}

/**
 * Handle personality autocomplete
 */
async function handlePersonalityAutocomplete(
  interaction: AutocompleteInteraction,
  query: string,
  userId: string
): Promise<void> {
  const result = await callGatewayApi<{ personalities: PersonalitySummary[] }>(
    '/user/personality',
    { userId }
  );

  if (!result.ok) {
    logger.warn({ userId, error: result.error }, '[Model] Failed to fetch personalities');
    await interaction.respond([]);
    return;
  }

  const queryLower = query.toLowerCase();
  const filtered = result.data.personalities
    .filter(
      p =>
        p.name.toLowerCase().includes(queryLower) ||
        p.slug.toLowerCase().includes(queryLower) ||
        (p.displayName?.toLowerCase().includes(queryLower) ?? false)
    )
    .slice(0, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES);

  const choices = filtered.map(p => ({
    name: p.displayName ?? p.name,
    value: p.id,
  }));

  await interaction.respond(choices);
}

/**
 * Handle config autocomplete
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
    logger.warn({ userId, error: result.error }, '[Model] Failed to fetch configs');
    await interaction.respond([]);
    return;
  }

  const queryLower = query.toLowerCase();
  const filtered = result.data.configs
    .filter(
      c =>
        c.name.toLowerCase().includes(queryLower) ||
        c.model.toLowerCase().includes(queryLower) ||
        (c.description?.toLowerCase().includes(queryLower) ?? false)
    )
    .slice(0, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES);

  const choices = filtered.map(c => ({
    // Show model info in the name for clarity
    name: `${c.name} (${c.model.split('/').pop()})`,
    value: c.id,
  }));

  await interaction.respond(choices);
}
