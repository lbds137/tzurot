/**
 * Memory-archive summarizer validation: quoted-span stripping, first-person
 * leak detection, and the length-outcome decision.
 *
 * Adapted from the render-pilot's `hasFirstPerson`/`decideSummaryOutcome`
 * (`packages/tooling/src/memory/render-pilot-metrics.ts`), widened to accept
 * curly quotes/apostrophes (a summarizer model routinely emits them), the
 * reflexive `ourselves`/`ourself` forms, and to cover a non-length
 * regeneration trigger (the referent check), which the pilot's two-state
 * length model didn't need to distinguish.
 */

import { SUMMARY_SOFT_CAP_TOKENS, SUMMARY_HARD_CAP_TOKENS } from './constants.js';

/**
 * `'over_soft'` is retained for vocabulary parity with the pilot's telemetry
 * but is never produced by this flow: every over-soft first pass triggers
 * exactly one regeneration, so the outcome always resolves to `'regenerated'`
 * or `'overflow'` instead.
 */
export type LengthState = 'within_soft' | 'over_soft' | 'regenerated' | 'overflow';

/** Remove double-quoted spans, straight (`"…"`) and curly (`"…"`), so a quoted
 *  form of address is not mistaken for a voice leak. */
export function stripQuotedSpans(text: string): string {
  return text.replace(/"[^"]*"|“[^“”]*”/g, '');
}

/**
 * Case-sensitive first-person leak detector, run on quote-stripped text.
 * Contractions are ordered before bare `I` in the alternation so `I'm` is not
 * matched as `I`; both straight and curly apostrophes are accepted.
 */
export function hasFirstPerson(text: string): boolean {
  const stripped = stripQuotedSpans(text);
  // Case-sensitive on purpose: `/i` would match `US`, `OUR`, and other
  // all-caps tokens that are not pronouns, so sentence-initial capitals are
  // enumerated instead.
  return /\b(I['’]m|I['’]ve|I['’]d|I['’]ll|I|me|my|mine|myself|we|our|ours|ourselves|ourself|us|We|My|Me|Our|Ours|Ourselves|Ourself|Us|Mine|Myself)\b/.test(
    stripped
  );
}

/** Decide the length outcome of a summarization attempt: `overflow` is judged
 *  on the FINAL text, but `within_soft`/`over_soft`/`regenerated` describe
 *  the FIRST-pass verdict and whether a regeneration pass ran. */
export function decideLengthState(input: {
  firstTokens: number;
  finalTokens: number;
  regenerated: boolean;
}): LengthState {
  if (input.finalTokens > SUMMARY_HARD_CAP_TOKENS) {
    return 'overflow';
  }
  if (input.firstTokens <= SUMMARY_SOFT_CAP_TOKENS) {
    return 'within_soft';
  }
  if (input.regenerated) {
    return 'regenerated';
  }
  return 'over_soft';
}
