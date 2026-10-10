/**
 * Small classification helpers shared by the two command-telemetry emission
 * sites (chat-input dispatch and context-menu dispatch) — kept here rather
 * than duplicated in both `commandDispatch.ts` and `CommandHandler.ts`.
 */

import type { ChatInputCommandInteraction, MessageContextMenuCommandInteraction } from 'discord.js';

/** Constructor-name error code, capped to the schema/column's 100-char limit. */
export const MAX_ERROR_CODE_LENGTH = 100;

/** Coarse location class for telemetry. Checked in order because a thread
 *  also carries a guildId, so the thread check precedes the guild check. The
 *  thread signal is read from `interaction.channel`, which discord.js resolves
 *  from the client channel cache only (not verified against discord.js docs;
 *  the interaction keeps just the id), so an uncached thread (`channel` null)
 *  is classified `guild`: thread wins only when the channel is cached. That
 *  undercount is accepted. */
export function classifyChannelKind(
  interaction: ChatInputCommandInteraction | MessageContextMenuCommandInteraction
): 'guild' | 'dm' | 'thread' {
  if (interaction.channel?.isThread() === true) {
    return 'thread';
  }
  if (interaction.guildId === null) {
    return 'dm';
  }
  return 'guild';
}

/** Constructor-name error code for a catch path — never `error.message`,
 *  which can carry user-supplied text; capped to the schema/column limit. */
export function classifyErrorCode(error: unknown): string {
  const name = error instanceof Error ? error.constructor.name : 'UnknownError';
  return name.slice(0, MAX_ERROR_CODE_LENGTH);
}
