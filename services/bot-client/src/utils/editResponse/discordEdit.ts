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

/** Discord says the message or its channel no longer exists (deleted since it was read). */
const GONE_CODES: ReadonlySet<number> = new Set([
  RESTJSONErrorCodes.UnknownMessage,
  RESTJSONErrorCodes.UnknownChannel,
]);

/** True when the error means the message (or its channel) is gone. */
export function isGoneError(error: unknown): boolean {
  return error instanceof DiscordAPIError && GONE_CODES.has(Number(error.code));
}

/**
 * Run one undo or cleanup step. A target that is already gone counts as done
 * (null); any other failure comes back for the caller to log and count.
 */
async function failedStep(step: () => Promise<void>): Promise<{ error: unknown } | null> {
  try {
    await step();
    return null;
  } catch (error) {
    return isGoneError(error) ? null : { error };
  }
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

/**
 * How an edit treats a chunk's attachments. A reply's only attachment is the
 * TTS audio on its last chunk (DiscordResponseSender `ttsFiles`), which would
 * speak the old text. `clear` removes it with the text edit (Edit Response);
 * `keep` leaves it alone: discord.js builds the PATCH body from
 * `MessagePayload`, which leaves `attachments` undefined when neither
 * `files` nor `attachments` is passed, so the field is omitted and Discord
 * keeps the existing ones (code-read in discord.js 14.28.1
 * `MessagePayload.js` and `Webhook#editMessage`; not runtime-confirmed).
 */
type AttachmentMode = 'keep' | 'clear';

async function editChunk(
  target: EditTarget,
  live: Message,
  content: string,
  attachments: AttachmentMode
): Promise<void> {
  const clear = attachments === 'clear' ? { attachments: [] } : {};
  if (target.kind === 'webhook') {
    await target.webhook.editMessage(live.id, {
      content,
      threadId: target.threadId,
      ...clear,
      allowedMentions: NO_MENTIONS,
    });
    return;
  }
  await live.edit({ content, ...clear, allowedMentions: NO_MENTIONS });
}

/** Remove a chunk's attachments without touching its text. */
async function clearAttachments(target: EditTarget, live: Message): Promise<void> {
  if (target.kind === 'webhook') {
    await target.webhook.editMessage(live.id, {
      threadId: target.threadId,
      attachments: [],
      allowedMentions: NO_MENTIONS,
    });
    return;
  }
  await live.edit({ attachments: [], allowedMentions: NO_MENTIONS });
}

async function sendChunk(target: EditTarget, content: string): Promise<Message> {
  if (target.kind === 'webhook') {
    const sent = await target.webhook.send({
      content,
      username: target.username,
      avatarURL: target.avatarURL,
      threadId: target.threadId,
      allowedMentions: NO_MENTIONS,
    });
    await redisService.storeWebhookMessage(sent.id, target.personalityId);
    return sent;
  }
  const sent = await target.channel.send({ content, allowedMentions: NO_MENTIONS });
  await redisService.storeWebhookMessage(sent.id, target.personalityId);
  return sent;
}

async function deleteChunk(
  target: EditTarget,
  live: Pick<Message, 'id' | 'delete'>
): Promise<void> {
  if (target.kind === 'webhook') {
    await target.webhook.deleteMessage(live.id, target.threadId);
    return;
  }
  await live.delete();
}

/**
 * The state after the first phase of an edit: what changed on Discord, and
 * what the second phase (`finishEditedChunks`) or an undo
 * (`restoreEditedChunks`) needs.
 */
export interface BegunEdit {
  ok: true;
  /** Chunks that carry the new text and stay: the edited overlap, then the sent extras. */
  messageIds: string[];
  /** True when an operation after the first edit failed. */
  partial: boolean;
  /** Overlap chunks that were edited, with the text they held before. */
  edited: { live: Message; before: string }[];
  /** Extra chunks this phase sent; an undo deletes them. */
  extras: Pick<Message, 'id' | 'delete'>[];
  /** Live chunks beyond the new count; deleted by `finishEditedChunks`, untouched until then. */
  surplus: Message[];
  /** Whether the text edits already cleared attachments (`clear` mode). */
  attachmentsCleared: boolean;
}

/**
 * Phase 1: edit the overlapping chunks and send the extra chunks. Deletes
 * nothing and, in `keep` mode, leaves every attachment, so `restoreEditedChunks`
 * can undo it with edits alone: nothing is ever re-sent below a newer message.
 *
 * A failure on the FIRST edit returns `ok: false` with nothing changed on
 * Discord. A failure on a later operation is logged and the walk continues
 * (`partial`); a chunk whose edit failed transiently is assumed to exist, one
 * refused as uneditable (gone or not ours) is omitted from `messageIds`.
 */
export async function beginEditedChunks(
  target: EditTarget,
  liveChunks: readonly Message[],
  newChunks: readonly string[],
  attachments: AttachmentMode = 'keep',
  onExtraSent?: (messageId: string) => Promise<void>
): Promise<BegunEdit | { ok: false; reason: 'uneditable' | 'error' }> {
  const overlap = Math.min(liveChunks.length, newChunks.length);
  const messageIds: string[] = [];
  const edited: BegunEdit['edited'] = [];
  let partial = false;

  for (let i = 0; i < overlap; i++) {
    const before = liveChunks[i].content;
    try {
      await editChunk(target, liveChunks[i], newChunks[i], attachments);
      edited.push({ live: liveChunks[i], before });
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

  const extras = await sendExtraChunks(target, newChunks, overlap, onExtraSent);
  messageIds.push(...extras.sent.map(sent => sent.id));
  return {
    ok: true,
    messageIds,
    partial: partial || extras.failed,
    edited,
    extras: extras.sent,
    surplus: liveChunks.slice(overlap),
    attachmentsCleared: attachments === 'clear',
  };
}

/**
 * Phase 2, after the history commit landed: delete the surplus chunks and clear
 * the stale attachments on the chunks that carried them. Never throws; a
 * failure is logged and reported (`ok: false`). `survivorIds` are surplus
 * chunks that could not be deleted: they still exist on Discord but are not in
 * the committed row's ids.
 */
export async function finishEditedChunks(
  target: EditTarget,
  begun: BegunEdit
): Promise<{ ok: boolean; survivorIds: string[] }> {
  const survivorIds: string[] = [];
  let ok = true;
  for (const live of begun.surplus) {
    const failure = await failedStep(() => deleteChunk(target, live));
    if (failure !== null) {
      logger.warn({ err: failure.error, messageId: live.id }, 'Surplus chunk delete failed');
      survivorIds.push(live.id);
      ok = false;
    }
  }
  const carriers = begun.attachmentsCleared
    ? []
    : begun.edited.filter(({ live }) => live.attachments.size > 0);
  for (const { live } of carriers) {
    const failure = await failedStep(() => clearAttachments(target, live));
    if (failure !== null) {
      logger.warn({ err: failure.error, messageId: live.id }, 'Attachment clear failed');
      ok = false;
    }
  }
  return { ok, survivorIds };
}

/**
 * Undo phase 1: edit the overlap chunks back to the text they held and delete
 * the extras phase 1 sent. Attachments were never removed, so nothing is
 * re-created. Idempotent: a chunk that is already gone is skipped, and editing
 * a chunk to the text it already holds changes nothing, so a repeated run
 * (the restart-recovery path) is harmless. Never throws; false when any other
 * step failed.
 */
export async function restoreEditedChunks(target: EditTarget, begun: BegunEdit): Promise<boolean> {
  let ok = true;
  for (const { live, before } of begun.edited) {
    const failure = await failedStep(() => editChunk(target, live, before, 'keep'));
    if (failure !== null) {
      logger.warn({ err: failure.error, messageId: live.id }, 'Restore edit failed');
      ok = false;
    }
  }
  for (const extra of begun.extras) {
    const failure = await failedStep(() => deleteChunk(target, extra));
    if (failure !== null) {
      logger.warn(
        { err: failure.error, messageId: extra.id },
        'Restore could not delete an extra chunk'
      );
      ok = false;
    }
  }
  return ok;
}

/**
 * Edit the live chunks to carry `newChunks` in one call, adding or removing
 * trailing chunks as the count changes and clearing attachments with the text
 * edit. Edit Response's behaviour: `messageIds` lists the chunks known or
 * assumed to still exist, a surplus chunk that could not be deleted included.
 */
export async function applyEditedChunks(
  target: EditTarget,
  liveChunks: readonly Message[],
  newChunks: readonly string[]
): Promise<ApplyResult> {
  const begun = await beginEditedChunks(target, liveChunks, newChunks, 'clear');
  if (!begun.ok) {
    return begun;
  }
  const finished = await finishEditedChunks(target, begun);
  return {
    ok: true,
    messageIds: [...begun.messageIds, ...finished.survivorIds],
    partial: begun.partial || !finished.ok,
  };
}

/**
 * Send chunks beyond the live count; stops at the first failure and reports it.
 * `onSent` hears of each extra the moment it exists (before the next send), so
 * a durable record of what to undo stays current; its failure is logged and
 * never fails the edit.
 */
async function sendExtraChunks(
  target: EditTarget,
  newChunks: readonly string[],
  from: number,
  onSent?: (messageId: string) => Promise<void>
): Promise<{ sent: Message[]; failed: boolean }> {
  const sent: Message[] = [];
  for (let i = from; i < newChunks.length; i++) {
    try {
      sent.push(await sendChunk(target, newChunks[i]));
    } catch (error) {
      logger.warn({ err: error, chunkIndex: i }, 'Extra chunk send failed');
      return { sent, failed: true };
    }
    try {
      await onSent?.(sent[sent.length - 1].id);
    } catch (error) {
      logger.warn({ err: error, chunkIndex: i }, 'Extra chunk callback failed');
    }
  }
  return { sent, failed: false };
}
