/**
 * Header id-disambiguation tag widths.
 *
 * These are the id-tag widths the platform actually emits. The producer is
 * `assignGroupTags` in ai-worker's `services/ai-worker/src/jobs/utils/participantUtils.ts`,
 * which cuts `hexOf(id)` — the id lowercased with hyphens REMOVED — at 4
 * chars, then 8, then the whole hex string (32 chars for a UUID id). Two
 * consumers strip/mask the same three widths — ai-worker's output-side strip
 * (`responseArtifacts.ts`) and bot-client's `/inspect` mask
 * (`maskHeaderIdTags.ts`) — and both build their pattern from this table.
 */
export const HEADER_ID_TAG_WIDTHS = [4, 8, 32] as const;

/**
 * Build a fresh `RegExp` matching a header id tag, e.g. `(id:abcd1234)`.
 *
 * Returns a NEW `RegExp` object on every call rather than a shared constant:
 * callers hold `g`-flagged patterns whose `lastIndex` is stateful, and a
 * shared instance would let one caller's in-progress match position corrupt
 * another's.
 *
 * The width alternation is bounded to exactly {@link HEADER_ID_TAG_WIDTHS}
 * rather than open-ended (`(id:[0-9a-f]+)`) — an unbounded match would delete
 * a character's legitimate parenthetical whenever it happens to contain
 * `id:` followed by hex-looking text.
 *
 * Case-insensitive (`i` flag) is deliberate: this pattern also hunts a
 * MODEL's echo of the header format in generated text, and an echo is not
 * bound to the platform's own lowercase rendering.
 */
export function buildHeaderIdTagPattern(): RegExp {
  const widths = HEADER_ID_TAG_WIDTHS.map(width => `[0-9a-f]{${width}}`).join('|');
  return new RegExp(`\\(id:(?:${widths})\\)`, 'gi');
}
