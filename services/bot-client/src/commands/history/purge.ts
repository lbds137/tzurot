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

import {
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  PermissionFlagsBits,
} from 'discord.js';
import { historyPurgeOptions } from '@tzurot/common-types/generated/commandOptions';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
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

// The wire token deliberately differs from the 'purge' subcommand name: it
// replaced the historical 'hard-delete' token at the rename, and namespacing
// it as 'history-purge' keeps destructive operations globally distinct.
export const HISTORY_PURGE_OPERATION = 'history-purge';
// The channel-wide variant rides a SECOND operation token rather than an
// entityId suffix: entityId stays the bare channelId, so the destructive
// customId parser is untouched and the scope is carried by routing.
export const HISTORY_PURGE_ALL_OPERATION = 'history-purge-all';

/** The action phrase in the permission-denied spec, shared by the invocation and the submit re-check. */
export const CHANNEL_WIDE_PURGE_ACTION =
  'purge everyone’s conversation history in this channel (needs **Manage Messages**)';

/** Map a parsed destructive operation token to its purge scope, or null when it is not a purge. */
export function purgeScopeForOperation(operation: string): 'own' | 'everyone' | null {
  if (operation === HISTORY_PURGE_OPERATION) {
    return 'own';
  }
  if (operation === HISTORY_PURGE_ALL_OPERATION) {
    return 'everyone';
  }
  return null;
}

/**
 * Whether the interacting user may run the channel-wide purge.
 *
 * Reads `interaction.memberPermissions` — the CHANNEL-scoped source — not
 * `member.permissions`, which discord.js documents as taking only roles and
 * owner status into account and is therefore blind to per-channel overwrites.
 * This purge governs one channel, so a moderator denied Manage Messages by an
 * overwrite HERE must not delete this channel's history. Using the same source
 * at invocation and at modal submit also keeps the two checks from disagreeing.
 * `memberPermissions` is null in a DM, so `everyone` there is bot-owner-only.
 * Precedent: `commands/channel/settings.ts` (the dashboard's open check and its
 * per-click `denyIfPermissionRevoked` re-check).
 */
export function hasChannelWidePurgePermission(
  interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction
): boolean {
  if (isBotOwner(interaction.user.id)) {
    return true;
  }
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) === true;
}

/**
 * Handle /history purge
 * Shows the warning with its danger button; the button opens the typed-phrase
 * modal, and the actual deletion happens in the modal-submit handler.
 */
export async function handlePurgeHistory(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const channelId = context.channelId;
  const options = historyPurgeOptions(context.interaction);
  const personalitySlug = options.character();
  const scope = options.scope() === 'everyone' ? 'everyone' : 'own';

  if (isAutocompleteErrorSentinel(personalitySlug)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return;
  }

  if (scope === 'everyone' && !hasChannelWidePurgePermission(context.interaction)) {
    await context.editReply({
      content: renderSpec(CATALOG.error.permissionDenied(CHANNEL_WIDE_PURGE_ACTION)),
    });
    return;
  }

  try {
    // Create the destructive confirmation config
    const config = createHardDeleteConfig({
      entityType: 'conversation history',
      entityName: personalitySlug,
      additionalWarning:
        scope === 'everyone'
          ? '**This action is PERMANENT and cannot be undone!**\n\n' +
            '**ALL users’** conversation history with this character in this channel will be ' +
            'deleted forever — not just yours.\n' +
            'This includes:\n' +
            '• Every user’s messages\n' +
            '• The character’s responses to them\n' +
            '• Any hidden messages from context clears\n\n' +
            'Long-term memories derived from those conversations are retired too ' +
            '(pinned memories are kept).'
          : '**This action is PERMANENT and cannot be undone!**\n\n' +
            '**Your** conversation history with this character in this channel will be ' +
            'deleted forever (other users’ conversations are not affected).\n' +
            'This includes:\n' +
            '• Your messages\n' +
            '• The character’s responses to you\n' +
            '• Any hidden messages from context clears',
      // 'history-purge' replaced the historical 'hard-delete' token when the
      // subcommand was renamed. Safe rename class: destructive-confirm
      // customIds live only minutes and FAIL CLOSED — an in-flight confirm
      // from before a deploy simply stops routing, never mis-executes.
      source: 'history',
      operation: scope === 'everyone' ? HISTORY_PURGE_ALL_OPERATION : HISTORY_PURGE_OPERATION,
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

    logger.info({ userId, personalitySlug, channelId, scope }, 'Showing purge confirmation');
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
