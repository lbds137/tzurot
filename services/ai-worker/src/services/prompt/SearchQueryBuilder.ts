/**
 * Search Query Builder
 *
 * Builds search queries for memory retrieval from user messages,
 * attachments, references, and recent history context.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import type { ProcessedAttachment } from '../MultimodalProcessor.js';
import { extractContentDescriptions } from '../RAGUtils.js';
import { ATTACHMENT_SEARCH_BUDGET_CHARS, truncateAtWordBoundary } from './searchQueryBudget.js';

const logger = createLogger('SearchQueryBuilder');

/** Separator between assembled query parts. */
const PART_SEPARATOR = '\n\n';

/** One named contributor to the assembled query, in append order. */
export interface QueryPart {
  name: string;
  text: string;
}

/**
 * Per-part `{ name, chars, offset }` for the assembly log.
 *
 * `offset` is the part's start position in the joined query, and it is the
 * field that matters: a part whose offset is already past the embedder's window
 * contributed nothing, however many characters it has. Reported in characters
 * because that is what this module can count — the model-token truth comes from
 * `LocalEmbeddingService`'s overflow warn on the same request.
 *
 * **These offsets are CHARACTERS, not tokens — do not compare them directly to
 * the 512-token window.** Converting needs a chars-per-token ratio that varies
 * with content (measured near 4 on real prod prose, lower for dense markup), so
 * a character offset only ever indicates that a part is *probably* starved. The
 * overflow warn reports the observed ratio per request for exactly this reason.
 *
 * @internal Exported for testing
 */
export function describeParts(
  parts: QueryPart[]
): { name: string; chars: number; offset: number }[] {
  let offset = 0;
  return parts.map(part => {
    const described = { name: part.name, chars: part.text.length, offset };
    offset += part.text.length + PART_SEPARATOR.length;
    return described;
  });
}

/**
 * Build search query for memory retrieval.
 *
 * Uses actual transcription/description for voice messages and images,
 * includes referenced message content for better memory recall,
 * and optionally includes recent conversation history for context-aware LTM search.
 *
 * The recentHistoryWindow solves the "pronoun problem" where users say things like
 * "what do you think about that?" - without context, LTM search can't find relevant memories.
 *
 * ## Allocation: order + the attachment budget
 *
 * The embedding model reads only `EMBEDDING_MAX_INPUT_TOKENS` (512) and
 * discards the rest silently, so **a long earlier part starves every later
 * one** — order is allocation. Two measured results govern how the parts are
 * bounded, and they point in OPPOSITE directions:
 *
 * - **Folded history dilutes.** The fold-aware A/B on mined goldens found
 *   recall@10 falling 0.436 → 0.390 → 0.256 → 0.195 as the fold widened,
 *   which is why the recent-history part is gated by `shouldFoldSearchQuery`
 *   (queryFoldGate.ts).
 * - **Attachment text is signal, not dilution.** The attachment-allocation A/B
 *   on mined attachment goldens found the opposite dose-response — recall@10
 *   RISES with attachment text (bare 0.379 → lead-sentence 0.482 → half-window
 *   0.528-equivalent) — so the attachment part must NOT be gated out or
 *   trimmed to a lead sentence. It is instead capped at
 *   `ATTACHMENT_SEARCH_BUDGET_CHARS` (half the window), which scored
 *   indistinguishably from the full text while guaranteeing the parts after
 *   it (`referencedMessagesText`) actually reach the embedder — before the
 *   cap, a median-length image description starved them out entirely.
 *
 * The eval arms (`../eval/allocationArms.ts`) import the same budget code, so
 * a change here is automatically what the next A/B measures.
 */
export function buildSearchQuery(
  userMessage: string,
  processedAttachments: ProcessedAttachment[],
  referencedMessagesText?: string,
  recentHistoryWindow?: string
): string {
  const parts: QueryPart[] = [];

  // Add recent conversation history FIRST (provides context for ambiguous queries)
  // This helps resolve pronouns like "that", "it", "he" by embedding the recent topic
  if (recentHistoryWindow !== undefined && recentHistoryWindow.length > 0) {
    parts.push({ name: 'recentHistory', text: recentHistoryWindow });
  }

  // Add user message (if not just the "Hello" fallback)
  if (userMessage.trim().length > 0 && userMessage.trim() !== 'Hello') {
    parts.push({ name: 'userMessage', text: userMessage });
  }

  const attachmentPart = buildAttachmentPart(processedAttachments, userMessage);
  if (attachmentPart !== null) {
    parts.push({ name: 'attachmentDescriptions', text: attachmentPart.text });
  }

  // Add referenced message content for semantic search
  if (referencedMessagesText !== undefined && referencedMessagesText.length > 0) {
    parts.push({ name: 'referencedMessages', text: referencedMessagesText });
  }

  // If we have nothing, fall back to "Hello"
  if (parts.length === 0) {
    return userMessage.trim().length > 0 ? userMessage : 'Hello';
  }

  const query = parts.map(part => part.text).join(PART_SEPARATOR);

  // Report what was ASSEMBLED and where each part starts, not what was
  // "included" — a part appended past the embedder's window contributes
  // nothing, and the previous per-part "Including referenced message content in
  // memory search query" line asserted an inclusion it could not know had
  // happened. Offsets make starvation legible: a part whose offset already
  // exceeds the window never reached the model. The authoritative overflow
  // signal is LocalEmbeddingService's warn, which counts real model tokens;
  // this is the composition that produced it. `attachmentCharsBeforeBudget`
  // (only present when the cap actually removed text) is how the budget's
  // real-world bite becomes measurable.
  const attachmentCharsBeforeBudget =
    attachmentPart !== null && attachmentPart.beforeBudgetChars > ATTACHMENT_SEARCH_BUDGET_CHARS
      ? attachmentPart.beforeBudgetChars
      : undefined;
  logger.info(
    {
      totalChars: query.length,
      parts: describeParts(parts),
      ...(attachmentCharsBeforeBudget !== undefined ? { attachmentCharsBeforeBudget } : {}),
    },
    'Assembled memory search query'
  );

  return query;
}

/**
 * Budget-capped attachment part, or null when there is nothing to add.
 * `beforeBudgetChars` carries the pre-cap length for the composition log.
 */
function buildAttachmentPart(
  processedAttachments: ProcessedAttachment[],
  userMessage: string
): { text: string; beforeBudgetChars: number } | null {
  if (processedAttachments.length === 0) {
    return null;
  }
  const descriptions = extractContentDescriptions(processedAttachments);
  if (descriptions.length === 0) {
    return null;
  }

  // The turn has no real user text — the attachment content (a transcript or
  // an image description) is what the search runs on.
  if (userMessage.trim() === 'Hello') {
    logger.info('Using attachment content for memory search instead of "Hello" fallback');
  }

  return {
    text: truncateAtWordBoundary(descriptions, ATTACHMENT_SEARCH_BUDGET_CHARS),
    beforeBudgetChars: descriptions.length,
  };
}
