/**
 * Tests for legacyLocationSpans
 */

import { describe, it, expect } from 'vitest';
import { stripLegacyLocationSpans } from './legacyLocationSpans.js';

describe('stripLegacyLocationSpans', () => {
  const LEGACY_PROD_SPAN =
    '<location>This conversation is taking place in a Discord server:\n' +
    '**Server**: The Rose | השושנה\n' +
    '**Category**: Diaries\n' +
    '**Channel**: #diaries-2025 (forum)\n' +
    '**Thread**: 2025-12-30</location>\n' +
    '<time absolute="Tue, Dec 30, 2025" relative="12 minutes ago"/>';

  it('removes the wrapped legacy span and leaves the <time .../> marker and trailing text intact', () => {
    const result = stripLegacyLocationSpans(`${LEGACY_PROD_SPAN}\nActual memory text.`);

    expect(result).not.toContain('<location>');
    expect(result).not.toContain('taking place');
    expect(result).toContain('<time absolute="Tue, Dec 30, 2025" relative="12 minutes ago"/>');
    expect(result).toContain('Actual memory text.');
  });

  it('converts an unwrapped present-tense variant to past tense', () => {
    const result = stripLegacyLocationSpans('This conversation is taking place in #x');

    expect(result).toBe('This conversation took place in #x');
  });

  it('passes content with no legacy span through byte-identical', () => {
    const content = 'Just a normal memory with no location preamble.';

    expect(stripLegacyLocationSpans(content)).toBe(content);
  });
});
