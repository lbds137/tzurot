/**
 * Wallet Test Subcommand
 * Tests API key validity by making a dry-run API call
 *
 * Security:
 * - Response is ephemeral (only visible to the user)
 * - Never displays the actual API key
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

const logger = createLogger('wallet-test');

interface WalletTestResponse {
  valid: boolean;
  provider: AIProvider;
  credits?: number;
  error?: string;
  errorCode?: string;
}

/**
 * Handle /wallet test <provider> subcommand
 * Tests the API key validity
 */
export async function handleTestKey(interaction: ChatInputCommandInteraction): Promise<void> {
  const provider = interaction.options.getString('provider', true) as AIProvider;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const config = getConfig();

  try {
    const gatewayUrl = config.GATEWAY_URL;
    const response = await fetch(`${gatewayUrl}/wallet/test`, {
      method: 'POST',
      headers: {
        'Content-Type': CONTENT_TYPES.JSON,
        'X-User-Id': interaction.user.id,
      },
      body: JSON.stringify({ provider }),
    });

    const data = (await response.json()) as WalletTestResponse;

    if (!response.ok) {
      if (response.status === 404) {
        await interaction.editReply(
          `❌ You don't have an API key configured for **${getProviderDisplayName(provider)}**.\n\n` +
            'Use `/wallet set` to add your API key first.'
        );
        return;
      }

      // Handle validation errors
      const embed = new EmbedBuilder()
        .setColor(DISCORD_COLORS.ERROR)
        .setTitle('❌ API Key Invalid')
        .setDescription(`Your **${getProviderDisplayName(provider)}** API key failed validation.`)
        .addFields({
          name: 'Error',
          value: data.error ?? 'Unknown error',
          inline: false,
        })
        .addFields({
          name: '💡 What to do',
          value:
            '• Check if your key is still valid\n' +
            '• Ensure you have credits/quota remaining\n' +
            '• Use `/wallet set` to update your key',
          inline: false,
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Success - key is valid
    const embed = new EmbedBuilder()
      .setColor(DISCORD_COLORS.SUCCESS)
      .setTitle('✅ API Key Valid')
      .setDescription(`Your **${getProviderDisplayName(provider)}** API key is working correctly!`);

    // Add credit balance if available (OpenRouter provides this)
    if (data.credits !== undefined) {
      embed.addFields({
        name: '💰 Credit Balance',
        value: `$${data.credits.toFixed(4)}`,
        inline: true,
      });
    }

    embed
      .addFields({
        name: '🚀 Ready to Use',
        value: 'Your key will be used for AI responses.',
        inline: true,
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info(
      { provider, userId: interaction.user.id, hasCredits: data.credits !== undefined },
      '[Wallet Test] API key validated'
    );
  } catch (error) {
    logger.error({ err: error, provider, userId: interaction.user.id }, '[Wallet Test] Error');
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
