/**
 * Memory Formatter
 *
 * Formats relevant memories from past interactions for inclusion in system prompts.
 * Uses pure XML structure with <memory_archive>, <instruction>, and <historical_note> tags.
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
 * The instruction uses positive framing ("use ONLY as background") rather than
 * negative constraints ("do NOT respond") because LLMs struggle with negation
 * when the prohibited content is semantically salient.
 *
 * Exported so MemoryBudgetManager can use it for accurate wrapper overhead calculation.
 */
export const MEMORY_ARCHIVE_INSTRUCTION =
  'These are SUMMARIZED NOTES from past interactions, not current conversation. ' +
  'Use ONLY as background context to inform your response to the CURRENT message. ' +
  'The current message is in <current_turn> - respond ONLY to that.';

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
 * Format: `<historical_note recorded="absolute" ago="relative">content</historical_note>`
 * Example: `<historical_note recorded="Mon, Jan 15, 2025" ago="2 weeks ago">content</historical_note>`
 *
 * IMPORTANT: We use <historical_note> instead of <memory> or <message> to create
 * "structural distancing" from the conversation. This prevents the LLM from treating
 * archived content as part of the active dialogue thread.
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
    return `<historical_note>${safeContent}</historical_note>`;
  }

  const { absolute, relative } = formatTimestampWithDelta(doc.metadata.createdAt, timezone);

  // If either is empty (invalid date), just return content without timestamps
  if (absolute.length === 0 || relative.length === 0) {
    return `<historical_note>${safeContent}</historical_note>`;
  }

  // Escape attribute values to prevent XML injection
  const safeAbsolute = escapeXml(absolute);
  const safeRelative = escapeXml(relative);

  return `<historical_note recorded="${safeAbsolute}" ago="${safeRelative}">${safeContent}</historical_note>`;
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

  // Pure XML structure: <memory_archive> wraps <instruction> and <historical_note> elements
  return (
    '\n\n<memory_archive>\n' +
    `<instruction>${MEMORY_ARCHIVE_INSTRUCTION}</instruction>\n` +
    `${formattedMemories}\n` +
    '</memory_archive>'
  );
}
