import { describe, it, expect } from 'vitest';
import { findDuplicates } from './verify-notes.js';

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
