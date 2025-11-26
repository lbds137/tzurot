/**
 * Wallet List Subcommand
 * Shows configured API key providers for the user
 *
 * Security:
 * - Never displays actual API keys
 * - Shows only provider names and status
 * - Response is ephemeral (only visible to the user)
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

const logger = createLogger('wallet-list');

interface WalletListResponse {
  keys: {
    provider: AIProvider;
    isActive: boolean;
    createdAt: string;
    lastUsedAt: string | null;
  }[];
}

/**
 * Handle /wallet list subcommand
 * Displays configured API keys (without showing actual keys)
 */
export async function handleListKeys(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const config = getConfig();

  try {
    const gatewayUrl = config.GATEWAY_URL;
    const response = await fetch(`${gatewayUrl}/wallet/list`, {
      method: 'GET',
      headers: {
        'Content-Type': CONTENT_TYPES.JSON,
        'X-User-Id': interaction.user.id,
      },
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as { error?: string };
      const errorMessage = errorData.error ?? `HTTP ${response.status}`;
      await interaction.editReply(`❌ Failed to retrieve wallet info: ${errorMessage}`);
      return;
    }

    const data = (await response.json()) as WalletListResponse;

    if (data.keys.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(DISCORD_COLORS.BLURPLE)
        .setTitle('💳 Your API Wallet')
        .setDescription(
          'You have no API keys configured yet.\n\n' +
            'Use `/wallet set` to add your own API key and start using the bot with your own credits.'
        )
        .addFields({
          name: '🚀 Getting Started',
          value:
            '**OpenRouter** (recommended): Get a key at https://openrouter.ai/keys\n' +
            '**OpenAI**: Get a key at https://platform.openai.com/api-keys',
          inline: false,
        })
        .setFooter({ text: 'BYOK = Bring Your Own Key' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Build key list
    const keyFields = data.keys.map(key => {
      const statusEmoji = key.isActive ? '✅' : '❌';
      const lastUsed =
        key.lastUsedAt !== null
          ? `Last used: <t:${Math.floor(new Date(key.lastUsedAt).getTime() / 1000)}:R>`
          : 'Never used';
      const created = `Added: <t:${Math.floor(new Date(key.createdAt).getTime() / 1000)}:D>`;

      return {
        name: `${statusEmoji} ${getProviderDisplayName(key.provider)}`,
        value: `${lastUsed}\n${created}`,
        inline: true,
      };
    });

    const embed = new EmbedBuilder()
      .setColor(DISCORD_COLORS.SUCCESS)
      .setTitle('💳 Your API Wallet')
      .setDescription(
        `You have **${data.keys.length}** API key${data.keys.length > 1 ? 's' : ''} configured.`
      )
      .addFields(...keyFields)
      .addFields({
        name: '💡 Tip',
        value: 'Use `/wallet test` to verify your keys are working.',
        inline: false,
      })
      .setFooter({ text: 'Keys are encrypted at rest and never visible' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info(
      { userId: interaction.user.id, keyCount: data.keys.length },
      '[Wallet List] Listed keys'
    );
  } catch (error) {
    logger.error({ err: error, userId: interaction.user.id }, '[Wallet List] Error');
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
