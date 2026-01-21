/**
 * History Clear Handler
 * Handles /history clear command - soft reset conversation context
 *
 * Receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { createLogger } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { createSuccessEmbed } from '../../utils/commandHelpers.js';

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
export async function handleClear(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const personalitySlug = context.getRequiredOption<string>('personality');
  const personaId = context.getOption<string>('profile'); // Optional profile/persona

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
      await context.editReply({ content: `❌ ${errorMessage}` });
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

    await context.editReply({ embeds: [embed] });

    logger.info(
      { userId, personalitySlug, epoch: data.epoch },
      '[History] Context cleared successfully'
    );
  } catch (error) {
    logger.error({ err: error, userId, command: 'History Clear' }, '[History Clear] Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
