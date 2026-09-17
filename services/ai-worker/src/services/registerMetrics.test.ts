import { describe, it, expect } from 'vitest';
import { exclamationsPer1kChars } from './registerMetrics.js';

describe('exclamationsPer1kChars', () => {
  it('counts `!` characters mid-sentence and at word ends, per 1000 chars', () => {
    // "Oh! That is amazing! Tell me more please!" — 41 chars, 3 `!` chars,
    // two of them mid-string ("Oh!", "amazing!") and one at the very end.
    const text = 'Oh! That is amazing! Tell me more please!';
    expect(text.length).toBe(41);

    // 3 * 1000 / 41 = 73.170731... -> rounds to 73.17
    expect(exclamationsPer1kChars(text)).toBe(73.17);
  });

  it('counts every character in a `!` run individually, not the run once', () => {
    // "Hi!!" — 4 chars, 2 `!` chars (an unbroken run).
    const text = 'Hi!!';
    expect(text.length).toBe(4);

    // 2 * 1000 / 4 = 500
    expect(exclamationsPer1kChars(text)).toBe(500);
  });

  it('returns 0, not NaN, for empty text', () => {
    expect(exclamationsPer1kChars('')).toBe(0);
  });
});
