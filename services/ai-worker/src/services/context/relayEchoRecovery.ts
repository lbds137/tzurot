/**
 * Relay-echo identity recovery.
 *
 * A `/chat` relay-echo is the bot reposting user input as
 * `**Name:** …` (the DM-style path where webhooks don't work). It's
 * bot-authored, so the extended-context fetch can't see the human behind it —
 * the message arrives role=user with no resolvable persona (the resolver strips
 * its unresolvable bot personaId to '') and the bot's webhook name as
 * discordUsername. But the SAME message was persisted with the human's persona,
 * recoverable by discord message id. Restoring it keeps a single human one
 * identity in the chat log instead of fragmenting `Lila (@lbds137)` (direct)
 * from `Lila (@bot-webhook)` (relayed).
 *
 * Extracted from ContextAssembler to keep that file under the 400-line cap.
 */

import { MessageRole } from '@tzurot/common-types/constants/message';
import { INTERNAL_DISCORD_ID_PREFIX } from '@tzurot/common-types/constants/personaId';
import { type ConversationMessage } from '@tzurot/common-types/types/conversationMessage';
import type { ContextDataSource } from './types.js';

/**
 * A user message's personaId is "resolved" only when it's a real persona UUID —
 * not '' (the resolver's strip sentinel for an unresolvable author), and not a
 * raw `discord:<id>` placeholder (the resolver was skipped because no users
 * needed resolving). Relay-echoes fail this and become recovery candidates.
 */
function hasResolvedPersonaId(personaId: string | undefined): boolean {
  return (
    personaId !== undefined &&
    personaId.length > 0 &&
    !personaId.startsWith(INTERNAL_DISCORD_ID_PREFIX)
  );
}

/**
 * Recover the originating human's identity for relay-echo user messages, in
 * place. Must run AFTER persona resolution (which strips the bot personaId to
 * ''). Messages with a resolved personaId, or with no matching persisted row,
 * are left untouched (graceful fallback to the bot-name attribution).
 *
 * MUTATES the `messages` elements in place (personaId / personaName /
 * discordUsername); callers must not alias elements they need to keep pristine.
 * Safe as long as callers always fetch fresh per-request rows; a caller passing
 * objects from a shared cache (e.g. an L2 in-memory history layer) must clone them
 * first.
 */
export async function recoverRelayEchoIdentities(
  messages: ConversationMessage[],
  dataSource: Pick<ContextDataSource, 'getUserIdentitiesByDiscordIds'>
): Promise<void> {
  const candidates = messages.filter(
    message =>
      message.role === MessageRole.User &&
      !hasResolvedPersonaId(message.personaId) &&
      (message.discordMessageId ?? []).length > 0
  );
  if (candidates.length === 0) {
    return;
  }
  const ids = [...new Set(candidates.flatMap(message => message.discordMessageId ?? []))];
  const identityById = await dataSource.getUserIdentitiesByDiscordIds(ids);
  for (const message of candidates) {
    for (const id of message.discordMessageId ?? []) {
      const identity = identityById.get(id);
      if (identity !== undefined) {
        message.personaId = identity.personaId;
        message.personaName = identity.personaName;
        message.discordUsername = identity.discordUsername;
        break;
      }
    }
  }
}
