/**
 * History Undo Handler
 * Handles /history undo command - restore previously cleared context
 *
 * Receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { createLogger } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { createSuccessEmbed } from '../../utils/commandHelpers.js';

const logger = createLogger('history-undo');

interface UndoResponse {
  success: boolean;
  restoredEpoch: string | null;
  personaId: string;
  message: string;
}

/**
 * Handle /history undo
 */
export async function handleUndo(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const personalitySlug = context.getRequiredOption<string>('personality');
  const personaId = context.getOption<string>('profile'); // Optional profile/persona

  try {
    // Build request body, only include personaId if explicitly provided
    const body: { personalitySlug: string; personaId?: string } = { personalitySlug };
    if (personaId !== null && personaId.length > 0) {
      body.personaId = personaId;
    }

    const result = await callGatewayApi<UndoResponse>('/user/history/undo', {
      userId,
      method: 'POST',
      body,
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
      await context.editReply({ content: `❌ ${errorMessage}` });
      return;
    }

    const data = result.data;

    const embed = createSuccessEmbed(
      'Context Restored',
      `Previous conversation context with **${personalitySlug}** has been restored.\n\n` +
        'The last clear operation has been undone.\n\n' +
        '*Note: Only one level of undo is supported.*'
    );

    await context.editReply({ embeds: [embed] });

    logger.info(
      { userId, personalitySlug, restoredEpoch: data.restoredEpoch },
      '[History] Context restored successfully'
    );
  } catch (error) {
    logger.error({ err: error, userId, command: 'History Undo' }, '[History Undo] Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
