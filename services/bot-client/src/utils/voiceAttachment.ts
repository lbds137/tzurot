/**
 * Voice-attachment predicate.
 *
 * Dependency-free leaf module so every voice-detection path can share one
 * definition without forming an import cycle (it's consumed by both
 * `attachmentExtractor` and `forwardedMessageUtils`, and `forwardedMessageUtils`
 * already depends on `attachmentExtractor`).
 */

import { MessageFlags, type MessageFlagsBitField } from 'discord.js';
import { CONTENT_TYPES } from '@tzurot/common-types/constants/media';

/**
 * Context a caller passes down from the parent message so `isVoiceAttachment`
 * can classify a Vencord/Vesktop voice message, which arrives with the
 * attachment's `content_type` set to `video/webm` (not `audio/*`) but the
 * MESSAGE itself marked with Discord's `IsVoiceMessage` flag.
 */
export interface VoiceMessageContext {
  /** Whether the PARENT message carries Discord's IsVoiceMessage flag. */
  messageIsVoice?: boolean;
}

/**
 * Single source of truth for "is this attachment a voice message?".
 *
 * Content-type is authoritative UNLESS the parent message carries Discord's
 * `IsVoiceMessage` flag (`context.messageIsVoice === true`), which is the
 * Vencord/Vesktop case: a voice message from that client arrived with the
 * message's `IsVoiceMessage` flag set and an attachment declaring `video/webm`
 * (a WebM container) under a `.ogg` filename — a content type the `audio/*`
 * check below would otherwise classify as a plain file. On that branch a
 * duration is still required; content type is not consulted at all. A
 * `video/webm` upload whose message lacks the flag stays a plain file,
 * matching the pre-existing behavior below.
 *
 * Content-type can be ABSENT on either shape — Discord omits it on some forwarded
 * snapshots, and Discord.js `Attachment.contentType` is `string | null`. When it's
 * missing we fall back to the `duration` signal so genuine voice messages are still
 * detected. Note this fallback only fires for callers that pass RAW attachments
 * (direct `message.attachments`, the snapshot path, and `extractAttachments`'
 * per-attachment `isVoiceMessage`); callers that pass already-`extractAttachments`-ed
 * metadata never hit it, since that normalizes a null content-type to
 * `application/octet-stream` first.
 *
 * Single definition shared by every voice-detection + transcription path (direct
 * and forwarded) so the predicate can't drift out of sync the way the inlined
 * copies did. Accepts both attachment shapes seen in practice: Discord.js
 * `Attachment` (`duration: number | null`) and forwarded-snapshot attachments
 * (`duration?: number`).
 */
export function isVoiceAttachment(
  attachment: {
    contentType?: string | null;
    duration?: number | null;
  },
  context: VoiceMessageContext = {}
): boolean {
  const { contentType, duration } = attachment;
  const hasDuration = duration !== null && duration !== undefined;

  if (context.messageIsVoice === true) {
    // The parent message's IsVoiceMessage flag overrides content type entirely
    // (the Vencord/Vesktop `video/webm` mislabel this branch exists for) —
    // duration is still required to distinguish a real recording from a
    // flagged message with no audio attached.
    return hasDuration;
  }

  if (contentType !== null && contentType !== undefined && contentType.length > 0) {
    // Content-type present (always, for direct Discord.js attachments): a voice
    // message is `audio/*` AND has a duration. The `audio/*` check excludes video
    // (which also carries a duration); the duration check excludes plain audio-file
    // uploads, which aren't voice messages.
    return contentType.startsWith(CONTENT_TYPES.AUDIO_PREFIX) && hasDuration;
  }
  // No content-type (Discord omits it on some forwarded snapshots, and a direct
  // Discord.js `Attachment.contentType` is `string | null`): fall back to the
  // duration signal so genuine voice messages are still detected. Caveat: with no
  // content-type there's no audio/video discriminator, so a content-type-less
  // *video* with a duration would also pass here — unavoidable best-effort, but
  // realistic only if Discord ever omits content-type on forwarded video clips.
  return hasDuration;
}

/**
 * Whether the parent message (or forwarded snapshot) carries Discord's
 * `IsVoiceMessage` flag — the signal `isVoiceAttachment` needs to recognize a
 * Vencord/Vesktop voice message uploaded as `video/webm`.
 *
 * Structural rather than `Message`-typed so it also accepts a `MessageSnapshot`
 * (both carry a typed `flags` field) and tolerates an absent `flags`: the
 * bot-client test factory (`createMockMessage`) sets no `flags` at all, so
 * production code must treat that as "no flag" rather than throwing.
 */
export function hasVoiceMessageFlag(message: {
  readonly flags?: Readonly<MessageFlagsBitField> | null;
}): boolean {
  return message.flags?.has(MessageFlags.IsVoiceMessage) === true;
}
