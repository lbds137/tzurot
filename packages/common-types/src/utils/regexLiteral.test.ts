import { describe, it, expect } from 'vitest';
import { escapeRegExpLiteral } from './regexLiteral.js';

describe('escapeRegExpLiteral', () => {
  it('escapes regex metacharacters so a literal match no longer matches an unescaped shape', () => {
    const pattern = new RegExp(escapeRegExpLiteral('a.b'));
    expect(pattern.test('a.b')).toBe(true);
    expect(pattern.test('axb')).toBe(false);
  });

  it('escapes the full handled metacharacter set into a valid u-flag pattern matching it literally', () => {
    const literal = '.*+?^${}()|[]\\/';
    const pattern = new RegExp(`^${escapeRegExpLiteral(literal)}$`, 'u');
    expect(pattern.test(literal)).toBe(true);
    expect(pattern.test('x')).toBe(false);
  });
});
