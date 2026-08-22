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
import { formatSingleHistoryEntryAsXml } from '../../jobs/utils/conversationUtils.js';
import type { StructuredHistoryEntry } from '../../jobs/utils/conversationTypes.js';
import { renderHistoryEntryForMeasure } from './RealMessagesBuilder.js';

/**
 * Per-message wire framing cost: the role/content envelope a real message
 * pays for on the wire that an XML `<message>` element folded inside one
 * system-prompt string does not. Approximated from the OpenAI
 * message-framing convention (~4 tokens/message); not re-verified per
 * provider (OpenRouter, z.ai-direct) — the same single-tokenizer
 * approximation the rest of the budget already runs on. Charged once per shipped real message in
 * {@link measureHistoryEntryRealTokens} so the flag-on measure prices the same
 * overhead the flag-on render actually incurs.
 */
export const PER_MESSAGE_WIRE_OVERHEAD_TOKENS = 4;

/**
 * The widest gap-line shape `RealMessagesBuilder`'s `gapLineFor` can produce
 * in practice: `formatTimeGap` joins at most two units (see `TIME_UNITS` in
 * `@tzurot/common-types/utils/timeGap`), and history retention
 * (`CLEANUP_DEFAULTS.DAYS_TO_KEEP_HISTORY`, 30 days) bounds the real gap
 * between two retained entries to ~4 weeks — so a 2-digit week count is
 * already generous. The week VALUE itself is unbounded in `formatTimeGap`,
 * so a gap past ~2 years would out-tokenize this constant by a token or two;
 * retention makes that unreachable from persisted history, and the eviction
 * cut's own clamps are the backstop if it ever isn't. Charged to EVERY entry in
 * {@link measureHistoryEntryRealTokens} rather than derived per-entry, because
 * whether a given entry actually pays a gap line depends on its NEIGHBOUR
 * (the previous shipped entry's timestamp) — information a per-entry measure
 * cannot see. Over-charging every entry keeps the measure on the over-measure
 * side, the same safe direction the XML measure's full-form-without-dedup
 * convention already takes.
 */
const WORST_CASE_GAP_LINE = '[time gap: 52 weeks 6 days]\n';
const WORST_CASE_GAP_LINE_TOKENS = countTextTokens(WORST_CASE_GAP_LINE);

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
 *
 * `realMessagesEnabled` is this turn's captured flag value — it selects only
 * the dedup-stub WORDING inside the rendered XML (this measure always renders
 * the XML form regardless of the flag; see `ContextWindowManager`'s
 * cross-channel path, which renders XML in both flag states).
 */
export function measureHistoryEntryTokens(
  entry: StructuredHistoryEntry,
  personalityName: string,
  allPersonalityNames?: Set<string>,
  responderPersonalityId?: string,
  realMessagesEnabled = false
): number {
  const xml = formatSingleHistoryEntryAsXml(entry, personalityName, {
    historyEntries: undefined,
    allPersonalityNames,
    responderPersonalityId,
    realMessagesEnabled,
  });
  return xml.length > 0 ? countTextTokens(xml) : 0;
}

/**
 * Tokens this entry will cost when it ships as a REAL message (the
 * `realMessagesEnabled` flag-on form), rather than as an XML `<message>`
 * element. Renders through `renderHistoryEntryForMeasure` — the same
 * body-rendering pipeline `buildRealMessages` uses per entry, minus the two
 * per-window inputs that only exist once a window is being shipped (see that
 * function's doc-comment) — then adds the two costs a per-entry render cannot
 * see on its own: the worst-case inter-message gap line, and the per-message
 * wire-framing overhead a real message pays that an XML element does not.
 *
 * Returns 0 for a row the real-message render skips entirely (matching what
 * the prompt will actually contain), same contract as
 * {@link measureHistoryEntryTokens}.
 */
export function measureHistoryEntryRealTokens(
  entry: StructuredHistoryEntry,
  personalityName: string,
  allPersonalityNames?: Set<string>,
  responderPersonalityId?: string,
  realMessagesEnabled = true
): number {
  const content = renderHistoryEntryForMeasure(
    entry,
    personalityName,
    allPersonalityNames,
    responderPersonalityId,
    realMessagesEnabled
  );
  if (content.length === 0) {
    return 0;
  }
  return countTextTokens(content) + WORST_CASE_GAP_LINE_TOKENS + PER_MESSAGE_WIRE_OVERHEAD_TOKENS;
}
