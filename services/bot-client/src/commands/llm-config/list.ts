/**
 * LLM Config List Handler
 * Handles /llm-config list subcommand
 */

import { EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  isFreeModel,
  type LlmConfigSummary,
  type AIProvider,
} from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { deferEphemeral, replyWithError, handleCommandError } from '../../utils/commandHelpers.js';

const logger = createLogger('llm-config-list');

interface ListResponse {
  configs: LlmConfigSummary[];
}

interface WalletListResponse {
  keys: {
    provider: AIProvider;
    isActive: boolean;
  }[];
}

/**
 * Handle /llm-config list
 */
export async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;

  await deferEphemeral(interaction);

  try {
    // Fetch configs and wallet status in parallel
    const [configResult, walletResult] = await Promise.all([
      callGatewayApi<ListResponse>('/user/llm-config', { userId }),
      callGatewayApi<WalletListResponse>('/wallet/list', { userId }),
    ]);

    if (!configResult.ok) {
      logger.warn({ userId, status: configResult.status }, '[LlmConfig] Failed to list configs');
      await replyWithError(interaction, 'Failed to get configs. Please try again later.');
      return;
    }

    const data = configResult.data;

    // Check if user is in guest mode (no active wallet keys)
    const hasActiveWallet =
      walletResult.ok && walletResult.data.keys.some(k => k.isActive === true);
    const isGuestMode = !hasActiveWallet;

    const embed = new EmbedBuilder()
      .setTitle('🔧 LLM Configurations')
      .setColor(isGuestMode ? DISCORD_COLORS.WARNING : DISCORD_COLORS.BLURPLE)
      .setTimestamp();

    // Add guest mode warning if applicable
    if (isGuestMode) {
      embed.setDescription(
        '⚠️ **Guest Mode Active**\n' +
          "You don't have an API key configured, so you're limited to **free models** (marked with 🆓).\n\n" +
          'Use `/wallet set` to add your own API key for full model access.'
      );
    }

    // Separate global and user configs
    const globalConfigs = data.configs.filter(c => c.isGlobal);
    const userConfigs = data.configs.filter(c => c.isOwned);

    // Helper to format config with badges
    const formatConfig = (c: LlmConfigSummary): string => {
      const defaultBadge = c.isDefault ? ' ⭐' : '';
      const freeBadge = isFreeModel(c.model) ? ' 🆓' : '';
      const shortModel = c.model.includes('/') ? c.model.split('/').pop() : c.model;
      // In guest mode, dim paid configs
      const nameStyle = isGuestMode && !isFreeModel(c.model) ? `~~${c.name}~~` : `**${c.name}**`;
      return `${nameStyle}${defaultBadge}${freeBadge}\n└ ${shortModel}`;
    };

    if (globalConfigs.length > 0) {
      const lines = globalConfigs.map(formatConfig);
      embed.addFields({
        name: '🌐 Global Configs',
        value: lines.join('\n\n'),
        inline: false,
      });
    }

    if (userConfigs.length > 0) {
      const lines = userConfigs.map(formatConfig);
      embed.addFields({
        name: '👤 Your Configs',
        value: lines.join('\n\n'),
        inline: false,
      });
    }

    if (data.configs.length === 0) {
      const description = isGuestMode
        ? embed.data.description + '\n\nNo configurations available.'
        : 'No configurations available.\n\nUse `/llm-config create` to create your own!';
      embed.setDescription(description);
    } else {
      const freeCount = data.configs.filter(c => isFreeModel(c.model)).length;
      embed.setFooter({
        text: isGuestMode
          ? `${freeCount} free configs available • 🆓 = free model`
          : `${globalConfigs.length} global, ${userConfigs.length} personal configs`,
      });
    }

    await interaction.editReply({ embeds: [embed] });

    logger.info({ userId, count: data.configs.length, isGuestMode }, '[LlmConfig] Listed configs');
  } catch (error) {
    await handleCommandError(interaction, error, { userId, command: 'LlmConfig List' });
  }
}
