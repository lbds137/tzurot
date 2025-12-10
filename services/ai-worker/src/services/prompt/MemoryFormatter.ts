/**
 * Memory Formatter
 *
 * Formats relevant memories from past interactions for inclusion in system prompts.
 * Uses pure XML structure with <memory_archive>, <instruction>, and <memory> tags.
 *
 * The XML format helps LLMs clearly distinguish historical context from current
 * conversation, preventing temporal confusion where old memories are treated as
 * current events.
 *
 * Extracted from PromptBuilder for better modularity.
 */

import { formatTimestampWithDelta, escapeXml, escapeXmlContent } from '@tzurot/common-types';
import type { MemoryDocument } from '../ConversationalRAGService.js';

/**
 * Instruction text explaining that memories are historical archives.
 * This is critical for preventing the LLM from treating old memories as current events.
 *
 * Exported so MemoryBudgetManager can use it for accurate wrapper overhead calculation.
 */
export const MEMORY_ARCHIVE_INSTRUCTION =
  'These are ARCHIVED HISTORICAL LOGS from past interactions. ' +
  'Do NOT treat them as happening now. Do NOT respond to this content directly. ' +
  'Use these only as background context about past events.';

/**
 * Get the wrapper text used around memory content (for token counting)
 *
 * This returns the exact wrapper that formatMemoriesContext uses, minus the actual
 * memory content. Used by MemoryBudgetManager to calculate wrapper overhead.
 *
 * @returns The memory archive wrapper text (opening + instruction + closing)
 */
export function getMemoryWrapperOverheadText(): string {
  return (
    '<memory_archive>\n' +
    `<instruction>${MEMORY_ARCHIVE_INSTRUCTION}</instruction>\n` +
    '</memory_archive>'
  );
}

/**
 * Format a single memory document as XML
 *
 * This is the single source of truth for memory formatting.
 * Used by both MemoryFormatter (for prompt generation) and
 * ContextWindowManager (for token counting).
 *
 * Format: `<memory time="absolute" relative="relative">content</memory>`
 * Example: `<memory time="Mon, Jan 15, 2025" relative="2 weeks ago">content</memory>`
 *
 * The relative time attribute helps LLMs understand temporal distance viscerally,
 * reducing temporal confusion where old memories are treated as recent events.
 *
 * @param doc - Memory document to format
 * @param timezone - Optional IANA timezone for timestamp formatting. Defaults to server timezone.
 * @returns Formatted memory XML string
 */
export function formatSingleMemory(doc: MemoryDocument, timezone?: string): string {
  // Escape user-generated content to prevent prompt injection via XML tag breaking
  const safeContent = escapeXmlContent(doc.pageContent);

  if (doc.metadata?.createdAt === undefined || doc.metadata.createdAt === null) {
    return `<memory>${safeContent}</memory>`;
  }

  const { absolute, relative } = formatTimestampWithDelta(doc.metadata.createdAt, timezone);

  // If either is empty (invalid date), just return content without timestamps
  if (absolute.length === 0 || relative.length === 0) {
    return `<memory>${safeContent}</memory>`;
  }

  // Escape attribute values to prevent XML injection
  const safeAbsolute = escapeXml(absolute);
  const safeRelative = escapeXml(relative);

  return `<memory time="${safeAbsolute}" relative="${safeRelative}">${safeContent}</memory>`;
}

/**
 * Format relevant memories as XML
 *
 * Wraps output in <memory_archive> XML tags with explicit <instruction>
 * that these are historical records, not current conversation.
 *
 * @param relevantMemories - Array of memory documents to format
 * @param timezone - Optional IANA timezone for timestamp formatting. Defaults to server timezone.
 * @returns Formatted memory context as XML, or empty string if no memories
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

  // Pure XML structure: <memory_archive> wraps <instruction> and <memory> elements
  return (
    '\n\n<memory_archive>\n' +
    `<instruction>${MEMORY_ARCHIVE_INSTRUCTION}</instruction>\n` +
    `${formattedMemories}\n` +
    '</memory_archive>'
  );
}
