/**
 * LLM Config Delete Handler
 * Handles /llm-config delete subcommand
 */

import { EmbedBuilder, MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, getConfig, DISCORD_COLORS } from '@tzurot/common-types';

const logger = createLogger('llm-config-delete');
const config = getConfig();

/**
 * Handle /llm-config delete
 */
export async function handleDelete(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const configId = interaction.options.getString('config', true);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const gatewayUrl = config.GATEWAY_URL;
    if (gatewayUrl === undefined || gatewayUrl.length === 0) {
      await interaction.editReply({
        content: '❌ Service configuration error. Please try again later.',
      });
      return;
    }

    const response = await fetch(`${gatewayUrl}/user/llm-config/${configId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${userId}`,
      },
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as { error?: string };
      logger.warn({ userId, status: response.status, configId }, '[LlmConfig] Failed to delete config');
      await interaction.editReply({
        content: `❌ Failed to delete config: ${errorData.error ?? 'Unknown error'}`,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('🗑️ Config Deleted')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription('Your LLM config has been deleted.')
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info({ userId, configId }, '[LlmConfig] Deleted config');
  } catch (error) {
    logger.error({ err: error, userId }, '[LlmConfig] Error deleting config');
    await interaction.editReply({
      content: '❌ An error occurred. Please try again later.',
    });
  }
}
