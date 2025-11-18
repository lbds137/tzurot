/**
 * Memory Formatter
 *
 * Formats relevant memories from past interactions for inclusion in system prompts.
 * Extracted from PromptBuilder for better modularity.
 */

import { formatMemoryTimestamp } from '@tzurot/common-types';
import type { MemoryDocument } from '../ConversationalRAGService.js';

/**
 * Format relevant memories with timestamps
 *
 * @param relevantMemories - Array of memory documents to format
 * @returns Formatted memory context string, or empty string if no memories
 */
export function formatMemoriesContext(relevantMemories: MemoryDocument[]): string {
  if (relevantMemories.length === 0) {
    return '';
  }

  const formattedMemories = relevantMemories
    .map(doc => {
      const timestamp =
        doc.metadata?.createdAt !== undefined && doc.metadata.createdAt !== null
          ? formatMemoryTimestamp(doc.metadata.createdAt)
          : null;
      return `- ${timestamp !== null && timestamp.length > 0 ? `[${timestamp}] ` : ''}${doc.pageContent}`;
    })
    .join('\n');

  return '\n\n## Relevant Memories\n' + formattedMemories;
}
