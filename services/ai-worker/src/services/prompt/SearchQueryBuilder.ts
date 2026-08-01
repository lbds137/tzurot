/**
 * Search Query Builder
 *
 * Builds search queries for memory retrieval from user messages,
 * attachments, references, and recent history context.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import type { ProcessedAttachment } from '../MultimodalProcessor.js';
import { extractContentDescriptions } from '../RAGUtils.js';

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
 * ## This builder is UNBOUNDED, and the embedder is not
 *
 * The parts are concatenated with no cap, but the embedding model reads only
 * `EMBEDDING_MAX_INPUT_TOKENS` (512) and discards the rest silently. Parts are
 * appended in the order below, so **a long earlier part starves every later
 * one**: measured on a real prod turn, a 1,700-char image description pushed the
 * query to 2,093 tokens and the referenced-message text — appended last —
 * contributed nothing at all.
 *
 * Two consequences worth knowing before changing anything here:
 *
 * - **Order is allocation.** Whatever comes first wins the window. That is not a
 *   considered ranking; it is the order the parts happened to be written in.
 * - **More text is not more signal.** The fold-aware A/B on mined goldens found
 *   dilution actively harmful for content-rich queries — recall@10 fell 0.436 →
 *   0.390 → 0.256 → 0.195 as the fold widened. That is why the recent-history
 *   part is gated by `shouldFoldSearchQuery` (queryFoldGate.ts) and the others
 *   are not (yet).
 *
 * Fixing the allocation therefore needs evidence, not just a budget: the
 * goldens are text-only today, so no attachment-bearing turn has ever been
 * scored. `LocalEmbeddingService` now warns on overflow, which is how the real
 * rate becomes measurable.
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

  // Add attachment descriptions (voice transcriptions, image descriptions)
  if (processedAttachments.length > 0) {
    const descriptions = extractContentDescriptions(processedAttachments);

    if (descriptions.length > 0) {
      parts.push({ name: 'attachmentDescriptions', text: descriptions });

      // Log when using voice transcription instead of "Hello"
      if (userMessage.trim() === 'Hello') {
        logger.info('Using voice transcription for memory search instead of "Hello" fallback');
      }
    }
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
  // this is the composition that produced it.
  logger.info(
    { totalChars: query.length, parts: describeParts(parts) },
    'Assembled memory search query'
  );

  return query;
}
