/**
 * Token Counters - Token counting utilities for prompt budget management.
 *
 * Provides token counting for text, memories, and attachments.
 * Extracted from PromptBuilder to reduce file size.
 */

import { countTextTokens, formatMemoryTimestamp } from '@tzurot/common-types';
import type { MemoryDocument } from '../ConversationalRAGTypes.js';
import type { ProcessedAttachment } from '../MultimodalProcessor.js';
import { extractContentDescriptions } from '../RAGUtils.js';

/**
 * Count tokens for a text string
 */
export function countTokens(text: string): number {
  return countTextTokens(text);
}

/**
 * Count tokens for memories
 */
export function countMemoryTokens(memories: MemoryDocument[]): number {
  let totalTokens = 0;
  for (const doc of memories) {
    const timestamp =
      doc.metadata?.createdAt !== undefined && doc.metadata.createdAt !== null
        ? formatMemoryTimestamp(doc.metadata.createdAt)
        : null;
    const memoryText = `- ${timestamp !== null && timestamp.length > 0 ? `[${timestamp}] ` : ''}${doc.pageContent}`;
    totalTokens += countTextTokens(memoryText);
  }
  return totalTokens;
}

/**
 * Count tokens for processed attachments (from descriptions)
 */
export function countAttachmentTokens(processedAttachments: ProcessedAttachment[]): number {
  const descriptions = extractContentDescriptions(processedAttachments);
  return countTextTokens(descriptions);
}
