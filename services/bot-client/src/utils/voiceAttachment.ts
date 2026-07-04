/**
 * Voice-attachment predicate.
 *
 * Dependency-free leaf module so every voice-detection path can share one
 * definition without forming an import cycle (it's consumed by both
 * `attachmentExtractor` and `forwardedMessageUtils`, and `forwardedMessageUtils`
 * already depends on `attachmentExtractor`).
 */

import { CONTENT_TYPES } from '@tzurot/common-types/constants/media';

/**
 * Single source of truth for "is this attachment a voice message?".
 *
 * The discriminator that matters is the content-type, and it's checked
 * authoritatively: when present, the attachment is a voice attachment iff it's
 * `audio/*`. THIS is what excludes video (MP4/GIF), which also carries a
 * `duration`; duration alone is not a sufficient signal for a voice message.
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
export function isVoiceAttachment(attachment: {
  contentType?: string | null;
  duration?: number | null;
}): boolean {
  const { contentType, duration } = attachment;
  const hasDuration = duration !== null && duration !== undefined;
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
