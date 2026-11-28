/**
 * Applies an edited reply's chunk plan to Discord.
 *
 * Guild replies were sent through the channel webhook and can only be changed
 * through that same webhook; DM replies are plain bot messages. Both paths share
 * one shape: edit the overlapping chunks in place, then send extra chunks or
 * delete surplus ones.
 */

import {
  DiscordAPIError,
  RESTJSONErrorCodes,
  type DMChannel,
  type Message,
  type Webhook,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { redisService } from '../../redis.js';

const logger = createLogger('edit-response-discord');

/** Discord refuses these when the message can no longer be edited by this bot. */
const UNEDITABLE_CODES: ReadonlySet<number> = new Set([
  RESTJSONErrorCodes.UnknownWebhook,
  RESTJSONErrorCodes.CannotEditMessageAuthoredByAnotherUser,
  RESTJSONErrorCodes.UnknownMessage,
]);

/** True when the error means the message is no longer editable by the bot. */
export function isUneditableError(error: unknown): boolean {
  return error instanceof DiscordAPIError && UNEDITABLE_CODES.has(Number(error.code));
}

/** Where the edited chunks are written. */
export type EditTarget =
  | {
      kind: 'webhook';
      webhook: Webhook;
      /** Thread the webhook message lives in, when the channel is a thread. */
      threadId: string | undefined;
      /** Speaker identity for extra chunks, copied from the live first chunk. */
      username: string;
      avatarURL: string;
      personalityId: string;
    }
  | { kind: 'dm'; channel: Pick<DMChannel, 'send'> };

export type ApplyResult =
  { ok: true; messageIds: string[] } | { ok: false; reason: 'uneditable' | 'error' };

const NO_MENTIONS = { parse: [] as never[] };

async function editChunk(target: EditTarget, live: Message, content: string): Promise<void> {
  if (target.kind === 'webhook') {
    await target.webhook.editMessage(live.id, {
      content,
      threadId: target.threadId,
      attachments: [],
      allowedMentions: NO_MENTIONS,
    });
    return;
  }
  await live.edit({ content, attachments: [], allowedMentions: NO_MENTIONS });
}

async function sendChunk(target: EditTarget, content: string): Promise<string> {
  if (target.kind === 'webhook') {
    const sent = await target.webhook.send({
      content,
      username: target.username,
      avatarURL: target.avatarURL,
      threadId: target.threadId,
      allowedMentions: NO_MENTIONS,
    });
    await redisService.storeWebhookMessage(sent.id, target.personalityId);
    return sent.id;
  }
  const sent = await target.channel.send({ content, allowedMentions: NO_MENTIONS });
  return sent.id;
}

async function deleteChunk(target: EditTarget, live: Message): Promise<void> {
  if (target.kind === 'webhook') {
    await target.webhook.deleteMessage(live.id, target.threadId);
    return;
  }
  await live.delete();
}

/**
 * Edit the live chunks to carry `newChunks`, adding or removing trailing chunks
 * as the count changes.
 *
 * A failure on the FIRST edit returns `ok: false` with nothing changed on
 * Discord, so the caller can stop before touching the database. A failure on
 * any later operation is logged and the walk continues: Discord is then
 * partially the new text, and the caller still records the user's intent. This
 * partial-failure mode is deliberate; the returned `messageIds` list only the
 * messages that actually exist afterwards.
 */
export async function applyEditedChunks(
  target: EditTarget,
  liveChunks: readonly Message[],
  newChunks: readonly string[]
): Promise<ApplyResult> {
  const overlap = Math.min(liveChunks.length, newChunks.length);
  const messageIds: string[] = [];

  for (let i = 0; i < overlap; i++) {
    try {
      await editChunk(target, liveChunks[i], newChunks[i]);
    } catch (error) {
      if (i === 0) {
        logger.warn(
          { err: error, messageId: liveChunks[i].id },
          'First chunk edit failed; nothing changed'
        );
        return { ok: false, reason: isUneditableError(error) ? 'uneditable' : 'error' };
      }
      logger.warn({ err: error, messageId: liveChunks[i].id }, 'Later chunk edit failed');
    }
    messageIds.push(liveChunks[i].id);
  }

  messageIds.push(...(await sendExtraChunks(target, newChunks, overlap)));
  messageIds.push(...(await deleteSurplusChunks(target, liveChunks, overlap)));

  return { ok: true, messageIds };
}

/** Send chunks beyond the live count; stops at the first failure. */
async function sendExtraChunks(
  target: EditTarget,
  newChunks: readonly string[],
  from: number
): Promise<string[]> {
  const sent: string[] = [];
  for (let i = from; i < newChunks.length; i++) {
    try {
      sent.push(await sendChunk(target, newChunks[i]));
    } catch (error) {
      logger.warn({ err: error, chunkIndex: i }, 'Extra chunk send failed');
      break;
    }
  }
  return sent;
}

/** Delete surplus live chunks; returns the ids of any that could not be deleted. */
async function deleteSurplusChunks(
  target: EditTarget,
  liveChunks: readonly Message[],
  from: number
): Promise<string[]> {
  const survivors: string[] = [];
  for (let i = from; i < liveChunks.length; i++) {
    try {
      await deleteChunk(target, liveChunks[i]);
    } catch (error) {
      logger.warn({ err: error, messageId: liveChunks[i].id }, 'Surplus chunk delete failed');
      survivors.push(liveChunks[i].id);
    }
  }
  return survivors;
}
