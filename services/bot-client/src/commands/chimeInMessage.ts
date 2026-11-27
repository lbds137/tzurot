/**
 * "Chime In" — message context-menu shortcut to have a character take another
 * turn in the channel.
 *
 * Right-click a character's reply → Apps → Chime In. Resolves the character
 * slug and the clicked reply's incognito state from conversation_history (with
 * legacy footer + trigger-memory inference for rows predating
 * `messageMetadata.incognito`), then runs a weigh-in turn via
 * `runCharacterTurn` with that sticky incognito state.
 *
 * The dispatcher has already deferred this interaction ephemeral (see
 * CommandHandler.handleContextMenuCommand) — replies go through editReply /
 * deleteReply via the deferred context adapter.
 */

import { ApplicationCommandType, ContextMenuCommandBuilder } from 'discord.js';
import { defineContextMenuCommand } from '../utils/defineCommand.js';
import {
  createContextMenuDeferredContext,
  resolveMessageCharacterOrReply,
} from '../utils/messageCharacterLookup.js';
import { runCharacterTurn } from '../services/character/characterTurn.js';

export default defineContextMenuCommand({
  data: new ContextMenuCommandBuilder().setName('Chime In').setType(ApplicationCommandType.Message),

  execute: async interaction => {
    const resolved = await resolveMessageCharacterOrReply(interaction, { needIncognito: true });
    if (resolved === null) {
      return;
    }

    const context = createContextMenuDeferredContext(interaction);
    await runCharacterTurn(context, {
      characterArg: resolved.personalitySlug,
      message: null,
      filters: { excludePrivate: false, onlyMine: false },
      incognitoOption: resolved.incognito,
    });
  },
});
