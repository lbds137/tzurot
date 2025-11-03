/**
 * Reference Formatter for Database Storage
 *
 * Formats referenced messages for saving to conversation history.
 * This is a simpler version than the system prompt format - we save
 * basic metadata and embed/attachment info, but not vision analysis
 * (vision happens on-demand for the current request only).
 */

import type { ReferencedMessage } from '@tzurot/common-types';

/**
 * Format referenced messages for database storage
 * @param references - Array of referenced messages
 * @returns Formatted string to append to message content, or empty string if no references
 */
export function formatReferencesForDatabase(references: ReferencedMessage[]): string {
  if (!references || references.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push('\n\n--- Referenced Messages ---');

  for (const ref of references) {
    lines.push(`\n[Reference ${ref.referenceNumber}] from @${ref.authorUsername}`);
    lines.push(`Location: ${ref.guildName} > ${ref.channelName}`);
    lines.push(`Time: ${ref.timestamp}`);

    if (ref.content) {
      // Truncate very long content to prevent database bloat
      const maxContentLength = 500;
      const truncated = ref.content.length > maxContentLength
        ? ref.content.substring(0, maxContentLength) + '...'
        : ref.content;
      lines.push(`Content: ${truncated}`);
    }

    if (ref.embeds) {
      // Truncate embed data to prevent bloat
      const maxEmbedLength = 300;
      const truncated = ref.embeds.length > maxEmbedLength
        ? ref.embeds.substring(0, maxEmbedLength) + '...'
        : ref.embeds;
      lines.push(`Embeds: ${truncated}`);
    }

    if (ref.attachments && ref.attachments.length > 0) {
      const attachmentTypes = ref.attachments.map(att => {
        if (att.isVoiceMessage) return 'Voice';
        if (att.contentType?.startsWith('image/')) return 'Image';
        return 'File';
      });
      lines.push(`Attachments: ${attachmentTypes.join(', ')}`);
    }
  }

  return lines.join('\n');
}
