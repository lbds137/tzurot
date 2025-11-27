/**
 * Model Set-Default Handler
 * Handles /model set-default subcommand
 * Sets the user's global default LLM config (applies to all personalities)
 */

import { EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { deferEphemeral, replyWithError, handleCommandError } from '../../utils/commandHelpers.js';

const logger = createLogger('model-set-default');

interface SetDefaultResponse {
  default: {
    configId: string;
    configName: string;
  };
}

/**
 * Handle /model set-default
 */
export async function handleSetDefault(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const configId = interaction.options.getString('config', true);

  await deferEphemeral(interaction);

  try {
    const result = await callGatewayApi<SetDefaultResponse>('/user/model-override/default', {
      method: 'PUT',
      userId,
      body: { configId },
    });

    if (!result.ok) {
      logger.warn({ userId, status: result.status, configId }, '[Model] Failed to set default');
      await replyWithError(interaction, `Failed to set default: ${result.error}`);
      return;
    }

    const data = result.data;

    const embed = new EmbedBuilder()
      .setTitle('✅ Default Config Set')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        `Your default LLM config is now **${data.default.configName}**.\n\n` +
          'This will be used for all personalities unless you have a specific override.'
      )
      .setFooter({ text: 'Use /model clear-default to remove this setting' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info(
      { userId, configId, configName: data.default.configName },
      '[Model] Set default config'
    );
  } catch (error) {
    await handleCommandError(interaction, error, { userId, command: 'Model Set-Default' });
  }
}
