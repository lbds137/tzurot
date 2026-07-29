/**
 * History Purge Handler
 * Handles /history purge command - permanently delete conversation history
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

import { historyPurgeOptions } from '@tzurot/common-types/generated/commandOptions';
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
} from '../../utils/confirmation/confirmDestructive.js';

const logger = createLogger('history-purge');

/**
 * Handle /history purge
 * Shows warning with danger button. Actual deletion happens in button handler.
 */
export async function handlePurgeHistory(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const channelId = context.channelId;
  const options = historyPurgeOptions(context.interaction);
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
      // 'history-purge' replaced the historical 'hard-delete' token when the
      // subcommand was renamed. Safe rename class: destructive-confirm
      // customIds live only minutes and FAIL CLOSED — an in-flight confirm
      // from before a deploy simply stops routing, never mis-executes.
      source: 'history',
      operation: 'history-purge',
      // Only the channelId (a ≤20-char snowflake) rides the customId — the
      // slug can reach SLUG_MAX_LENGTH (50), which blows Discord's 100-char
      // customId budget and made setCustomId THROW for long-slugged
      // characters. The slug rides the embed footer instead (the shapes
      // pattern) and is read back from the parent message in the handlers.
      entityId: channelId,
      footerText: `slug:${personalitySlug}`,
    });

    // Build and send the warning
    const warning = buildDestructiveWarning(config);

    await context.editReply({
      embeds: warning.embeds,
      components: warning.components,
    });

    logger.info({ userId, personalitySlug, channelId }, 'Showing purge confirmation');
  } catch (error) {
    logger.error({ err: error, userId, command: 'History Purge' }, 'Error');
    await context.editReply({
      content: renderSpec(
        classifyGatewayFailure(error, 'history', { failedAction: 'purge history' })
      ),
    });
  }
}

/**
 * Read the personality slug back out of the warning embed's footer
 * (`slug:{slug}`), where handlePurgeHistory stashed it — the slug is too long
 * for the customId budget. Null on a missing or malformed footer: the flow
 * FAILS CLOSED, consistent with the minutes-lived customId contract.
 */
export function parsePurgeSlugFromFooter(footerText: string | undefined): string | null {
  const prefix = 'slug:';
  if (footerText?.startsWith(prefix) !== true) {
    return null;
  }
  const slug = footerText.slice(prefix.length);
  return slug.length > 0 ? slug : null;
}
