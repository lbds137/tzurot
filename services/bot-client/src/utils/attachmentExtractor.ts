/**
 * Attachment Extractor
 *
 * Extracts attachment metadata from Discord messages
 * Shared utility for both regular messages and referenced messages
 */

import { Collection, Snowflake, Attachment } from 'discord.js';
import { CONTENT_TYPES } from '@tzurot/common-types/constants/media';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { isVoiceAttachment } from './voiceAttachment.js';

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
    // Cache-stable Discord CDN URL — survives ai-worker pipeline transforms that overwrite `url`.
    originalUrl: attachment.url,
    contentType: attachment.contentType ?? CONTENT_TYPES.BINARY,
    name: attachment.name,
    size: attachment.size,
    // Discord.js v14 voice message metadata. Pass the RAW attachment (its
    // contentType is still `string | null` here) so a genuine voice message with
    // an omitted content-type hits isVoiceAttachment's duration fallback, while a
    // video (which carries a duration but a `video/*` content-type) is rejected.
    isVoiceMessage: isVoiceAttachment(attachment),
    duration: attachment.duration ?? undefined,
    waveform: attachment.waveform ?? undefined,
  }));
}
