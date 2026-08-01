/**
 * History Token Measurement
 *
 * The ONE way to ask "how many tokens does this history entry cost the prompt?"
 *
 * It renders the entry with the prompt's own renderer and counts the result
 * with the prompt's own tokenizer, so the number a budget spends against and
 * the number the model actually receives cannot disagree.
 *
 * This replaced a hand-written character estimator that summed an approximation
 * of every XML section and divided by four. Two things were wrong with it: it
 * was a second implementation of the renderer, free to drift (it had already
 * drifted on quote attribute names before being repointed at the real one), and
 * its callers preferred a DB-cached `tokenCount` over calling it at all. That
 * cached value is `countTextTokens(content)` — raw content, no XML envelope, no
 * metadata sections — so it understates a plain-text entry by ~60% and a
 * metadata-carrying one by up to ~87%.
 */

import { countTextTokens } from '@tzurot/common-types/utils/tokenCounter';
import { formatSingleHistoryEntryAsXml } from './conversationUtils.js';
import type { RawHistoryEntry } from './conversationTypes.js';

/**
 * Tokens this entry will cost when it ships in the prompt.
 *
 * Measured WITHOUT the history-id set that dedupes repeated quotes, because
 * budget callers are deciding WHICH entries to select and the set of shipped
 * ids does not exist yet. So this is the full, non-deduped form. The delta is
 * small but not signed: a deduped quote drops its content, yet still carries
 * its media in full, so a short quote carrying a long image description can
 * render slightly LARGER as a stub than as itself.
 *
 * `allPersonalityNames` DOES get threaded, unlike the dedup set, because it is
 * derivable from the input history alone (`collectPersonalityNames`) rather
 * than from the selection outcome. Without it a user persona colliding with a
 * SIBLING personality's name loses its ` (@username)` disambiguation suffix
 * here while the shipped XML carries it — the same measured-vs-shipped
 * disagreement this module exists to remove, in miniature. Callers pass the
 * set scoped the way their renderer will scope it.
 *
 * Returns 0 for an entry the renderer declines to emit (a role it has no
 * speaker for), matching what the prompt will contain.
 */
export function measureHistoryEntryTokens(
  entry: RawHistoryEntry,
  personalityName: string,
  allPersonalityNames?: Set<string>
): number {
  const xml = formatSingleHistoryEntryAsXml(entry, personalityName, undefined, allPersonalityNames);
  return xml.length > 0 ? countTextTokens(xml) : 0;
}
