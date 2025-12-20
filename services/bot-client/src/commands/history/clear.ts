/**
 * History Clear Handler
 * Handles /history clear command - soft reset conversation context
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import {
  replyWithError,
  handleCommandError,
  createSuccessEmbed,
} from '../../utils/commandHelpers.js';

const logger = createLogger('history-clear');

interface ClearResponse {
  success: boolean;
  epoch: string;
  personaId: string;
  canUndo: boolean;
  message: string;
}

/**
 * Handle /history clear
 */
export async function handleClear(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const personalitySlug = interaction.options.getString('personality', true);
  const personaId = interaction.options.getString('profile', false); // Optional profile/persona

  try {
    // Build request body, only include personaId if explicitly provided
    const body: { personalitySlug: string; personaId?: string } = { personalitySlug };
    if (personaId !== null && personaId.length > 0) {
      body.personaId = personaId;
    }

    const result = await callGatewayApi<ClearResponse>('/user/history/clear', {
      userId,
      method: 'POST',
      body,
    });

    if (!result.ok) {
      const errorMessage =
        result.status === 404
          ? `Personality "${personalitySlug}" not found.`
          : 'Failed to clear history. Please try again later.';
      logger.warn({ userId, personalitySlug, status: result.status }, '[History] Clear failed');
      await replyWithError(interaction, errorMessage);
      return;
    }

    const data = result.data;

    const embed = createSuccessEmbed(
      'Context Cleared',
      `Conversation context with **${personalitySlug}** has been cleared.\n\n` +
        'Previous messages will no longer be included in AI responses.'
    ).addFields({
      name: 'Undo Available',
      value: data.canUndo
        ? 'Use `/history undo` to restore the previous context.'
        : 'This was your first clear, no previous context to restore.',
      inline: false,
    });

    await interaction.editReply({ embeds: [embed] });

    logger.info(
      { userId, personalitySlug, epoch: data.epoch },
      '[History] Context cleared successfully'
    );
  } catch (error) {
    await handleCommandError(interaction, error, { userId, command: 'History Clear' });
  }
}
