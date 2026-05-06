/**
 * Tests for the truncation-gate embed builders + label helpers.
 */

import { describe, it, expect } from 'vitest';
import {
  buildTruncationWarningEmbed,
  buildReadyToEditEmbed,
  stripLeadingEmoji,
  toSafeFilename,
} from './embeds.js';

describe('stripLeadingEmoji', () => {
  it('removes a leading emoji + whitespace', () => {
    expect(stripLeadingEmoji('🏷️ Identity & Basics')).toBe('Identity & Basics');
  });

  it('returns the input unchanged when there is no leading emoji', () => {
    expect(stripLeadingEmoji('Identity & Basics')).toBe('Identity & Basics');
  });
});

describe('toSafeFilename', () => {
  it('lowercases, trims, and underscores whitespace', () => {
    expect(toSafeFilename('Personality Age')).toBe('personality_age');
  });

  it('strips non-alphanumeric characters and collapses underscore runs', () => {
    // Without the collapse pass this would produce 'bots_tone__style'
    // (where `& ` becomes `&_`, then `&` is stripped). The trailing
    // `.replace(/_+/g, '_')` keeps filenames clean.
    expect(toSafeFilename("Bot's Tone & Style")).toBe('bots_tone_style');
  });

  it('falls back to "field" when slug would be empty', () => {
    // Pure-punctuation input slugs to empty string after stripping.
    // The fallback prevents producing `.txt` as the attachment name.
    expect(toSafeFilename('!!!')).toBe('field');
    expect(toSafeFilename('   ')).toBe('field');
  });
});

describe('buildTruncationWarningEmbed', () => {
  it('includes per-field char counts and the total truncation amount', () => {
    const embed = buildTruncationWarningEmbed(
      [
        { fieldId: 'personalityAge', label: 'Age', current: 150, max: 100 },
        { fieldId: 'personalityTraits', label: 'Traits', current: 1500, max: 1000 },
      ],
      '🏷️ Identity & Basics'
    );

    const json = embed.toJSON();
    expect(json.title).toContain('"Identity & Basics"');
    expect(json.description).toContain('Age');
    expect(json.description).toContain('150');
    expect(json.description).toContain('100');
    expect(json.description).toContain('Traits');
    expect(json.description).toContain('1,500');
    // Footer lists total truncation: (150-100)+(1500-1000)=550
    expect(json.footer?.text).toContain('550');
    expect(json.footer?.text).toContain('2 fields');
    expect(json.footer?.text).not.toContain('field(s)');
  });

  it('uses singular "field" in the footer when only one field is over-length', () => {
    // Guards against the "1 field(s)" pluralization regression flagged in PR
    // review. The single-field path is the common case for short legacy
    // fields and needs to read cleanly.
    const embed = buildTruncationWarningEmbed(
      [{ fieldId: 'personalityAge', label: 'Age', current: 150, max: 100 }],
      '🏷️ Identity & Basics'
    );
    const json = embed.toJSON();
    expect(json.footer?.text).toContain('1 field');
    expect(json.footer?.text).not.toContain('1 fields');
    expect(json.footer?.text).not.toContain('field(s)');
  });
});

describe('buildReadyToEditEmbed', () => {
  it('strips the leading emoji and names the section in the title', () => {
    const embed = buildReadyToEditEmbed('🏷️ Identity & Basics');
    const json = embed.toJSON();
    expect(json.title).toContain('Identity & Basics');
    expect(json.title).not.toContain('🏷️');
  });
});
