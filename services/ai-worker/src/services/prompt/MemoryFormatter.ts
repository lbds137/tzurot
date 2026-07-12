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

import { formatPromptTimestamp } from '@tzurot/common-types/utils/dateFormatting';
import { escapeXmlContent } from '@tzurot/common-types/utils/promptSanitizer';
import { replacePromptPlaceholders } from '../../utils/promptPlaceholders.js';
import { escapeXml } from '@tzurot/common-types/utils/xmlBuilder';
import type { MemoryDocument, FactForPrompt } from '../ConversationalRAGTypes.js';

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
  'Use ONLY as background context to inform your response to the user message.';

/**
 * Build the memory archive XML wrapper.
 * Single source of truth for memory archive structure.
 *
 * The usage attribute signals to the LLM that this content is background context
 * that should not be parroted back or treated as current conversation.
 *
 * @param content - Optional content to include (formatted memories)
 * @returns The complete memory archive XML
 */
function buildMemoryArchiveXml(content?: string): string {
  const parts = [
    '<memory_archive usage="context_only_do_not_repeat">',
    `<instruction>${MEMORY_ARCHIVE_INSTRUCTION}</instruction>`,
  ];

  if (content !== undefined && content.length > 0) {
    parts.push(content);
  }

  parts.push('</memory_archive>');

  return parts.join('\n');
}

/**
 * Get the wrapper text used around memory content (for token counting)
 *
 * This returns the exact wrapper that formatMemoriesContext uses, minus the actual
 * memory content. Used by MemoryBudgetManager to calculate wrapper overhead.
 *
 * @returns The memory archive wrapper text (opening + instruction + closing)
 */
export function getMemoryWrapperOverheadText(): string {
  return buildMemoryArchiveXml();
}

/**
 * Format a single memory document as XML
 *
 * This is the single source of truth for memory formatting.
 * Used by both MemoryFormatter (for prompt generation) and
 * ContextWindowManager (for token counting).
 *
 * Format: `<historical_note t="YYYY-MM-DD (Day) HH:MM • relative">content</historical_note>`
 * Example: `<historical_note t="2025-01-15 (Wed) 14:30 • 2 weeks ago">content</historical_note>`
 * For older memories (>7 days): `<historical_note t="2024-11-15 (Fri) • 2 months ago">content</historical_note>`
 *
 * IMPORTANT: We use <historical_note> instead of <memory> or <message> to create
 * "structural distancing" from the conversation. This prevents the LLM from treating
 * archived content as part of the active dialogue thread.
 *
 * The unified timestamp format helps LLMs understand both absolute date and temporal
 * distance in a token-efficient single attribute.
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

  const formattedTime = formatPromptTimestamp(doc.metadata.createdAt, timezone);

  // If empty (invalid date), just return content without timestamp
  if (formattedTime.length === 0) {
    return `<historical_note>${safeContent}</historical_note>`;
  }

  // Escape attribute value to prevent XML injection
  const safeTime = escapeXml(formattedTime);

  return `<historical_note t="${safeTime}">${safeContent}</historical_note>`;
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

  return '\n\n' + buildMemoryArchiveXml(formattedMemories);
}

/**
 * Instruction framing the `<facts>` block as DISTILLED, CURRENT knowledge —
 * distinct from the verbatim historical `<memory_archive>`. Positive framing
 * (LLMs handle negation poorly), same as the archive instruction.
 *
 * Fact retrieval is scoped to ONE persona (the author of the triggering
 * message), so every fact in the block shares that subject — but statements
 * distilled from earlier conversations often say "the user", which in a
 * multi-user channel the model naturally binds to the WRONG person (the
 * thread's most prominent human rather than the message author). Naming the
 * subject here binds the whole block. Exported for tests; the budget manager
 * accounts wrapper overhead via {@link getFactsWrapperOverheadText}.
 */
export function factsInstruction(subjectName?: string): string {
  const hasSubject = subjectName !== undefined && subjectName.length > 0;
  const safeName = hasSubject ? escapeXmlContent(subjectName) : undefined;
  const subject =
    safeName !== undefined
      ? `${safeName} — the author of the message you are replying to —`
      : 'the user';
  const binding = safeName ?? 'that same person';
  return (
    `These are durable KNOWN FACTS about ${subject} and their world, distilled from past ` +
    `interactions. A fact that says "the user" means ${binding}, not anyone else in the ` +
    `conversation. Treat them as current background knowledge when responding.`
  );
}

/** Build the `<facts>` XML wrapper — single source of truth for the block. */
function buildFactsXml(content?: string, subjectName?: string): string {
  const parts = [
    '<facts usage="known_background_do_not_repeat">',
    `<instruction>${factsInstruction(subjectName)}</instruction>`,
  ];
  if (content !== undefined && content.length > 0) {
    parts.push(content);
  }
  parts.push('</facts>');
  return parts.join('\n');
}

/**
 * The `<facts>` wrapper text without content — for `ContentBudgetManager` to
 * count the block's fixed overhead (mirrors `getMemoryWrapperOverheadText`).
 * Pass the same `subjectName` the render path uses, or the count drifts by
 * the interpolated name's tokens.
 */
export function getFactsWrapperOverheadText(subjectName?: string): string {
  return buildFactsXml(undefined, subjectName);
}

/** Names used to resolve `{user}`/`{assistant}` placeholders in fact statements. */
export interface FactRenderNames {
  /** The persona the retrieval was scoped to (the triggering message's author). */
  subjectName?: string;
  /** The responding personality's name (resolves `{assistant}`). */
  personalityName?: string;
  /** Discord username — disambiguates when the persona name collides with the personality name (episode-path parity). */
  discordUsername?: string;
}

/**
 * Format a single fact as `<fact>statement</fact>` (content escaped for
 * injection safety). Extraction episodes are `{user}`/`{assistant}`-templated
 * (LongTermMemoryService), so extracted statements can carry those literal
 * placeholders — resolve them to real names exactly like the episode render
 * path does (`mapQueryResultToDocument`), so a fact reads "Lila is a pastor",
 * never "{user} is a pastor". No names → statement passes through unchanged
 * (raw placeholders are still better escaped than substituted wrongly).
 */
export function formatSingleFact(fact: FactForPrompt, names?: FactRenderNames): string {
  const resolved =
    names?.subjectName !== undefined &&
    names.subjectName.length > 0 &&
    names.personalityName !== undefined &&
    names.personalityName.length > 0
      ? replacePromptPlaceholders(
          fact.statement,
          names.subjectName,
          names.personalityName,
          names.discordUsername
        )
      : fact.statement;
  return `<fact>${escapeXmlContent(resolved)}</fact>`;
}

/**
 * Format retrieved facts as a `<facts>` XML block, or empty string if none.
 * Kept a SEPARATE block from `<memory_archive>` (council: distilled knowledge
 * vs verbatim archive — interleaving confuses the model's temporal framing).
 * `names.subjectName` binds the block's instruction (see
 * {@link factsInstruction}); both names resolve statement placeholders (see
 * {@link formatSingleFact}).
 */
export function formatFactsContext(facts: FactForPrompt[], names?: FactRenderNames): string {
  if (facts.length === 0) {
    return '';
  }
  const formatted = facts.map(f => formatSingleFact(f, names)).join('\n');
  return '\n\n' + buildFactsXml(formatted, names?.subjectName);
}
