/**
 * Rewrites the assistant half of a stored exchange text
 * (`{user}: <message>\n{assistant}: <reply>`), shared by the gateway (which
 * rewrites memory and pending-memory rows) and bot-client (which refuses an
 * edit before touching Discord when the new reply would break the template).
 */

import {
  ASSISTANT_SEPARATOR,
  REFERENCED_BLOCK_RE,
  splitMemoryContent,
} from './memoryContentSplit.js';

/**
 * Replace the assistant reply in a stored exchange text, keeping the trailing
 * referenced-content block.
 *
 * @returns the new text, or `null` when the stored text is not in the template
 * or the new reply would make the result unparseable.
 */
export function rewriteReplyInExchangeText(text: string, newReply: string): string | null {
  if (splitMemoryContent(text) === null) {
    return null;
  }
  const sepIndex = text.indexOf(ASSISTANT_SEPARATOR);
  const headEnd = sepIndex + ASSISTANT_SEPARATOR.length;
  const trailingRef = REFERENCED_BLOCK_RE.exec(text.slice(headEnd))?.[0] ?? '';
  const rewritten = text.slice(0, headEnd) + newReply + trailingRef;
  return splitMemoryContent(rewritten) === null ? null : rewritten;
}
