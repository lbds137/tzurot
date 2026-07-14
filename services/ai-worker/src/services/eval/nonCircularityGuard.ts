/**
 * Non-circularity guard for the fold-aware retrieval A/B.
 *
 * Folding the last few conversation turns into the embedded query can trivially
 * "retrieve" a memory whose text the fold window already contains — the query
 * literally holds the answer. Crediting that inflates the folded arm dishonestly.
 * The fold's REAL value is reaching OLDER, lexically-distinct memories the bare
 * message can't. So a pooled memory is credit-eligible for a turn only if it
 * clears BOTH guards below.
 *
 * Pure + committed (the corpus/goldens are local-only, but the guard MATH is the
 * reusable instrument the runner and `poolScoring` both apply).
 */

import { AI_DEFAULTS } from '@tzurot/common-types/constants/ai';

/**
 * Temporal guard — mirrors production's LEGACY STM/LTM dedup cutoff
 * (`MemoryRetriever.calculateDeduplicationCutoff` fallback: `excludeNewerThan =
 * oldestHistoryTimestamp - STM_LTM_BUFFER_MS`). Production's pipeline path now
 * uses the exact shipped-history boundary + a selection-time ID filter (the
 * dedup-hole fix); for eval goldens the full window ships (no truncation), so
 * the legacy formula and the exact one coincide and this guard stays faithful.
 * A memory at or newer than that
 * cutoff sits inside the recent-history window the fold already carries, so it's
 * "in the STM window" and NOT credit-eligible. Enforcing this makes the folded
 * arm MORE faithful to prod (which applies the same cutoff at retrieval), not less.
 *
 * @param candidateCreatedAtMs the pooled memory's createdAt (ms)
 * @param oldestHistoryMs the oldest fold-window turn's timestamp (ms)
 * @param bufferMs STM/LTM buffer; defaults to the production constant
 * @returns true if the candidate is inside the STM window (disqualified)
 */
export function isInStmWindow(
  candidateCreatedAtMs: number,
  oldestHistoryMs: number,
  bufferMs: number = AI_DEFAULTS.STM_LTM_BUFFER_MS
): boolean {
  return candidateCreatedAtMs >= oldestHistoryMs - bufferMs;
}

/** Default trigram-Jaccard overlap above which a candidate is treated as an echo. */
export const DEFAULT_ECHO_JACCARD = 0.5;
/** Default verbatim word-run length that flags an echo regardless of Jaccard. */
export const DEFAULT_ECHO_SHINGLE_WORDS = 8;

/** Lowercase character trigrams of a string (whitespace collapsed). */
function charTrigrams(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= normalized.length; i++) {
    grams.add(normalized.slice(i, i + 3));
  }
  return grams;
}

/** Jaccard similarity of two sets (|A∩B| / |A∪B|); 0 when both are empty. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) {
      intersection += 1;
    }
  }
  return intersection / (a.size + b.size - intersection);
}

/** Content words (alphanumeric tokens ≥ 2 chars), lowercased. */
function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length >= 2);
}

/** True if the two texts share a verbatim run of ≥ `n` consecutive content words. */
function hasSharedWordShingle(a: string, b: string, n: number): boolean {
  const wordsA = contentWords(a);
  if (wordsA.length < n) {
    return false;
  }
  const shinglesB = new Set<string>();
  const wordsB = contentWords(b);
  for (let i = 0; i + n <= wordsB.length; i++) {
    shinglesB.add(wordsB.slice(i, i + n).join(' '));
  }
  if (shinglesB.size === 0) {
    return false;
  }
  for (let i = 0; i + n <= wordsA.length; i++) {
    if (shinglesB.has(wordsA.slice(i, i + n).join(' '))) {
      return true;
    }
  }
  return false;
}

export interface EchoOptions {
  jaccardThreshold?: number;
  shingleWords?: number;
}

/**
 * Lexical guard — belt-and-suspenders for the case where an OLDER memory
 * (past the temporal cutoff) is nonetheless quoted verbatim in the fold window.
 * A candidate is an echo if its trigram-Jaccard overlap with the fold window is
 * high OR it shares a long verbatim word run with it.
 *
 * @returns true if the candidate echoes the fold window (disqualified)
 */
export function isLexicalEcho(
  candidateContent: string,
  foldWindowText: string,
  options: EchoOptions = {}
): boolean {
  const jaccardThreshold = options.jaccardThreshold ?? DEFAULT_ECHO_JACCARD;
  const shingleWords = options.shingleWords ?? DEFAULT_ECHO_SHINGLE_WORDS;
  if (foldWindowText.trim().length === 0) {
    return false;
  }
  if (jaccard(charTrigrams(candidateContent), charTrigrams(foldWindowText)) >= jaccardThreshold) {
    return true;
  }
  return hasSharedWordShingle(candidateContent, foldWindowText, shingleWords);
}

/** A pooled candidate's guard inputs. */
export interface GuardInput {
  createdAtMs: number;
  content: string;
}

/** Per-turn context the guard checks a candidate against. */
export interface GuardContext {
  oldestHistoryMs: number;
  foldWindowText: string;
  bufferMs?: number;
  echo?: EchoOptions;
}

export type GuardVerdict = 'eligible' | 'in-window' | 'echo';

/**
 * Classify a candidate against both guards. Temporal is checked first (it mirrors
 * production's own cutoff); lexical echo is the fallback for older-but-quoted rows.
 */
export function classifyCandidate(candidate: GuardInput, context: GuardContext): GuardVerdict {
  if (isInStmWindow(candidate.createdAtMs, context.oldestHistoryMs, context.bufferMs)) {
    return 'in-window';
  }
  if (isLexicalEcho(candidate.content, context.foldWindowText, context.echo)) {
    return 'echo';
  }
  return 'eligible';
}
