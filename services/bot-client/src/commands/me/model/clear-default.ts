/**
 * Me Model Clear-Default Handler
 * Handles /me model clear-default subcommand
 * Clears the user's global default LLM config
 */

import { EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { callGatewayApi } from '../../../utils/userGatewayClient.js';
import { replyWithError, handleCommandError } from '../../../utils/commandHelpers.js';

const logger = createLogger('me-model-clear-default');

/**
 * Handle /me model clear-default
 */
export async function handleClearDefault(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;

  try {
    const result = await callGatewayApi<{ deleted: boolean }>('/user/model-override/default', {
      method: 'DELETE',
      userId,
    });

    if (!result.ok) {
      logger.warn({ userId, status: result.status }, '[Me/Model] Failed to clear default');
      await replyWithError(interaction, `Failed to clear default: ${result.error}`);
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ Default Config Cleared')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        'Your default LLM config has been removed.\n\n' +
          'Personalities will now use their own defaults unless you have a specific override.'
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info({ userId }, '[Me/Model] Cleared default config');
  } catch (error) {
    await handleCommandError(interaction, error, { userId, command: 'Model Clear-Default' });
  }
}
