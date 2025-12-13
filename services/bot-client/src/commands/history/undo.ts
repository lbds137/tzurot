/**
 * History Undo Handler
 * Handles /history undo command - restore previously cleared context
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

const logger = createLogger('history-undo');

interface UndoResponse {
  success: boolean;
  restoredEpoch: string | null;
  message: string;
}

/**
 * Handle /history undo
 */
export async function handleUndo(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const personalitySlug = interaction.options.getString('personality', true);

  await deferEphemeral(interaction);

  try {
    const result = await callGatewayApi<UndoResponse>('/user/history/undo', {
      userId,
      method: 'POST',
      body: { personalitySlug },
    });

    if (!result.ok) {
      let errorMessage: string;
      if (result.status === 404) {
        errorMessage = `Personality "${personalitySlug}" not found.`;
      } else if (result.status === 400) {
        errorMessage =
          'No previous context to restore. Undo is only available after a clear operation.';
      } else {
        errorMessage = 'Failed to undo. Please try again later.';
      }
      logger.warn({ userId, personalitySlug, status: result.status }, '[History] Undo failed');
      await replyWithError(interaction, errorMessage);
      return;
    }

    const data = result.data;

    const embed = createSuccessEmbed(
      'Context Restored',
      `Previous conversation context with **${personalitySlug}** has been restored.\n\n` +
        'The last clear operation has been undone.'
    );

    await interaction.editReply({ embeds: [embed] });

    logger.info(
      { userId, personalitySlug, restoredEpoch: data.restoredEpoch },
      '[History] Context restored successfully'
    );
  } catch (error) {
    await handleCommandError(interaction, error, { userId, command: 'History Undo' });
  }
}
