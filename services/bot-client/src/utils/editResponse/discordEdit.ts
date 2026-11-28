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
  | { kind: 'dm'; channel: Pick<DMChannel, 'send'>; personalityId: string };

export type ApplyResult =
  | { ok: true; messageIds: string[]; partial: boolean }
  | { ok: false; reason: 'uneditable' | 'error' };

const NO_MENTIONS = { parse: [] as never[] };

// Edits clear attachments on purpose: the only attachment a reply carries is the TTS
// audio on its last chunk (DiscordResponseSender `ttsFiles`), which would speak the old
// text. Regenerating it is a tracked follow-up.
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

/** Record the sent message so replies to it route to the personality. */
async function recordSentMessage(messageId: string, personalityId: string): Promise<void> {
  try {
    await redisService.storeWebhookMessage(messageId, personalityId);
  } catch (error) {
    // The message already exists on Discord; losing its id here would orphan it.
    logger.warn({ err: error, messageId }, 'Webhook message bookkeeping failed');
  }
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
    await recordSentMessage(sent.id, target.personalityId);
    return sent.id;
  }
  const sent = await target.channel.send({ content, allowedMentions: NO_MENTIONS });
  await recordSentMessage(sent.id, target.personalityId);
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
 * partial-failure mode is deliberate: `partial` is true when any operation
 * after the first edit failed. `messageIds` lists the chunks known or assumed
 * to still exist; a chunk whose edit failed transiently is assumed to exist,
 * while one refused as uneditable (gone or not ours) is omitted.
 */
export async function applyEditedChunks(
  target: EditTarget,
  liveChunks: readonly Message[],
  newChunks: readonly string[]
): Promise<ApplyResult> {
  const overlap = Math.min(liveChunks.length, newChunks.length);
  const messageIds: string[] = [];
  let partial = false;

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
      partial = true;
      if (isUneditableError(error)) {
        continue;
      }
    }
    messageIds.push(liveChunks[i].id);
  }

  const extras = await sendExtraChunks(target, newChunks, overlap);
  const surplus = await deleteSurplusChunks(target, liveChunks, overlap);
  messageIds.push(...extras.ids, ...surplus.ids);

  return { ok: true, messageIds, partial: partial || extras.failed || surplus.failed };
}

/** Send chunks beyond the live count; stops at the first failure and reports it. */
async function sendExtraChunks(
  target: EditTarget,
  newChunks: readonly string[],
  from: number
): Promise<{ ids: string[]; failed: boolean }> {
  const sent: string[] = [];
  for (let i = from; i < newChunks.length; i++) {
    try {
      sent.push(await sendChunk(target, newChunks[i]));
    } catch (error) {
      logger.warn({ err: error, chunkIndex: i }, 'Extra chunk send failed');
      return { ids: sent, failed: true };
    }
  }
  return { ids: sent, failed: false };
}

/** Delete surplus live chunks; returns the ids of any that could not be deleted. */
async function deleteSurplusChunks(
  target: EditTarget,
  liveChunks: readonly Message[],
  from: number
): Promise<{ ids: string[]; failed: boolean }> {
  // A deleted chunk's Redis mapping is left to expire by TTL; a deleted message cannot be replied to.
  const survivors: string[] = [];
  for (let i = from; i < liveChunks.length; i++) {
    try {
      await deleteChunk(target, liveChunks[i]);
    } catch (error) {
      logger.warn({ err: error, messageId: liveChunks[i].id }, 'Surplus chunk delete failed');
      survivors.push(liveChunks[i].id);
    }
  }
  return { ids: survivors, failed: survivors.length > 0 };
}
