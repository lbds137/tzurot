/**
 * Recent-days digest validation: quoted-run detection against the
 * character's own words, the length-outcome decision, and the combined
 * verdict a generated digest is judged by.
 *
 * First-person detection is IMPORTED from the memory-archive summarizer's
 * validator rather than copied — one leak detector, two callers.
 */

import {
  hasFirstPerson,
  findFirstPersonToken,
} from '../archiveSummary/archiveSummaryValidation.js';
import { countTextTokens } from '@tzurot/common-types/utils/tokenCounter';
import {
  RECENT_DAYS_DIGEST,
  type DigestFailureClass,
} from '@tzurot/common-types/constants/recentDaysDigest';

export { hasFirstPerson, findFirstPersonToken };

export type DigestLengthState = 'within_soft' | 'over_soft' | 'overflow';

// Punctuation stripped before n-gram comparison: straight and curly quotes,
// sentence punctuation, and parentheses.
const PUNCTUATION_REGEX = /['"‘’“”.,!?;:()]/g;

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
  const firstPersonToken = findFirstPersonToken(digest);
  if (firstPersonToken !== null) {
    return { ok: false, cls: 'first_person', detail: firstPersonToken };
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
