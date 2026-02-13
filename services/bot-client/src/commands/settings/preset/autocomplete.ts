/**
 * Settings Preset Autocomplete Handler
 * Provides autocomplete suggestions for personality and preset options
 */

import type { AutocompleteInteraction } from 'discord.js';
import {
  createLogger,
  DISCORD_LIMITS,
  isFreeModel,
  AUTOCOMPLETE_BADGES,
  formatAutocompleteOption,
  type LlmConfigSummary,
  type AIProvider,
  type AutocompleteBadge,
} from '@tzurot/common-types';
import { callGatewayApi } from '../../../utils/userGatewayClient.js';
import { handlePersonalityAutocomplete } from '../../../utils/autocomplete/index.js';

/**
 * Special value for the "Unlock All Models" upsell option
 * Used to detect when user selects the upsell in command handlers
 */
export const UNLOCK_MODELS_VALUE = '__unlock_all_models__';

interface WalletListResponse {
  keys: {
    provider: AIProvider;
    isActive: boolean;
  }[];
}

const logger = createLogger('settings-preset-autocomplete');

/**
 * Handle autocomplete for /settings preset commands
 */
export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);
  const userId = interaction.user.id;

  try {
    if (focusedOption.name === 'personality') {
      // Use shared utility with id as value (model override API expects personality ID)
      await handlePersonalityAutocomplete(interaction, {
        optionName: 'personality',
        ownedOnly: false,
        showVisibility: true,
        valueField: 'id',
      });
    } else if (focusedOption.name === 'preset') {
      await handlePresetAutocomplete(interaction, focusedOption.value, userId);
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
      '[Me/Preset] Autocomplete error'
    );
    await interaction.respond([]);
  }
}

/**
 * Handle preset autocomplete
 * For guest users (no API key), only shows free models + an upsell option
 */
async function handlePresetAutocomplete(
  interaction: AutocompleteInteraction,
  query: string,
  userId: string
): Promise<void> {
  // Fetch configs and wallet status in parallel
  const [configResult, walletResult] = await Promise.all([
    callGatewayApi<{ configs: LlmConfigSummary[] }>('/user/llm-config', { userId }),
    callGatewayApi<WalletListResponse>('/wallet/list', { userId }),
  ]);

  if (!configResult.ok) {
    logger.warn({ userId, error: configResult.error }, '[Me/Preset] Failed to fetch configs');
    await interaction.respond([]);
    return;
  }

  // Check if user is in guest mode (no active wallet keys)
  const hasActiveWallet = walletResult.ok && walletResult.data.keys.some(k => k.isActive === true);
  const isGuestMode = !hasActiveWallet;

  const queryLower = query.toLowerCase();

  // Filter configs - for guests, only show free models
  let filtered = configResult.data.configs.filter(c => {
    // Text search filter
    const matchesQuery =
      c.name.toLowerCase().includes(queryLower) ||
      c.model.toLowerCase().includes(queryLower) ||
      (c.description?.toLowerCase().includes(queryLower) ?? false);

    if (!matchesQuery) {
      return false;
    }

    // For guests, only show free models
    if (isGuestMode && !isFreeModel(c.model)) {
      return false;
    }

    return true;
  });

  // Reserve one slot for upsell if in guest mode
  const maxChoices = isGuestMode
    ? DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES - 1
    : DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES;

  filtered = filtered.slice(0, maxChoices);

  // Format choices using standardized autocomplete utility
  const choices = filtered.map(c => {
    // Build status badges for free models
    const statusBadges: AutocompleteBadge[] = [];
    if (isFreeModel(c.model)) {
      statusBadges.push(AUTOCOMPLETE_BADGES.FREE);
    }
    if (c.isDefault) {
      statusBadges.push(AUTOCOMPLETE_BADGES.DEFAULT);
    }

    return formatAutocompleteOption({
      name: c.name,
      value: c.id,
      scopeBadge: c.isGlobal ? AUTOCOMPLETE_BADGES.GLOBAL : AUTOCOMPLETE_BADGES.OWNED,
      statusBadges: statusBadges.length > 0 ? statusBadges : undefined,
      metadata: c.model.split('/').pop(),
    });
  });

  // Add upsell option for guest users
  if (isGuestMode) {
    choices.push({
      name: '✨ Unlock All Models...',
      value: UNLOCK_MODELS_VALUE,
    });
  }

  await interaction.respond(choices);
}
