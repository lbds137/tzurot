/**
 * Preset Delete Handler
 * Handles /preset delete subcommand
 */

import { createLogger } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { createSuccessEmbed } from '../../utils/commandHelpers.js';

const logger = createLogger('preset-delete');

/**
 * Handle /preset delete
 */
export async function handleDelete(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const presetId = context.interaction.options.getString('preset', true);

  try {
    const result = await callGatewayApi<void>(`/user/llm-config/${presetId}`, {
      method: 'DELETE',
      userId,
    });

    if (!result.ok) {
      logger.warn({ userId, status: result.status, presetId }, '[Preset] Failed to delete preset');
      await context.editReply({ content: `❌ Failed to delete preset: ${result.error}` });
      return;
    }

    const embed = createSuccessEmbed('🗑️ Preset Deleted', 'Your preset has been deleted.');
    await context.editReply({ embeds: [embed] });

    logger.info({ userId, presetId }, '[Preset] Deleted preset');
  } catch (error) {
    logger.error({ err: error, userId }, '[Preset] Error deleting preset');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
