import { describe, it, expect } from 'vitest';
import { cappedInlineField, clampEmbedText, EMBED_CAPS } from './embedLimits.js';

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

  it('never cuts inside a surrogate pair at the boundary', () => {
    // An astral character (2 UTF-16 units) straddling the cut would leave a
    // lone surrogate before the ellipsis — a broken glyph.
    const text = 'a'.repeat(98) + '\u{1F600}\u{1F600}'; // length 102
    const clamped = clampEmbedText(text, 100);
    expect(clamped.length).toBeLessThanOrEqual(100);
    for (let i = 0; i < clamped.length; i++) {
      const code = clamped.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        // A high surrogate must be followed by a low surrogate.
        const next = clamped.charCodeAt(i + 1);
        expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
      }
    }
  });

  it('returns empty for a non-positive cap instead of wrapping the slice', () => {
    expect(clampEmbedText('anything', 0)).toBe('');
    expect(clampEmbedText('anything', -5)).toBe('');
    expect(clampEmbedText('anything', 1)).toBe('\u2026');
  });

  it('cappedInlineField clamps BOTH halves at their platform caps', () => {
    // The helper is the no-opt-out safety net, so the name must not be the
    // one part that can still throw. Schema caps keep command fixtures under
    // the limits, so the engagement is pinned here at the helper itself.
    const field = cappedInlineField('n'.repeat(300), 'v'.repeat(1100));
    expect(field.name.length).toBe(256);
    expect(field.value.length).toBe(1024);
    expect(field.inline).toBe(true);
  });

  it('exposes the Discord caps the callers clamp against', () => {
    // Pins the numbers to the platform constants so a constant edit is a
    // conscious change here too.
    expect(EMBED_CAPS.title).toBe(256);
    expect(EMBED_CAPS.fieldValue).toBe(1024);
  });
});
