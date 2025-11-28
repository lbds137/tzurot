/**
 * Admin LLM Config Set Default Handler
 * Handles /admin llm-config-set-default subcommand
 * Sets a global config as the system default
 */

import { EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS, type EnvConfig } from '@tzurot/common-types';
import { deferEphemeral, replyWithError, handleCommandError } from '../../utils/commandHelpers.js';

const logger = createLogger('admin-llm-config-set-default');

/**
 * Handle /admin llm-config-set-default
 */
export async function handleLlmConfigSetDefault(
  interaction: ChatInputCommandInteraction,
  config: EnvConfig
): Promise<void> {
  const configId = interaction.options.getString('config', true);

  await deferEphemeral(interaction);

  try {
    const gatewayUrl = config.GATEWAY_URL;
    if (!gatewayUrl) {
      await replyWithError(interaction, 'Gateway URL not configured');
      return;
    }

    const response = await fetch(`${gatewayUrl}/admin/llm-config/${configId}/set-default`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': config.ADMIN_API_KEY ?? '',
      },
    });

    if (!response.ok) {
      const errorData = (await response.json()) as { error?: string };
      await replyWithError(interaction, errorData.error ?? `HTTP ${response.status}`);
      return;
    }

    const data = (await response.json()) as { configName: string };

    const embed = new EmbedBuilder()
      .setTitle('System Default Config Updated')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        `**${data.configName}** is now the system default LLM config.\n\n` +
          'Personalities without a specific config will use this default.'
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info({ configId, configName: data.configName }, '[Admin] Set system default LLM config');
  } catch (error) {
    await handleCommandError(interaction, error, {
      userId: interaction.user.id,
      command: 'Admin LLM Config Set Default',
    });
  }
}
