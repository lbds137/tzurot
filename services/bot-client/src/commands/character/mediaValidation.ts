/**
 * Shared media-attachment validation for the /character command.
 *
 * `avatar`, `voice`, and `import` all accept image/audio attachments and
 * previously validated them with three different message phrasings for the
 * same failure. These validators are the single source of that wording so the
 * user sees one consistent message regardless of which subcommand they used.
 *
 * Image = exact content-type match (VALID_IMAGE_TYPES). Audio = `audio/*`
 * prefix — deliberately broader than the server's ALLOWED_TYPES to give a
 * friendlier Discord UX; the gateway does the strict MIME/format check.
 */

import { VOICE_REFERENCE_LIMITS } from '@tzurot/common-types/constants/media';
import { VALID_IMAGE_TYPES, MAX_INPUT_SIZE_MB, MAX_INPUT_SIZE_BYTES } from './avatarUtils.js';

const VALID_AUDIO_PREFIX = 'audio/';
const MAX_AUDIO_BYTES = VOICE_REFERENCE_LIMITS.MAX_SIZE;
const MAX_AUDIO_MB = MAX_AUDIO_BYTES / (1024 * 1024);

/** The subset of a Discord attachment these validators read. */
export interface AttachmentLike {
  contentType: string | null;
  size: number;
}

/**
 * Validate an image attachment (avatar). Returns a user-facing error string, or
 * null when valid.
 */
export function validateImageAttachment(attachment: AttachmentLike): string | null {
  if (attachment.contentType === null || !VALID_IMAGE_TYPES.includes(attachment.contentType)) {
    return '❌ Invalid image format. Please upload a PNG, JPG, GIF, or WebP image.';
  }
  if (attachment.size > MAX_INPUT_SIZE_BYTES) {
    return `❌ Image too large. Please upload a file under ${MAX_INPUT_SIZE_MB}MB.`;
  }
  return null;
}

/**
 * Validate an audio attachment (voice reference). Returns a user-facing error
 * string, or null when valid.
 */
export function validateAudioAttachment(attachment: AttachmentLike): string | null {
  if (attachment.contentType?.startsWith(VALID_AUDIO_PREFIX) !== true) {
    return '❌ Invalid audio format. Please upload a WAV, MP3, OGG, or FLAC file.';
  }
  if (attachment.size > MAX_AUDIO_BYTES) {
    return `❌ Audio too large. Please upload a file under ${MAX_AUDIO_MB}MB.`;
  }
  return null;
}
