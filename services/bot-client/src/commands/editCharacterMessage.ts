/**
 * "Edit Character" — message context-menu shortcut to open a character's edit
 * dashboard from one of its replies.
 *
 * Right-click a character's reply → Apps → Edit Character. Resolves the
 * character slug from conversation_history by the clicked Discord message id,
 * then opens the same dashboard `/character edit` opens (including the same
 * `canEdit` permission check and dashboard session storage).
 *
 * The dispatcher has already deferred this interaction ephemeral (see
 * CommandHandler.handleContextMenuCommand) — replies go through editReply.
 */

import { ApplicationCommandType, ContextMenuCommandBuilder } from 'discord.js';
import { getConfig } from '@tzurot/common-types/config/config';
import { defineContextMenuCommand } from '../utils/defineCommand.js';
import {
  createContextMenuDeferredContext,
  resolveMessageCharacterOrReply,
} from '../utils/messageCharacterLookup.js';
import { openCharacterEditDashboard } from './character/edit.js';

export default defineContextMenuCommand({
  data: new ContextMenuCommandBuilder()
    .setName('Edit Character')
    .setType(ApplicationCommandType.Message),

  execute: async interaction => {
    const resolved = await resolveMessageCharacterOrReply(interaction);
    if (resolved === null) {
      return;
    }

    const context = createContextMenuDeferredContext(interaction);
    await openCharacterEditDashboard(context, resolved.personalitySlug, getConfig());
  },
});
