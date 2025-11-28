/**
 * Memory Formatter
 *
 * Formats relevant memories from past interactions for inclusion in system prompts.
 * Extracted from PromptBuilder for better modularity.
 */

import { formatMemoryTimestamp } from '@tzurot/common-types';
import type { MemoryDocument } from '../ConversationalRAGService.js';

/**
 * Format a single memory document as it appears in prompts
 *
 * This is the single source of truth for memory formatting.
 * Used by both MemoryFormatter (for prompt generation) and
 * ContextWindowManager (for token counting).
 *
 * Format: `- [timestamp] content` or `- content` (if no timestamp)
 *
 * @param doc - Memory document to format
 * @param timezone - Optional IANA timezone for timestamp formatting. Defaults to server timezone.
 * @returns Formatted memory string
 */
export function formatSingleMemory(doc: MemoryDocument, timezone?: string): string {
  const timestamp =
    doc.metadata?.createdAt !== undefined && doc.metadata.createdAt !== null
      ? formatMemoryTimestamp(doc.metadata.createdAt, timezone)
      : null;
  return `- ${timestamp !== null && timestamp.length > 0 ? `[${timestamp}] ` : ''}${doc.pageContent}`;
}

/**
 * Format relevant memories with timestamps
 *
 * @param relevantMemories - Array of memory documents to format
 * @param timezone - Optional IANA timezone for timestamp formatting. Defaults to server timezone.
 * @returns Formatted memory context string, or empty string if no memories
 */
export function formatMemoriesContext(
  relevantMemories: MemoryDocument[],
  timezone?: string
): string {
  if (relevantMemories.length === 0) {
    return '';
  }

  const formattedMemories = relevantMemories
    .map(doc => formatSingleMemory(doc, timezone))
    .join('\n');

  return '\n\n## Relevant Memories\n' + formattedMemories;
}
