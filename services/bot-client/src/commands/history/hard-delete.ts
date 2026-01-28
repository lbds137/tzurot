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

import { createLogger, historyHardDeleteOptions } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
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
  const personalitySlug = options.personality();

  try {
    // Create the destructive confirmation config
    const config = createHardDeleteConfig({
      entityType: 'conversation history',
      entityName: personalitySlug,
      additionalWarning:
        '**This action is PERMANENT and cannot be undone!**\n\n' +
        'All messages in this channel with this personality will be deleted forever.\n' +
        'This includes:\n' +
        '• Your messages\n' +
        '• AI responses\n' +
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

    logger.info(
      { userId, personalitySlug, channelId },
      '[History] Showing hard-delete confirmation'
    );
  } catch (error) {
    logger.error(
      { err: error, userId, command: 'History Hard-Delete' },
      '[History Hard-Delete] Error'
    );
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
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
