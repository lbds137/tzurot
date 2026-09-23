/**
 * Attachment Extractor
 *
 * Extracts attachment metadata from Discord messages
 * Shared utility for both regular messages and referenced messages
 */

import { type Collection, type Snowflake, type Attachment } from 'discord.js';
import { CONTENT_TYPES } from '@tzurot/common-types/constants/media';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { isVoiceAttachment } from './voiceAttachment.js';

const SPOILER_FILENAME_PREFIX = 'SPOILER_';

/**
 * Whether the poster marked a plain attachment as a spoiler. Checks both
 * signals discord.js exposes: installed discord.js 14.27.0's
 * `Attachment.spoiler` getter reads ONLY the `IsSpoiler` attachment flag
 * (`src/structures/Attachment.js`: `return this.flags.has(AttachmentFlags.IsSpoiler)`)
 * — it does not fold in the filename prefix — so the `SPOILER_` filename
 * prefix convention is checked separately. Prefix match is case-sensitive.
 */
export function isSpoilerAttachment(attachment: Pick<Attachment, 'name' | 'spoiler'>): boolean {
  return attachment.spoiler || attachment.name.startsWith(SPOILER_FILENAME_PREFIX);
}

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
    ...(isSpoilerAttachment(attachment) ? { isSpoiler: true } : {}),
  }));
}
