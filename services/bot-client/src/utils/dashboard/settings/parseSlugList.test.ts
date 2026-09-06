import { describe, it, expect } from 'vitest';
import { parseSlugList } from './parseSlugList.js';

describe('parseSlugList', () => {
  it('splits on comma, trims, drops empties, and dedupes preserving first-seen order', () => {
    expect(parseSlugList('a, b,,a')).toEqual(['a', 'b']);
  });

  it('returns an empty array for an empty string', () => {
    expect(parseSlugList('')).toEqual([]);
  });

  it('returns an empty array for whitespace-only input', () => {
    expect(parseSlugList('   ,  ,')).toEqual([]);
  });

  it('preserves a single entry with surrounding whitespace trimmed', () => {
    expect(parseSlugList('  nova  ')).toEqual(['nova']);
  });

  it('lowercases entries', () => {
    expect(parseSlugList('MyPersona, other')).toEqual(['mypersona', 'other']);
  });

  it('case-folds before deduping, so case variants collapse', () => {
    expect(parseSlugList('A, a')).toEqual(['a']);
  });
});
