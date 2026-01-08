/**
 * Me Preset Reset Handler
 * Handles /me preset reset subcommand
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { callGatewayApi } from '../../../utils/userGatewayClient.js';
import {
  replyWithError,
  handleCommandError,
  createSuccessEmbed,
} from '../../../utils/commandHelpers.js';

const logger = createLogger('me-preset-reset');

/**
 * Handle /me preset reset
 */
export async function handleReset(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const personalityId = interaction.options.getString('personality', true);

  try {
    const result = await callGatewayApi<void>(`/user/model-override/${personalityId}`, {
      method: 'DELETE',
      userId,
    });

    if (!result.ok) {
      logger.warn(
        { userId, status: result.status, personalityId },
        '[Me/Preset] Failed to reset override'
      );
      await replyWithError(interaction, `Failed to reset preset: ${result.error}`);
      return;
    }

    const embed = createSuccessEmbed(
      '🔄 Preset Override Removed',
      'The personality will now use its default preset.'
    );
    await interaction.editReply({ embeds: [embed] });

    logger.info({ userId, personalityId }, '[Me/Preset] Reset override');
  } catch (error) {
    await handleCommandError(interaction, error, { userId, command: 'Preset Reset' });
  }
}
