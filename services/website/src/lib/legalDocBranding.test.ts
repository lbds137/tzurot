import { describe, it, expect } from 'vitest';
import { renderLegalDocument } from './legalDocBranding.js';

const DOC = `# Tzurot Terms

Tzurot is a bot. See [Privacy](https://tzurot.org/privacy) and
[issues](https://github.com/lbds137/tzurot/issues).

| Data | Kept |
| ---- | ---- |
| Foo  | 30d  |
`;

describe('renderLegalDocument', () => {
  it('substitutes capitalized prose but never lowercase URLs', async () => {
    const html = await renderLegalDocument(DOC, 'Rotzot', true);

    expect(html).toContain('Rotzot Terms');
    expect(html).toContain('Rotzot is a bot');
    // URLs untouched — the case-sensitivity invariant.
    expect(html).toContain('https://tzurot.org/privacy');
    expect(html).toContain('github.com/lbds137/tzurot/issues');
    expect(html).not.toMatch(/Tzurot(?!\.org)/);
  });

  it('renders verbatim when substitution is off (canonical brand)', async () => {
    const html = await renderLegalDocument(DOC, 'Tzurot', false);

    expect(html).toContain('Tzurot Terms');
    expect(html).not.toContain('Rotzot');
  });

  it('renders GFM tables and typographic quotes', async () => {
    const html = await renderLegalDocument('| A | B |\n| - | - |\n| "x" | 1 |', 'Tzurot', false);

    expect(html).toContain('<table>');
    // smartypants emits curly quotes as numeric HTML entities, not raw
    // Unicode characters — the assertion matches that representation.
    expect(html).toContain('&#8220;x&#8221;');
  });

  it('is stable across repeated calls (no hook re-registration)', async () => {
    // The bug class this module exists to prevent: configuring the shared
    // marked singleton per render duplicated the smartypants hook.
    const input = 'It "quotes" things -- twice';
    const first = await renderLegalDocument(input, 'Tzurot', false);
    const second = await renderLegalDocument(input, 'Tzurot', false);

    expect(second).toBe(first);
  });

  it('rejects a capitalized URL before substitution can corrupt it', async () => {
    await expect(renderLegalDocument('Visit Tzurot.org today', 'Rotzot', true)).rejects.toThrow(
      'must write URLs in lowercase'
    );
  });

  it('rejects post-substitution lowercase prose "tzurot" outside known URLs', async () => {
    await expect(renderLegalDocument('the tzurot service', 'Rotzot', true)).rejects.toThrow(
      'outside the known documentation URLs'
    );
  });

  it('accepts both documentation URLs even adjacent to punctuation', async () => {
    // The strip-then-check must not false-positive on the real URL shapes.
    const doc = 'See https://tzurot.org/privacy, or github.com/lbds137/tzurot/issues.';
    await expect(renderLegalDocument(doc, 'Rotzot', true)).resolves.toContain('tzurot.org/privacy');
  });
});
