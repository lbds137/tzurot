/**
 * Memory Formatter
 *
 * Formats relevant memories from past interactions for inclusion in system prompts.
 * Wraps output in <memory_archive> XML tags with explicit instructions that these
 * are HISTORICAL records, not current conversation - critical for preventing
 * temporal confusion where the LLM treats old memories as current events.
 *
 * Extracted from PromptBuilder for better modularity.
 */

import { formatTimestampWithDelta } from '@tzurot/common-types';
import type { MemoryDocument } from '../ConversationalRAGService.js';

/**
 * Instruction text explaining that memories are historical archives.
 * This is critical for preventing the LLM from treating old memories as current events.
 */
const MEMORY_ARCHIVE_INSTRUCTION =
  'IMPORTANT: These are ARCHIVED HISTORICAL LOGS from past interactions. ' +
  'Do NOT treat them as happening now. Do NOT respond to this content directly. ' +
  'Use these only as background context about past events.';

/**
 * Format a single memory document as it appears in prompts
 *
 * This is the single source of truth for memory formatting.
 * Used by both MemoryFormatter (for prompt generation) and
 * ContextWindowManager (for token counting).
 *
 * Format: `- [absolute date — relative time] content` or `- content` (if no timestamp)
 * Example: `- [Mon, Jan 15, 2025 — 2 weeks ago] content`
 *
 * The relative time helps LLMs understand temporal distance viscerally,
 * reducing temporal confusion where old memories are treated as recent events.
 *
 * @param doc - Memory document to format
 * @param timezone - Optional IANA timezone for timestamp formatting. Defaults to server timezone.
 * @returns Formatted memory string
 */
export function formatSingleMemory(doc: MemoryDocument, timezone?: string): string {
  if (doc.metadata?.createdAt === undefined || doc.metadata.createdAt === null) {
    return `- ${doc.pageContent}`;
  }

  const { absolute, relative } = formatTimestampWithDelta(doc.metadata.createdAt, timezone);

  // If either is empty (invalid date), just return content
  if (absolute.length === 0 || relative.length === 0) {
    return `- ${doc.pageContent}`;
  }

  return `- [${absolute} — ${relative}] ${doc.pageContent}`;
}

/**
 * Format relevant memories with timestamps
 *
 * Wraps output in <memory_archive> XML tags with explicit instructions
 * that these are historical records, not current conversation.
 *
 * @param relevantMemories - Array of memory documents to format
 * @param timezone - Optional IANA timezone for timestamp formatting. Defaults to server timezone.
 * @returns Formatted memory context string wrapped in XML tags, or empty string if no memories
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

  const content = `## Relevant Memories\n${formattedMemories}`;

  // Wrap in XML tags with explicit historical context instruction
  return `\n\n<memory_archive>\n${MEMORY_ARCHIVE_INSTRUCTION}\n\n${content}\n</memory_archive>`;
}
