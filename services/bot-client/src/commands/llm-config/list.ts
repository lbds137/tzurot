/**
 * LLM Config List Handler
 * Handles /llm-config list subcommand
 */

import { EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { deferEphemeral, replyWithError, handleCommandError } from '../../utils/commandHelpers.js';

const logger = createLogger('llm-config-list');

interface LlmConfigSummary {
  id: string;
  name: string;
  description: string | null;
  provider: string;
  model: string;
  visionModel: string | null;
  isGlobal: boolean;
  isDefault: boolean;
  isOwned: boolean;
}

interface ListResponse {
  configs: LlmConfigSummary[];
}

/**
 * Handle /llm-config list
 */
export async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;

  await deferEphemeral(interaction);

  try {
    const result = await callGatewayApi<ListResponse>('/user/llm-config', { userId });

    if (!result.ok) {
      logger.warn({ userId, status: result.status }, '[LlmConfig] Failed to list configs');
      await replyWithError(interaction, 'Failed to get configs. Please try again later.');
      return;
    }

    const data = result.data;

    const embed = new EmbedBuilder()
      .setTitle('🔧 LLM Configurations')
      .setColor(DISCORD_COLORS.BLURPLE)
      .setTimestamp();

    // Separate global and user configs
    const globalConfigs = data.configs.filter(c => c.isGlobal);
    const userConfigs = data.configs.filter(c => c.isOwned);

    if (globalConfigs.length > 0) {
      const lines = globalConfigs.map(c => {
        const defaultBadge = c.isDefault ? ' ⭐' : '';
        const shortModel = c.model.includes('/') ? c.model.split('/').pop() : c.model;
        return `**${c.name}**${defaultBadge}\n└ ${shortModel}`;
      });

      embed.addFields({
        name: '🌐 Global Configs',
        value: lines.join('\n\n'),
        inline: false,
      });
    }

    if (userConfigs.length > 0) {
      const lines = userConfigs.map(c => {
        const shortModel = c.model.includes('/') ? c.model.split('/').pop() : c.model;
        return `**${c.name}**\n└ ${shortModel}`;
      });

      embed.addFields({
        name: '👤 Your Configs',
        value: lines.join('\n\n'),
        inline: false,
      });
    }

    if (data.configs.length === 0) {
      embed.setDescription(
        'No configurations available.\n\nUse `/llm-config create` to create your own!'
      );
    } else {
      embed.setFooter({
        text: `${globalConfigs.length} global, ${userConfigs.length} personal configs`,
      });
    }

    await interaction.editReply({ embeds: [embed] });

    logger.info({ userId, count: data.configs.length }, '[LlmConfig] Listed configs');
  } catch (error) {
    await handleCommandError(interaction, error, { userId, command: 'LlmConfig List' });
  }
}
