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

/** The single-quote closer set: end of text, whitespace, closing punctuation,
 *  or a dash. It mirrors the straight-single opener set, which also admits the
 *  three dashes. */
const CLOSER = String.raw`[\s.,;:!?)\]}—–-]`;

/** Single-quoted spans are matched with a tempered dot — any character,
 *  lazily, so long as it is not a quote that would itself sit at a closer
 *  boundary — so the span ends at the first quote followed by end-of-text,
 *  whitespace, closing punctuation, or a dash, and an apostrophe followed by a
 *  letter is ordinary content rather than a terminator. The curly body also
 *  excludes a nested opening `‘`, which no span needs and which `eslint-plugin-
 *  regexp`'s `no-super-linear-move` rejects: without it a run of `‘` retries
 *  the whole body at every start position. The straight body needs no such
 *  exclusion because its opener group (`^` or a boundary character before the
 *  `'`) already bounds where a match may start, so the rule does not fire. */
const CURLY_SINGLE = new RegExp(String.raw`‘(?:(?!’(?:$|${CLOSER}))[^‘])*?’(?=$|${CLOSER})`, 'g');
const STRAIGHT_SINGLE = new RegExp(
  String.raw`(^|[\s([{—–-])'(?:(?!'(?:$|${CLOSER})).)*?'(?=$|${CLOSER})`,
  'g'
);

/** Remove quoted spans in all four styles — straight double (`"…"`), curly
 *  double (`“…”`), curly single (`‘…’`), and straight single (`'…'`) — so a
 *  quoted form of address is not mistaken for a voice leak. For the straight-
 *  single case, an opening `'` must sit at the start of the text or be
 *  preceded by whitespace, an opening bracket, or a dash, and the closing `'`
 *  must sit at a closer boundary — so a possessive or contraction apostrophe
 *  can neither open nor close a span. Both single-quote forms temper their
 *  body (see `CURLY_SINGLE`/`STRAIGHT_SINGLE` above), so an apostrophe INSIDE
 *  a span — the contraction in quoted dialogue — is content, not a closer.
 *  Pinned by `archiveSummaryValidation.test.ts`: `MEM-ARCH-018: a quoted form
 *  of address is not a leak, the same words unquoted ARE`, `a straight
 *  single-quoted span is not a leak, the same words unquoted ARE`, `a curly
 *  single-quoted span is not a leak`, `an apostrophe neither opens nor closes
 *  a span`, and `an apostrophe inside a single-quoted span is content, not a
 *  closer`.
 *
 *  Design trade-off, not a proven bound: a span whose real closing quote is
 *  missing can run on to a LATER quote that happens to sit at a closer
 *  boundary — a plural possessive such as `sisters'` — swallowing the text
 *  between. The validator prefers that rare over-strip to rejecting a good
 *  digest on every contraction inside dialogue. */
export function stripQuotedSpans(text: string): string {
  return text
    .replace(/"[^"]*"|“[^“”]*”/g, '')
    .replace(CURLY_SINGLE, '')
    .replace(STRAIGHT_SINGLE, '$1');
}

// Case-sensitive on purpose: `/i` would match `US`, `OUR`, and other
// all-caps tokens that are not pronouns, so sentence-initial capitals are
// enumerated instead.
const FIRST_PERSON_REGEX =
  /\b(I['’]m|I['’]ve|I['’]d|I['’]ll|I|me|my|mine|myself|we|our|ours|ourselves|ourself|us|We|My|Me|Our|Ours|Ourselves|Ourself|Us|Mine|Myself)\b/;

/**
 * Find the first first-person token in `text`, run on quote-stripped text.
 * Contractions are ordered before bare `I` in the alternation so `I'm` is not
 * matched as `I`; both straight and curly apostrophes are accepted. Returns
 * the matched token (for a failure detail) or null.
 */
export function findFirstPersonToken(text: string): string | null {
  const stripped = stripQuotedSpans(text);
  return FIRST_PERSON_REGEX.exec(stripped)?.[0] ?? null;
}

/**
 * Case-sensitive first-person leak detector, run on quote-stripped text.
 * Delegates to `findFirstPersonToken` so both callers share one regex.
 */
export function hasFirstPerson(text: string): boolean {
  return findFirstPersonToken(text) !== null;
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
