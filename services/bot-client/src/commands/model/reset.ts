/**
 * Model Reset Handler
 * Handles /model reset subcommand
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import {
  deferEphemeral,
  replyWithError,
  handleCommandError,
  createSuccessEmbed,
} from '../../utils/commandHelpers.js';

const logger = createLogger('model-reset');

/**
 * Handle /model reset
 */
export async function handleReset(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const personalityId = interaction.options.getString('personality', true);

  await deferEphemeral(interaction);

  try {
    const result = await callGatewayApi<void>(`/user/model-override/${personalityId}`, {
      method: 'DELETE',
      userId,
    });

    if (!result.ok) {
      logger.warn(
        { userId, status: result.status, personalityId },
        '[Model] Failed to reset override'
      );
      await replyWithError(interaction, `Failed to reset model: ${result.error}`);
      return;
    }

    const embed = createSuccessEmbed(
      '🔄 Model Override Removed',
      'The personality will now use its default model configuration.'
    );
    await interaction.editReply({ embeds: [embed] });

    logger.info({ userId, personalityId }, '[Model] Reset override');
  } catch (error) {
    await handleCommandError(interaction, error, { userId, command: 'Model Reset' });
  }
}
