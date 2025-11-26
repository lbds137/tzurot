/**
 * Wallet Remove Subcommand
 * Removes an API key for a provider
 *
 * Security:
 * - Response is ephemeral (only visible to the user)
 * - Confirms removal before deletion
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { MessageFlags, EmbedBuilder } from 'discord.js';
import {
  getConfig,
  createLogger,
  CONTENT_TYPES,
  DISCORD_COLORS,
  AIProvider,
} from '@tzurot/common-types';

const logger = createLogger('wallet-remove');

/**
 * Handle /wallet remove <provider> subcommand
 * Removes the API key for the specified provider
 */
export async function handleRemoveKey(interaction: ChatInputCommandInteraction): Promise<void> {
  const provider = interaction.options.getString('provider', true) as AIProvider;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const config = getConfig();

  try {
    const gatewayUrl = config.GATEWAY_URL;
    const response = await fetch(`${gatewayUrl}/wallet/${provider}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': CONTENT_TYPES.JSON,
        'X-User-Id': interaction.user.id,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        await interaction.editReply(
          `❌ You don't have an API key configured for **${getProviderDisplayName(provider)}**.`
        );
        return;
      }

      const errorData = (await response.json().catch(() => ({}))) as { error?: string };
      const errorMessage = errorData.error ?? `HTTP ${response.status}`;
      await interaction.editReply(`❌ Failed to remove API key: ${errorMessage}`);
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(DISCORD_COLORS.WARNING)
      .setTitle('🗑️ API Key Removed')
      .setDescription(
        `Your **${getProviderDisplayName(provider)}** API key has been deleted.\n\n` +
          'The bot will now use the default system key (if available) for this provider.'
      )
      .setFooter({ text: 'Use /wallet set to configure a new key' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info({ provider, userId: interaction.user.id }, '[Wallet Remove] API key removed');
  } catch (error) {
    logger.error({ err: error, provider, userId: interaction.user.id }, '[Wallet Remove] Error');
    await interaction.editReply('❌ An unexpected error occurred. Please try again later.');
  }
}

/**
 * Get display name for a provider
 */
function getProviderDisplayName(provider: AIProvider): string {
  switch (provider) {
    case AIProvider.OpenRouter:
      return 'OpenRouter';
    case AIProvider.OpenAI:
      return 'OpenAI';
    default:
      return provider;
  }
}
