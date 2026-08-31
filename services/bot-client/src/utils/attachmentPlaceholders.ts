/**
 * Attachment Placeholder Generator
 *
 * Generates lightweight placeholder descriptions for attachments before AI processing.
 * Used for atomic user message storage - message is saved with placeholders,
 * then updated with rich descriptions after vision/transcription processing.
 */

import { CONTENT_TYPES } from '@tzurot/common-types/constants/media';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';

/**
 * The bracket kind an image-path attachment renders under. Sticker wins over
 * embed preview; the two producers are disjoint, so the ordering states a
 * precedence rather than resolving a case that arises. Must stay in step with
 * RAGUtils' `pickImageHeader`, which makes the same choice on the upgrade path.
 */
function pickImageKind(attachment: AttachmentMetadata): string {
  if (attachment.isSticker === true) {
    return 'Sticker';
  }
  return attachment.isEmbedPreview === true ? 'Link preview' : 'Image';
}

/**
 * Generate placeholder description for a single attachment
 *
 * Placeholders include basic metadata (filename, type, duration) but not AI-processed content.
 * This allows user messages to be saved atomically before expensive API calls.
 */
export function generateAttachmentPlaceholder(attachment: AttachmentMetadata): string {
  if (attachment.isVoiceMessage === true && attachment.duration !== undefined) {
    return `[Voice message: ${attachment.duration.toFixed(1)}s]`;
  }

  if (attachment.contentType.startsWith(CONTENT_TYPES.AUDIO_PREFIX)) {
    const name =
      attachment.name !== undefined && attachment.name !== null && attachment.name.length > 0
        ? attachment.name
        : 'attachment';
    return `[Audio: ${name}]`;
  }

  if (attachment.contentType.startsWith(CONTENT_TYPES.IMAGE_PREFIX)) {
    const name =
      attachment.name !== undefined && attachment.name !== null && attachment.name.length > 0
        ? attachment.name
        : 'attachment';
    // A sticker travels the image path but is not a file the user uploaded.
    // This placeholder is PERSISTED with the message row, and the post-vision
    // upgrade that would replace it only runs when a description was actually
    // produced — so with sticker vision switched off, or after a describe
    // failure, whatever is written here is what the character reads forever.
    // An embed preview has the same problem: the user shared a link and Discord
    // generated the preview image, so `[Image: …]` claims an upload that never
    // happened.
    // Must match RAGUtils' `pickImageHeader`, which makes the same three-way
    // choice on the upgrade path.
    const kind = pickImageKind(attachment);
    return `[${kind}: ${name}]`;
  }

  // Generic file placeholder
  const name =
    attachment.name !== undefined && attachment.name !== null && attachment.name.length > 0
      ? attachment.name
      : 'attachment';
  return `[File: ${name}]`;
}

/**
 * Generate placeholder descriptions for all attachments
 *
 * Returns a formatted string suitable for appending to user message content.
 * Format: "\n\n[Image: photo.jpg] [Voice message: 5.2s]"
 */
export function generateAttachmentPlaceholders(attachments: AttachmentMetadata[]): string {
  if (attachments.length === 0) {
    return '';
  }

  const placeholders = attachments.map(generateAttachmentPlaceholder);
  return '\n\n' + placeholders.join(' ');
}
