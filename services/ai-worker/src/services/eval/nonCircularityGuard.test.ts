import { describe, it, expect } from 'vitest';
import { AI_DEFAULTS } from '@tzurot/common-types/constants/ai';
import {
  isInStmWindow,
  isLexicalEcho,
  classifyCandidate,
  DEFAULT_ECHO_JACCARD,
} from './nonCircularityGuard.js';

const MINUTE = 60_000;

describe('isInStmWindow (temporal guard)', () => {
  const oldest = 1_000_000_000_000; // arbitrary fixed ms

  it('flags a candidate at or newer than oldestHistory - buffer as in-window', () => {
    // Exactly at the cutoff → in-window (>= is disqualifying).
    expect(isInStmWindow(oldest - AI_DEFAULTS.STM_LTM_BUFFER_MS, oldest)).toBe(true);
    // Newer than the window → in-window.
    expect(isInStmWindow(oldest + MINUTE, oldest)).toBe(true);
  });

  it('clears a candidate older than the cutoff', () => {
    expect(isInStmWindow(oldest - AI_DEFAULTS.STM_LTM_BUFFER_MS - 1, oldest)).toBe(false);
    expect(isInStmWindow(oldest - MINUTE, oldest)).toBe(false);
  });

  it('mirrors production: the cutoff is oldestHistory minus STM_LTM_BUFFER_MS', () => {
    // A memory 5s before the oldest history turn is still inside the 10s buffer → in-window.
    expect(isInStmWindow(oldest - 5_000, oldest)).toBe(true);
    // 11s before → past the buffer → eligible.
    expect(isInStmWindow(oldest - 11_000, oldest)).toBe(false);
  });

  it('honors a custom buffer', () => {
    expect(isInStmWindow(oldest - 500, oldest, 1_000)).toBe(true);
    expect(isInStmWindow(oldest - 1_500, oldest, 1_000)).toBe(false);
  });
});

describe('isLexicalEcho (lexical guard)', () => {
  it('flags a candidate that is (nearly) the fold window verbatim', () => {
    const text = 'we talked at length about the trip to the northern coast last winter';
    expect(isLexicalEcho(text, text)).toBe(true);
  });

  it('clears a lexically distinct candidate even on the same topic', () => {
    const fold = 'what did you think about that plan we discussed';
    const candidate = 'The user prefers oat milk in their morning coffee.';
    expect(isLexicalEcho(candidate, fold)).toBe(false);
  });

  it('flags a long verbatim word run even when overall Jaccard is low', () => {
    const fold = 'she said the quick brown fox jumps over the lazy dog every single morning';
    // Shares an ≥8-word run but is otherwise a much longer, different document.
    const candidate = `${'unrelated preamble '.repeat(20)} the quick brown fox jumps over the lazy dog ${'unrelated tail '.repeat(20)}`;
    expect(jaccardBelow(candidate, fold)).toBe(true); // sanity: overall overlap is low
    expect(isLexicalEcho(candidate, fold)).toBe(true); // but the shingle catches it
  });

  it('returns false for an empty fold window', () => {
    expect(isLexicalEcho('anything at all here', '')).toBe(false);
  });
});

/** Test helper: confirm two texts are below the Jaccard echo threshold (so a true
 * isLexicalEcho result must be coming from the shingle branch, not Jaccard). */
function jaccardBelow(a: string, b: string): boolean {
  // Re-derive a coarse trigram Jaccard the same way the guard does, to assert the
  // shingle branch is what fired. Kept local so the guard's internals stay private.
  const grams = (t: string): Set<string> => {
    const n = t.toLowerCase().replace(/\s+/g, ' ').trim();
    const g = new Set<string>();
    for (let i = 0; i + 3 <= n.length; i++) g.add(n.slice(i, i + 3));
    return g;
  };
  const ga = grams(a);
  const gb = grams(b);
  let inter = 0;
  for (const x of ga) if (gb.has(x)) inter += 1;
  const j = inter / (ga.size + gb.size - inter);
  return j < DEFAULT_ECHO_JACCARD;
}

describe('classifyCandidate', () => {
  const oldest = 1_000_000_000_000;
  const context = { oldestHistoryMs: oldest, foldWindowText: 'the trip to the coast last winter' };

  it('returns in-window when the temporal guard fails (checked first)', () => {
    // Newer than cutoff AND an echo — temporal wins the label.
    expect(
      classifyCandidate({ createdAtMs: oldest, content: context.foldWindowText }, context)
    ).toBe('in-window');
  });

  it('returns echo when old enough but lexically overlapping', () => {
    expect(
      classifyCandidate(
        { createdAtMs: oldest - 10 * MINUTE, content: 'the trip to the coast last winter' },
        context
      )
    ).toBe('echo');
  });

  it('returns eligible when old and lexically distinct', () => {
    expect(
      classifyCandidate(
        { createdAtMs: oldest - 10 * MINUTE, content: 'user has a cat named Miso' },
        context
      )
    ).toBe('eligible');
  });
});
