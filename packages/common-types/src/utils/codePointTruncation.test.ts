/**
 * Tests for the two truncation strategies: a code-point display cap with no
 * hard ceiling, and a UTF-16-unit cap that satisfies discord.js's actual
 * validation boundary.
 */

import { describe, it, expect } from 'vitest';
import { truncateByCodePoints, truncateToUtf16Units } from './codePointTruncation.js';

describe('truncateByCodePoints', () => {
  it('caps by code point so astral emoji never split', () => {
    expect(truncateByCodePoints('abc', 5)).toBe('abc');
    expect(truncateByCodePoints('abcdef', 5)).toBe('abcde');
    // 4 ASCII + butterfly (astral): cap at 5 keeps the whole emoji...
    expect(truncateByCodePoints('abcd🦋ef', 5)).toBe('abcd🦋');
    // ...and cap at 4 drops it entirely rather than leaving half a pair.
    expect(truncateByCodePoints('abcd🦋ef', 4)).toBe('abcd');
    expect(truncateByCodePoints('abcd🦋ef', 4)).not.toContain('�');
  });

  it('appends the suffix only when truncation actually happens', () => {
    expect(truncateByCodePoints('abc', 5, '…')).toBe('abc');
    expect(truncateByCodePoints('abcdef', 5, '…')).toBe('abcde…');
  });

  it('does not count the suffix against maxCodePoints', () => {
    const result = truncateByCodePoints('abcdef', 3, '…');
    expect(result).toBe('abc…');
    // The suffix rides on top of the cap rather than eating into it.
    expect([...result.slice(0, -1)].length).toBe(3);
  });
});

describe('truncateToUtf16Units', () => {
  it('returns the value unchanged when already within the unit cap', () => {
    expect(truncateToUtf16Units('abcdef', 10)).toBe('abcdef');
    expect(truncateToUtf16Units('abcdef', 6)).toBe('abcdef');
  });

  it('charges the suffix against the cap', () => {
    const result = truncateToUtf16Units('abcdefghij', 5, '...');
    expect(result).toBe('ab...');
    expect(result.length).toBe(5);
  });

  it('returns empty when the budget cannot fit the suffix alone', () => {
    // 1 unit of budget, 3 units of suffix: emitting the suffix would blow
    // the ceiling, so the empty string is the only in-budget result.
    expect(truncateToUtf16Units('abcdef', 1, '...')).toBe('');
  });

  it('returns just the suffix when the budget exactly equals it', () => {
    expect(truncateToUtf16Units('abcdef', 3, '...')).toBe('...');
  });

  it('canary A: never leaves an unpaired surrogate when the raw cut lands mid-pair', () => {
    // 97 ASCII units + 5 butterflies (10 units) = 107 units. A raw cut at
    // 100 lands 97 ASCII + one whole butterfly (units 97-98) + the HIGH
    // surrogate of the next butterfly at unit 99 — mid-pair.
    const value = 'a'.repeat(97) + '🦋'.repeat(5);
    expect(value.length).toBe(107);
    const result = truncateToUtf16Units(value, 100, '');

    expect(result.length).toBeLessThanOrEqual(100);
    // No unpaired high surrogate (a high surrogate not followed by a low one).
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(result)).toBe(false);
    // No unpaired low surrogate (a low surrogate not preceded by a high one).
    expect(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(result)).toBe(false);
    // Pins the back-off actually firing: without it, the raw cut (100 units)
    // would include the dangling high surrogate.
    expect(result.length).toBe(99);
  });

  it('canary B: stays within the UTF-16 ceiling for an all-astral string', () => {
    // 60 butterflies = 120 units. A code-point cut at 100 would return 100
    // code points = 200 units, blowing straight through the ceiling.
    const value = '🦋'.repeat(60);
    const result = truncateToUtf16Units(value, 100, '...');

    expect(result.length).toBeLessThanOrEqual(100);
  });
});
