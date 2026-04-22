import { describe, it, expect } from 'vitest';
import { findDuplicates, extractPrRefs, classifyRefs } from './verify-notes.js';

describe('extractPrRefs', () => {
  it('extracts refs from canonical `(#N)` line items', () => {
    const notes = [
      '### Features',
      '- **ai-worker:** thing (#869)',
      '- **api-gateway:** hardening (#870)',
    ].join('\n');
    expect(extractPrRefs(notes)).toEqual([869, 870]);
  });

  it('returns an empty array when the notes have no PR refs', () => {
    expect(extractPrRefs('# Release notes\n\nNothing to see.')).toEqual([]);
  });

  it('ignores bare `#N` references in prose (parens-only match)', () => {
    // Tight regex is the fix for the prior "known limitation" — prose refs
    // like "fixes #45 in upstream" no longer surface as spurious `extra`
    // entries. Only `(#N)` at bullet-end matches, matching the draft-notes
    // generator output format.
    const notes = 'See issue #42 upstream. Referencing #43 in passing. This PR is (#869).';
    expect(extractPrRefs(notes)).toEqual([869]);
  });

  it('captures duplicates when the same `(#N)` appears more than once', () => {
    const notes = 'Mentioned in (#869) and also in (#869).';
    expect(extractPrRefs(notes)).toEqual([869, 869]);
  });
});

describe('classifyRefs', () => {
  it('reports all three categories when each is non-empty', () => {
    const result = classifyRefs([868, 870, 870, 999], new Set([868, 869, 870]));
    expect(result.missing).toEqual([869]);
    expect(result.extra).toEqual([999]);
    expect(result.duplicates).toEqual([870]);
  });

  it('returns empty arrays when notes match merged set exactly', () => {
    const result = classifyRefs([868, 869, 870], new Set([868, 869, 870]));
    expect(result.missing).toEqual([]);
    expect(result.extra).toEqual([]);
    expect(result.duplicates).toEqual([]);
  });

  it('flags every merged PR as missing when notes are empty', () => {
    const result = classifyRefs([], new Set([868, 869]));
    expect(result.missing).toEqual([868, 869]);
    expect(result.extra).toEqual([]);
    expect(result.duplicates).toEqual([]);
  });

  it('flags every ref as extra when merged set is empty', () => {
    const result = classifyRefs([1, 2, 3], new Set());
    expect(result.missing).toEqual([]);
    expect(result.extra).toEqual([1, 2, 3]);
    expect(result.duplicates).toEqual([]);
  });
});

describe('findDuplicates', () => {
  it('returns an empty array when all refs are unique', () => {
    expect(findDuplicates([868, 869, 870])).toEqual([]);
  });

  it('returns the numbers that appear more than once, sorted ascending', () => {
    expect(findDuplicates([870, 869, 870, 868, 870, 869])).toEqual([869, 870]);
  });

  it('reports a number once regardless of how many times it repeats', () => {
    // 870 appears 4 times but is reported once in the result.
    expect(findDuplicates([870, 870, 870, 870])).toEqual([870]);
  });

  it('handles an empty input', () => {
    expect(findDuplicates([])).toEqual([]);
  });

  it('returns the sort in ascending order even when duplicates arrive in reverse', () => {
    expect(findDuplicates([999, 999, 1, 1])).toEqual([1, 999]);
  });
});
