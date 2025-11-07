/**
 * Attachment Placeholder Generator
 *
 * Generates lightweight placeholder descriptions for attachments before AI processing.
 * Used for atomic user message storage - message is saved with placeholders,
 * then updated with rich descriptions after vision/transcription processing.
 */

import type { AttachmentMetadata } from '@tzurot/common-types';
import { CONTENT_TYPES } from '@tzurot/common-types';

/**
 * Generate placeholder description for a single attachment
 *
 * Placeholders include basic metadata (filename, type, duration) but not AI-processed content.
 * This allows user messages to be saved atomically before expensive API calls.
 */
export function generateAttachmentPlaceholder(attachment: AttachmentMetadata): string {
  if (attachment.isVoiceMessage && attachment.duration !== undefined) {
    return `[Voice message: ${attachment.duration.toFixed(1)}s]`;
  }

  if (attachment.contentType.startsWith(CONTENT_TYPES.AUDIO_PREFIX)) {
    const name = attachment.name || 'attachment';
    return `[Audio: ${name}]`;
  }

  if (attachment.contentType.startsWith(CONTENT_TYPES.IMAGE_PREFIX)) {
    const name = attachment.name || 'attachment';
    return `[Image: ${name}]`;
  }

  // Generic file placeholder
  const name = attachment.name || 'attachment';
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
