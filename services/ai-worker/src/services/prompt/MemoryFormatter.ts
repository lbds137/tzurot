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
 * @returns Formatted memory string
 */
export function formatSingleMemory(doc: MemoryDocument): string {
  const timestamp =
    doc.metadata?.createdAt !== undefined && doc.metadata.createdAt !== null
      ? formatMemoryTimestamp(doc.metadata.createdAt)
      : null;
  return `- ${timestamp !== null && timestamp.length > 0 ? `[${timestamp}] ` : ''}${doc.pageContent}`;
}

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

  const formattedMemories = relevantMemories.map(formatSingleMemory).join('\n');

  return '\n\n## Relevant Memories\n' + formattedMemories;
}
