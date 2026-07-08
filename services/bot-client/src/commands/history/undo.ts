/**
 * History Undo Handler
 * Handles /history undo command - restore previously cleared context
 *
 * Receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { escapeMarkdown } from 'discord.js';
import { historyUndoOptions } from '@tzurot/common-types/generated/commandOptions';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../utils/apiCheck.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { createSuccessEmbed } from '../../utils/commandHelpers.js';

const logger = createLogger('history-undo');

/**
 * Handle /history undo
 */
export async function handleUndo(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = historyUndoOptions(context.interaction);
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
    const result = await userClient.undoHistory(body);

    if (!result.ok) {
      logger.warn({ userId, personalitySlug, status: result.status }, 'Undo failed');
      await context.editReply({
        content:
          result.status === 404
            ? renderSpec(
                CATALOG.error.notFound('Character', { name: escapeMarkdown(personalitySlug) })
              )
            : result.status === 400
              ? renderSpec(
                  CATALOG.error.validation(
                    'No previous context to restore. Undo is only available after a clear operation.'
                  )
                )
              : renderSpec(classifyGatewayFailure(result, 'history', { failedAction: 'undo' })),
      });
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
      'Context restored successfully'
    );
  } catch (error) {
    logger.error({ err: error, userId, command: 'History Undo' }, 'Error');
    await context.editReply({
      content: renderSpec(classifyGatewayFailure(error, 'history', { failedAction: 'undo' })),
    });
  }
}
