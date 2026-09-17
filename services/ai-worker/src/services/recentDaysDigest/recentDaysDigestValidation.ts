/**
 * Recent-days digest validation: quoted-run detection against the
 * character's own words, the length-outcome decision, and the combined
 * verdict a generated digest is judged by.
 *
 * First-person detection is IMPORTED from the memory-archive summarizer's
 * validator rather than copied — one leak detector, two callers.
 */

import { hasFirstPerson } from '../archiveSummary/archiveSummaryValidation.js';
import { countTextTokens } from '@tzurot/common-types/utils/tokenCounter';
import {
  RECENT_DAYS_DIGEST,
  type DigestFailureClass,
} from '@tzurot/common-types/constants/recentDaysDigest';

export { hasFirstPerson };

export type DigestLengthState = 'within_soft' | 'over_soft' | 'overflow';

// Punctuation stripped before n-gram comparison, built from character codes
// rather than as quote glyphs sitting in a regex character class:
// guard:prompt-tags' string-literal scanner is a plain quote-pairing regex,
// not a real tokenizer, and a literal straight quote in a `/[...]/` class
// reads to it as an opening string that then hunts for a close quote through
// unrelated code below. Codes: apostrophe, quotation mark, left/right single
// quotation marks, left/right double quotation marks.
const PUNCTUATION_CODES = [39, 34, 8216, 8217, 8220, 8221];
const PUNCTUATION_REGEX = new RegExp(
  `[${PUNCTUATION_CODES.map(code => String.fromCharCode(code)).join('')}.,!?;:()]`,
  'g'
);

/** Lowercase, strip punctuation, split on whitespace — the same normalization
 *  on both the digest and the source content, so a quoted run survives case
 *  and punctuation differences. */
function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(PUNCTUATION_REGEX, '')
    .split(/\s+/)
    .filter(word => word.length > 0);
}

function ngrams(words: string[], n: number): string[] {
  const grams: string[] = [];
  for (let i = 0; i + n <= words.length; i++) {
    grams.push(words.slice(i, i + n).join(' '));
  }
  return grams;
}

/** Find the first run of `n` consecutive words in `digest` that also appears
 *  in any of `assistantContents` — the character's own source lines only;
 *  quoting the USER is not the failure class this guards against. Returns
 *  the matched n-gram (for the failure detail) or null. */
export function findQuotedNgram(
  digest: string,
  assistantContents: string[],
  n: number = RECENT_DAYS_DIGEST.QUOTATION_NGRAM
): string | null {
  const assistantGrams = new Set<string>();
  for (const content of assistantContents) {
    for (const gram of ngrams(normalizeWords(content), n)) {
      assistantGrams.add(gram);
    }
  }
  for (const gram of ngrams(normalizeWords(digest), n)) {
    if (assistantGrams.has(gram)) {
      return gram;
    }
  }
  return null;
}

/** Length outcome against the soft/hard caps. `over_soft` alone is not a
 *  validation failure — it is the trigger for exactly one regeneration pass;
 *  only a FINAL text still over the hard cap is a billed `overflow` failure. */
export function decideDigestLength(tokens: number): DigestLengthState {
  if (tokens > RECENT_DAYS_DIGEST.HARD_CAP_TOKENS) {
    return 'overflow';
  }
  if (tokens > RECENT_DAYS_DIGEST.SOFT_CAP_TOKENS) {
    return 'over_soft';
  }
  return 'within_soft';
}

export type DigestValidationResult =
  { ok: true } | { ok: false; cls: DigestFailureClass; detail: string };

/** The combined verdict on a generated digest, checked in order
 *  first_person -> quotation -> overflow (over_soft alone passes here — the
 *  caller decides whether to regenerate before calling this on the final text). */
export function validateDigest(
  digest: string,
  assistantContents: string[]
): DigestValidationResult {
  if (hasFirstPerson(digest)) {
    return { ok: false, cls: 'first_person', detail: 'first-person pronoun detected' };
  }
  const quoted = findQuotedNgram(digest, assistantContents);
  if (quoted !== null) {
    return { ok: false, cls: 'quotation', detail: quoted };
  }
  const tokens = countTextTokens(digest);
  if (decideDigestLength(tokens) === 'overflow') {
    return { ok: false, cls: 'overflow', detail: `${tokens} tokens` };
  }
  return { ok: true };
}
