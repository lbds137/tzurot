/**
 * Attachment Extractor
 *
 * Extracts attachment metadata from Discord messages
 * Shared utility for both regular messages and referenced messages
 */

import { Collection, Snowflake, Attachment } from 'discord.js';
import type { AttachmentMetadata } from '@tzurot/common-types';
import { CONTENT_TYPES } from '@tzurot/common-types';

/**
 * Extract attachment metadata from a Discord message's attachments collection
 * @param attachments - Discord message attachments collection
 * @returns Array of attachment metadata, or undefined if no attachments
 */
export function extractAttachments(
  attachments: Collection<Snowflake, Attachment>
): AttachmentMetadata[] | undefined {
  if (attachments.size === 0) {
    return undefined;
  }

  return Array.from(attachments.values()).map(attachment => ({
    // Discord attachment ID - stable snowflake for caching (preferred over URL hash)
    id: attachment.id,
    url: attachment.url,
    contentType: attachment.contentType ?? CONTENT_TYPES.BINARY,
    name: attachment.name,
    size: attachment.size,
    // Discord.js v14 voice message metadata
    isVoiceMessage: attachment.duration !== null,
    duration: attachment.duration ?? undefined,
    waveform: attachment.waveform ?? undefined,
  }));
}
