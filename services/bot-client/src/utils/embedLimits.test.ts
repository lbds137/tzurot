import { describe, it, expect } from 'vitest';
import { clampEmbedText, EMBED_CAPS } from './embedLimits.js';

describe('clampEmbedText', () => {
  it('returns text at the cap unchanged', () => {
    const text = 'a'.repeat(100);
    expect(clampEmbedText(text, 100)).toBe(text);
  });

  it('clamps over-cap text to exactly the cap, ending in an ellipsis', () => {
    const clamped = clampEmbedText('a'.repeat(101), 100);
    expect(clamped).toHaveLength(100);
    expect(clamped.endsWith('\u2026')).toBe(true);
  });

  it('exposes the Discord caps the callers clamp against', () => {
    // Pins the numbers to the platform constants so a constant edit is a
    // conscious change here too.
    expect(EMBED_CAPS.title).toBe(256);
    expect(EMBED_CAPS.fieldValue).toBe(1024);
  });
});
