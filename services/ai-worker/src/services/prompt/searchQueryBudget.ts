/**
 * Search-query part budgets.
 *
 * The embedder reads only 512 model tokens (`EMBEDDING_MAX_INPUT_TOKENS`) and
 * silently discards the rest, so the ORDER parts are appended in is an
 * allocation policy: a long early part starves every later one. On
 * attachment-bearing turns the image description overflows the window at the
 * MEDIAN (mined p50 3,654 chars against a ~2,000-char window), which starved
 * `referencedMessagesText` — appended last — on every such turn.
 *
 * The cap below is the arm that WON the judged attachment-allocation A/B
 * (24 real mined goldens, TREC-pooled, non-circularity-guarded — harness in
 * `../eval/attachmentAllocationPooling.eval.test.ts`):
 *
 * - Dropping the attachment part entirely ("gate it like the fold") lost
 *   6 of 16 image turns (net −5 paired flips) — descriptions are SIGNAL on
 *   attachment turns, the opposite of what folded history is.
 * - Trimming to a lead sentence lost recall too (net −1).
 * - Capping at half the window scored indistinguishably from the full text
 *   (net 0, recall@10 0.511 vs 0.528) while freeing the tail of the window
 *   for the parts after it.
 *
 * So the cap costs nothing measurable and makes the builder's existing intent
 * real: references actually reach the embedder instead of being a silent
 * no-op. The eval arm imports THIS function and THIS constant, so the
 * measured policy and the shipped policy cannot drift apart.
 *
 * Chars, not tokens: the builder runs outside the embedding worker, so it
 * cannot count model tokens. Real prod prose measures ~4 chars/token (the
 * overflow warn reports the observed ratio per request), making half the
 * 512-token window ≈ 1024 chars.
 */

/** Half the 512-token window at the ~4 chars/token measured on prod prose. */
export const ATTACHMENT_SEARCH_BUDGET_CHARS = 1024;

/**
 * Truncate to at most `maxChars`, backing up to the last whitespace so the cut
 * lands between words — unless that would sacrifice more than half the budget
 * (one unbroken run), in which case cut hard.
 */
export function truncateAtWordBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  const slice = text.slice(0, maxChars);
  const lastBreak = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('\n'));
  const bounded = lastBreak > maxChars / 2 ? slice.slice(0, lastBreak) : slice;
  // Only the hard cut can land mid-character (the word-boundary cut ends at
  // whitespace): drop a dangling high surrogate so an emoji at the cap can't
  // leave a lone half-pair in the query.
  const clean = /[\uD800-\uDBFF]$/.test(bounded) ? bounded.slice(0, -1) : bounded;
  return clean.trimEnd();
}
