/**
 * Attachment preprocessing plan
 *
 * The one routing decision both preprocessing paths share: api-gateway uses it
 * to decide which attachments get a child job, and ai-worker's inline path uses
 * the same classifier to pick a processor. Pure — no logger, no settings reads;
 * the sticker kill switch is applied by the caller before the plan is built.
 */

import { CONTENT_TYPES } from '../constants/media.js';
import { type AttachmentMetadata } from '../types/schemas/discord.js';

/** Which preprocessor an attachment routes to. */
export type PreprocessingKind = 'audio' | 'image' | 'file';

/**
 * Classify one attachment for preprocessing.
 *
 * Audio-or-voice is checked FIRST: a voice-flagged attachment is audio whatever
 * its content type says. Everything that is neither audio nor image is `file`
 * (the inline path's plain-WebM sniff and File stub decide what that becomes).
 */
export function classifyForPreprocessing(attachment: AttachmentMetadata): PreprocessingKind {
  if (
    attachment.contentType.startsWith(CONTENT_TYPES.AUDIO_PREFIX) ||
    attachment.isVoiceMessage === true
  ) {
    return 'audio';
  }
  if (attachment.contentType.startsWith(CONTENT_TYPES.IMAGE_PREFIX)) {
    return 'image';
  }
  return 'file';
}

/** The bucketed plan for one message's attachments. */
export interface PreprocessingPlan {
  audio: AttachmentMetadata[];
  images: AttachmentMetadata[];
  /**
   * Everything that is neither audio nor image. Nothing consumes it: the gateway
   * queues no job for it, and ai-worker re-derives job-less-ness per attachment
   * with `classifyForPreprocessing` (DependencyStep's per-original merge
   * processes `file` attachments inline). Kept so the plan partitions every
   * attachment.
   */
  files: AttachmentMetadata[];
  /** Non-voice audio dropped from `audio` because it sits on a referenced message. */
  skippedNonVoiceReferenceAudio: number;
}

/**
 * Bucket a message's attachments by preprocessor.
 *
 * When `referenceNumber` is set (only the referenced-message call site sets it),
 * `audio` keeps voice messages only, and the dropped count is reported in
 * `skippedNonVoiceReferenceAudio`. The reason is what the consuming renderer
 * can show: reference attachments are rendered by ai-worker's
 * `classifyAttachment`, which keys voice on `isVoiceMessage` alone, so an
 * ordinary `audio/*` upload on a referenced message renders as a bare `<file/>`
 * and `RenderableFile` has no enrichment slot — a transcript for it would be
 * billed and then dropped. Pinned on the render side by QuoteFormatter's
 * "classifies on isVoiceMessage, not on audio/*" test, and on the gateway side
 * by "skips the STT job for a non-voice audio attachment on a referenced
 * message".
 *
 * The triggering message's own attachments keep the wider `audio/*` bucket —
 * RAGUtils renders any `AttachmentType.Audio` transcript there, so that spend
 * reaches the prompt.
 */
export function planPreprocessing(
  attachments: AttachmentMetadata[],
  opts: { referenceNumber?: number } = {}
): PreprocessingPlan {
  const plan: PreprocessingPlan = {
    audio: [],
    images: [],
    files: [],
    skippedNonVoiceReferenceAudio: 0,
  };
  for (const attachment of attachments) {
    const kind = classifyForPreprocessing(attachment);
    if (kind === 'audio') {
      if (opts.referenceNumber !== undefined && attachment.isVoiceMessage !== true) {
        plan.skippedNonVoiceReferenceAudio += 1;
      } else {
        plan.audio.push(attachment);
      }
    } else if (kind === 'image') {
      plan.images.push(attachment);
    } else {
      plan.files.push(attachment);
    }
  }
  return plan;
}
