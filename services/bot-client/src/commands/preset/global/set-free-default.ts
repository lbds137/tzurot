/**
 * Preset Global Set Free Default Handler
 * Handles /preset global set-free-default subcommand
 * Sets a global config as the free tier default for guest users (owner only)
 */

import { EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { replyWithError, handleCommandError } from '../../../utils/commandHelpers.js';
import { adminPutJson } from '../../../utils/adminApiClient.js';

const logger = createLogger('preset-global-set-free-default');

/**
 * Handle /preset global set-free-default
 */
export async function handleGlobalSetFreeDefault(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const configId = interaction.options.getString('config', true);

  try {
    const response = await adminPutJson(`/admin/llm-config/${configId}/set-free-default`, {});

    if (!response.ok) {
      const errorData = (await response.json()) as { error?: string };
      await replyWithError(interaction, errorData.error ?? `HTTP ${response.status}`);
      return;
    }

    const data = (await response.json()) as { configName: string };

    const embed = new EmbedBuilder()
      .setTitle('Free Tier Default Preset Updated')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        `**${data.configName}** is now the free tier default preset.\n\n` +
          'Guest users without API keys will use this model for AI responses.'
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info(
      { configId, configName: data.configName },
      '[Preset/Global] Set free tier default preset'
    );
  } catch (error) {
    await handleCommandError(interaction, error, {
      userId: interaction.user.id,
      command: 'Preset Global Set Free Default',
    });
  }
}
