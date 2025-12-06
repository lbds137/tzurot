/**
 * Wallet Set Subcommand
 * Opens a modal for secure API key input
 *
 * Security:
 * - Uses Discord Modal for API key input (more secure than slash command args)
 * - API keys are NEVER visible in slash command history
 * - Response is ephemeral (only visible to the user)
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { createLogger, AIProvider, API_KEY_FORMATS } from '@tzurot/common-types';
import { WalletCustomIds } from '../../utils/customIds.js';

const logger = createLogger('wallet-set');

/**
 * Handle /wallet set <provider> subcommand
 * Shows a modal for secure API key input
 */
export async function handleSetKey(interaction: ChatInputCommandInteraction): Promise<void> {
  const provider = interaction.options.getString('provider', true) as AIProvider;

  // Determine provider display name and help text
  const providerInfo = getProviderInfo(provider);

  // Create modal with API key input
  const modal = new ModalBuilder()
    .setCustomId(WalletCustomIds.set(provider))
    .setTitle(`Set ${providerInfo.displayName} API Key`);

  // API Key input (required, single line for security)
  const apiKeyInput = new TextInputBuilder()
    .setCustomId('apiKey')
    .setLabel(`${providerInfo.displayName} API Key`)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(providerInfo.placeholder)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(200);

  // Add input to action row
  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(apiKeyInput);
  modal.addComponents(row);

  // Show modal to user
  await interaction.showModal(modal);

  logger.info(
    { provider, userId: interaction.user.id },
    '[Wallet Set] Showing API key input modal'
  );
}

/**
 * Get provider-specific information for display
 */
function getProviderInfo(provider: AIProvider): {
  displayName: string;
  placeholder: string;
  helpUrl: string;
} {
  switch (provider) {
    case AIProvider.OpenRouter:
      return {
        displayName: 'OpenRouter',
        placeholder: API_KEY_FORMATS.OPENROUTER_PLACEHOLDER,
        helpUrl: 'https://openrouter.ai/keys',
      };
    default: {
      // Type guard for exhaustive check - add new providers above
      const _exhaustive: never = provider;
      return {
        displayName: _exhaustive,
        placeholder: 'Your API key',
        helpUrl: '',
      };
    }
  }
}
