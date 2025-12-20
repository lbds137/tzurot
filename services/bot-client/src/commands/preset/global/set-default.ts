/**
 * Preset Global Set Default Handler
 * Handles /preset global set-default subcommand
 * Sets a global config as the system default (owner only)
 */

import { EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { replyWithError, handleCommandError } from '../../../utils/commandHelpers.js';
import { adminPutJson } from '../../../utils/adminApiClient.js';

const logger = createLogger('preset-global-set-default');

/**
 * Handle /preset global set-default
 */
export async function handleGlobalSetDefault(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const configId = interaction.options.getString('config', true);

  try {
    const response = await adminPutJson(`/admin/llm-config/${configId}/set-default`, {});

    if (!response.ok) {
      const errorData = (await response.json()) as { error?: string };
      await replyWithError(interaction, errorData.error ?? `HTTP ${response.status}`);
      return;
    }

    const data = (await response.json()) as { configName: string };

    const embed = new EmbedBuilder()
      .setTitle('System Default Preset Updated')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        `**${data.configName}** is now the system default preset.\n\n` +
          'Personalities without a specific config will use this default.'
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info(
      { configId, configName: data.configName },
      '[Preset/Global] Set system default preset'
    );
  } catch (error) {
    await handleCommandError(interaction, error, {
      userId: interaction.user.id,
      command: 'Preset Global Set Default',
    });
  }
}
