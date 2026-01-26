/**
 * Me Preset Reset Handler
 * Handles /me preset reset subcommand
 */

import { createLogger } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { callGatewayApi } from '../../../utils/userGatewayClient.js';
import { createSuccessEmbed, createInfoEmbed } from '../../../utils/commandHelpers.js';

const logger = createLogger('me-preset-reset');

interface ResetResponse {
  deleted: boolean;
  wasSet?: boolean; // false if no override existed
}

/**
 * Handle /me preset reset
 */
export async function handleReset(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const personalityId = context.interaction.options.getString('personality', true);

  try {
    const result = await callGatewayApi<ResetResponse>(`/user/model-override/${personalityId}`, {
      method: 'DELETE',
      userId,
    });

    if (!result.ok) {
      logger.warn(
        { userId, status: result.status, personalityId },
        '[Me/Preset] Failed to reset override'
      );
      await context.editReply({ content: `❌ Failed to reset preset: ${result.error}` });
      return;
    }

    // Check if there was actually an override to remove
    const wasSet = result.data.wasSet !== false;

    const embed = wasSet
      ? createSuccessEmbed(
          '🔄 Preset Override Removed',
          'The personality will now use its default preset.'
        )
      : createInfoEmbed(
          'ℹ️ No Override Set',
          'This personality was already using its default preset.'
        );

    await context.editReply({ embeds: [embed] });

    logger.info({ userId, personalityId, wasSet }, '[Me/Preset] Reset override');
  } catch (error) {
    logger.error({ err: error, userId, command: 'Preset Reset' }, '[Preset Reset] Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
