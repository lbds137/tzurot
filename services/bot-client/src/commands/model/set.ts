/**
 * Model Set Handler
 * Handles /model set subcommand
 */

import { EmbedBuilder, MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, getConfig, DISCORD_COLORS } from '@tzurot/common-types';

const logger = createLogger('model-set');
const config = getConfig();

interface SetResponse {
  override: {
    personalityId: string;
    personalityName: string;
    configId: string | null;
    configName: string | null;
  };
}

/**
 * Handle /model set
 */
export async function handleSet(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const personalityId = interaction.options.getString('personality', true);
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

    const response = await fetch(`${gatewayUrl}/user/model-override`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userId}`,
      },
      body: JSON.stringify({
        personalityId,
        configId,
      }),
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as { error?: string };
      logger.warn(
        { userId, status: response.status, personalityId, configId },
        '[Model] Failed to set override'
      );
      await interaction.editReply({
        content: `❌ Failed to set model: ${errorData.error ?? 'Unknown error'}`,
      });
      return;
    }

    const data = (await response.json()) as SetResponse;

    const embed = new EmbedBuilder()
      .setTitle('✅ Model Override Set')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        `**${data.override.personalityName}** will now use the **${data.override.configName}** config.`
      )
      .setFooter({ text: 'Use /model reset to remove this override' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info(
      {
        userId,
        personalityId,
        personalityName: data.override.personalityName,
        configId,
        configName: data.override.configName,
      },
      '[Model] Set override'
    );
  } catch (error) {
    logger.error({ err: error, userId }, '[Model] Error setting override');
    await interaction.editReply({
      content: '❌ An error occurred. Please try again later.',
    });
  }
}
