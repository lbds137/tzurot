/**
 * Admin LLM Config Set Free Default Handler
 * Handles /admin llm-config-set-free-default subcommand
 * Sets a global config as the free tier default for guest users
 */

import { EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { deferEphemeral, replyWithError, handleCommandError } from '../../utils/commandHelpers.js';
import { adminPutJson } from '../../utils/adminApiClient.js';

const logger = createLogger('admin-llm-config-set-free-default');

/**
 * Handle /admin llm-config-set-free-default
 */
export async function handleLlmConfigSetFreeDefault(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const configId = interaction.options.getString('config', true);

  await deferEphemeral(interaction);

  try {
    const response = await adminPutJson(`/admin/llm-config/${configId}/set-free-default`, {});

    if (!response.ok) {
      const errorData = (await response.json()) as { error?: string };
      await replyWithError(interaction, errorData.error ?? `HTTP ${response.status}`);
      return;
    }

    const data = (await response.json()) as { configName: string };

    const embed = new EmbedBuilder()
      .setTitle('Free Tier Default Config Updated')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        `**${data.configName}** is now the free tier default LLM config.\n\n` +
          'Guest users without API keys will use this model for AI responses.'
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info(
      { configId, configName: data.configName },
      '[Admin] Set free tier default LLM config'
    );
  } catch (error) {
    await handleCommandError(interaction, error, {
      userId: interaction.user.id,
      command: 'Admin LLM Config Set Free Default',
    });
  }
}
