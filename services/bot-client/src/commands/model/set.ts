/**
 * Model Set Handler
 * Handles /model set subcommand
 */

import { EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { deferEphemeral, replyWithError, handleCommandError } from '../../utils/commandHelpers.js';

const logger = createLogger('model-set');

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

  await deferEphemeral(interaction);

  try {
    const result = await callGatewayApi<SetResponse>('/user/model-override', {
      method: 'PUT',
      userId,
      body: { personalityId, configId },
    });

    if (!result.ok) {
      logger.warn(
        { userId, status: result.status, personalityId, configId },
        '[Model] Failed to set override'
      );
      await replyWithError(interaction, `Failed to set model: ${result.error}`);
      return;
    }

    const data = result.data;

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
    await handleCommandError(interaction, error, { userId, command: 'Model Set' });
  }
}
