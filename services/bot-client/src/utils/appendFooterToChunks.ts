/**
 * Footer placement for chunked Discord responses.
 *
 * A leaf module shared by the response sender and the reply editor so a freshly
 * sent reply and an edited one place their footer identically.
 */

import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';

/**
 * Append footer to the last chunk, or add as a new chunk if it would overflow.
 * Mutates `chunks` in place; a no-op for an empty list or an empty footer.
 */
export function appendFooterToChunks(chunks: string[], footer: string): void {
  if (chunks.length === 0 || footer.length === 0) {
    return;
  }
  const lastIndex = chunks.length - 1;
  if (chunks[lastIndex].length + footer.length <= DISCORD_LIMITS.MESSAGE_LENGTH) {
    chunks[lastIndex] += footer;
  } else {
    chunks.push(footer.trimStart());
  }
}
