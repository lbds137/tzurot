/**
 * History Hard-Delete Handler
 * Handles /history hard-delete command - permanently delete conversation history
 *
 * This is a destructive operation that uses the DestructiveConfirmation flow:
 * 1. Shows warning with danger button
 * 2. User clicks danger button → Modal appears
 * 3. User types "DELETE" to confirm
 * 4. If valid → Deletes history permanently
 *
 * Receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { historyHardDeleteOptions } from '@tzurot/common-types/generated/commandOptions';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../utils/apiCheck.js';
import {
  buildDestructiveWarning,
  createHardDeleteConfig,
} from '../../utils/destructiveConfirmation.js';

const logger = createLogger('history-hard-delete');

/**
 * Handle /history hard-delete
 * Shows warning with danger button. Actual deletion happens in button handler.
 */
export async function handleHardDelete(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const channelId = context.channelId;
  const options = historyHardDeleteOptions(context.interaction);
  const personalitySlug = options.character();

  if (isAutocompleteErrorSentinel(personalitySlug)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return;
  }

  try {
    // Create the destructive confirmation config
    const config = createHardDeleteConfig({
      entityType: 'conversation history',
      entityName: personalitySlug,
      additionalWarning:
        '**This action is PERMANENT and cannot be undone!**\n\n' +
        '**Your** conversation history with this character in this channel will be ' +
        'deleted forever (other users\u2019 conversations are not affected).\n' +
        'This includes:\n' +
        '• Your messages\n' +
        '• The character\u2019s responses to you\n' +
        '• Any hidden messages from context clears',
      source: 'history',
      operation: 'hard-delete',
      // Include channelId in entityId so button handler knows which channel
      // Use | delimiter since :: is used by customId parsing
      entityId: `${personalitySlug}|${channelId}`,
    });

    // Build and send the warning
    const warning = buildDestructiveWarning(config);

    await context.editReply({
      embeds: warning.embeds,
      components: warning.components,
    });

    logger.info({ userId, personalitySlug, channelId }, 'Showing hard-delete confirmation');
  } catch (error) {
    logger.error({ err: error, userId, command: 'History Hard-Delete' }, 'Error');
    await context.editReply({
      content: renderSpec(
        classifyGatewayFailure(error, 'history', { failedAction: 'hard-delete history' })
      ),
    });
  }
}

/**
 * Parse the entityId back to personalitySlug and channelId
 * Uses | as delimiter to avoid conflict with :: in customId parsing
 */
export function parseHardDeleteEntityId(entityId: string): {
  personalitySlug: string;
  channelId: string;
} | null {
  const parts = entityId.split('|');
  if (parts.length !== 2) {
    return null;
  }
  return {
    personalitySlug: parts[0],
    channelId: parts[1],
  };
}
