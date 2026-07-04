/**
 * History Clear Handler
 * Handles /history clear command - soft reset conversation context
 *
 * Receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { historyClearOptions } from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../utils/apiCheck.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { createSuccessEmbed } from '../../utils/commandHelpers.js';

const logger = createLogger('history-clear');

/**
 * Handle /history clear
 */
export async function handleClear(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = historyClearOptions(context.interaction);
  const personalitySlug = options.character();
  const personaId = options.persona(); // Optional profile/persona

  if (
    isAutocompleteErrorSentinel(personalitySlug) ||
    (personaId !== null && isAutocompleteErrorSentinel(personaId))
  ) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return;
  }

  try {
    const { userClient } = clientsFor(context.interaction);
    const body: { personalitySlug: string; personaId?: string } = { personalitySlug };
    if (personaId !== null && personaId.length > 0) {
      body.personaId = personaId;
    }
    const result = await userClient.clearHistory(body);

    if (!result.ok) {
      const errorMessage =
        result.status === 404
          ? `Character "${personalitySlug}" not found.`
          : 'Failed to clear history. Please try again later.';
      logger.warn({ userId, personalitySlug, status: result.status }, 'Clear failed');
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

    logger.info({ userId, personalitySlug, epoch: data.epoch }, 'Context cleared successfully');
  } catch (error) {
    logger.error({ err: error, userId, command: 'History Clear' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
