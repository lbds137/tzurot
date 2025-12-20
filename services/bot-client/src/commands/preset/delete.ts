/**
 * Preset Delete Handler
 * Handles /preset delete subcommand
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import {
  replyWithError,
  handleCommandError,
  createSuccessEmbed,
} from '../../utils/commandHelpers.js';

const logger = createLogger('preset-delete');

/**
 * Handle /preset delete
 */
export async function handleDelete(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const presetId = interaction.options.getString('preset', true);

  try {
    const result = await callGatewayApi<void>(`/user/llm-config/${presetId}`, {
      method: 'DELETE',
      userId,
    });

    if (!result.ok) {
      logger.warn({ userId, status: result.status, presetId }, '[Preset] Failed to delete preset');
      await replyWithError(interaction, `Failed to delete preset: ${result.error}`);
      return;
    }

    const embed = createSuccessEmbed('🗑️ Preset Deleted', 'Your preset has been deleted.');
    await interaction.editReply({ embeds: [embed] });

    logger.info({ userId, presetId }, '[Preset] Deleted preset');
  } catch (error) {
    await handleCommandError(interaction, error, { userId, command: 'Preset Delete' });
  }
}
