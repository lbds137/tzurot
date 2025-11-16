/**
 * Reference Formatter for Database Storage
 *
 * Formats referenced messages for saving to conversation history.
 * IMPORTANT: This should match what the AI actually sees in the system prompt
 * so future conversation turns have the same context. No truncation!
 */

import type { ReferencedMessage } from '@tzurot/common-types';
import { CONTENT_TYPES } from '@tzurot/common-types';

/**
 * Format referenced messages for database storage
 * @param references - Array of referenced messages
 * @returns Formatted string to append to message content, or empty string if no references
 *
 * Note: This produces the SAME format as the RAG service's system prompt,
 * minus the vision/transcription analyses (those are on-demand only).
 */
export function formatReferencesForDatabase(references: ReferencedMessage[]): string {
  if (references.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push('\n\n--- Referenced Messages ---');
  lines.push('The user referenced the following messages:\n');

  for (const ref of references) {
    lines.push(`[Reference ${ref.referenceNumber}]`);
    lines.push(`From: ${ref.authorDisplayName} (@${ref.authorUsername})`);
    lines.push(`Location:\n${ref.locationContext}`);
    lines.push(`Time: ${ref.timestamp}`);

    if (ref.content) {
      lines.push(`\nMessage Text:\n${ref.content}`);
    }

    if (ref.embeds) {
      lines.push(`\nMessage Embeds (structured data from Discord):\n${ref.embeds}`);
    }

    if (ref.attachments && ref.attachments.length > 0) {
      lines.push('\nAttachments:');
      for (const attachment of ref.attachments) {
        if (attachment.isVoiceMessage === true) {
          lines.push(`- Voice Message (${attachment.duration}s)`);
        } else if (attachment.contentType?.startsWith(CONTENT_TYPES.IMAGE_PREFIX)) {
          lines.push(`- Image: ${attachment.name}`);
        } else {
          lines.push(`- File: ${attachment.name} (${attachment.contentType})`);
        }
      }
    }

    lines.push(''); // Empty line between references
  }

  return lines.join('\n');
}
