import { describe, it, expect } from 'vitest';
import {
  ENTITY_EMOJI,
  UX_SENTINELS,
  BADGE_LEGEND_WORDS,
  entityTitle,
  buildBadgeLegend,
} from './uxVocabulary.js';
import { AUTOCOMPLETE_BADGES } from '../utils/autocompleteFormat.js';

describe('the §2.2 collision rule — no glyph serves two registers', () => {
  it('no glyph is both an entity emoji and a badge', () => {
    const entityGlyphs = new Set(Object.values(ENTITY_EMOJI));
    const collisions = Object.entries(AUTOCOMPLETE_BADGES).filter(([, glyph]) =>
      entityGlyphs.has(glyph)
    );
    expect(collisions).toEqual([]);
  });

  it('entity glyphs are unique within the entity register', () => {
    const glyphs = Object.values(ENTITY_EMOJI);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it('badge glyphs are unique except the documented GLOBAL/PUBLIC same-concept pair', () => {
    const seen = new Map<string, string[]>();
    for (const [key, glyph] of Object.entries(AUTOCOMPLETE_BADGES)) {
      seen.set(glyph, [...(seen.get(glyph) ?? []), key]);
    }
    const duplicates = [...seen.values()].filter(keys => keys.length > 1);
    // 🌐 deliberately backs both GLOBAL and PUBLIC — one "everyone" concept
    // surfacing under two naming contexts. Any OTHER duplicate is a collision.
    expect(duplicates).toEqual([['GLOBAL', 'PUBLIC']]);
  });

  it('every badge has a legend word', () => {
    // The Record type enforces this at compile time; the runtime pin catches
    // a drift where the badge registry gains a key via a cast or spread.
    for (const key of Object.keys(AUTOCOMPLETE_BADGES)) {
      expect(BADGE_LEGEND_WORDS[key as keyof typeof BADGE_LEGEND_WORDS]).toBeTruthy();
    }
  });
});

describe('entityTitle', () => {
  it('prefixes the entity glyph per the §2.1 title grammar', () => {
    expect(entityTitle('character', 'Characters')).toBe('🎭 Characters');
    expect(entityTitle('apiKey', 'API Keys')).toBe('💳 API Keys');
    expect(entityTitle('character', 'Editing: Lilith')).toBe('🎭 Editing: Lilith');
  });
});

describe('buildBadgeLegend', () => {
  it('renders word-first segments joined by the middle dot', () => {
    expect(buildBadgeLegend(['OWNED', 'LOCKED'])).toBe('Private 🔒 · Locked 🔐');
  });

  it('maps GLOBAL and PUBLIC to the same legend word', () => {
    expect(buildBadgeLegend(['GLOBAL'])).toBe('Public 🌐');
    expect(buildBadgeLegend(['PUBLIC'])).toBe('Public 🌐');
  });

  it('preserves caller order and handles the empty list', () => {
    expect(buildBadgeLegend(['ACTIVE', 'FREE'])).toBe('Active ✅ · Free 🆓');
    expect(buildBadgeLegend([])).toBe('');
  });

  it('accepts surface-specific word overrides while the glyph stays registry-locked', () => {
    expect(
      buildBadgeLegend([
        { key: 'GLOBAL', word: 'Global' },
        { key: 'OWNED', word: 'Personal' },
        'SHADOWED',
      ])
    ).toBe('Global 🌐 · Personal 🔒 · Shadowed ⚠️');
  });

  it('object entries without a word fall back to the standard legend word', () => {
    expect(buildBadgeLegend([{ key: 'LOCKED' }])).toBe('Locked 🔐');
  });

  it('appends an entry suffix after the glyph (live-count annotations)', () => {
    expect(buildBadgeLegend([{ key: 'VISION', suffix: '(3)' }, 'FREE'])).toBe(
      'Vision 👁️ (3) · Free 🆓'
    );
    expect(buildBadgeLegend([{ key: 'FREE', word: 'Free tier', suffix: '(2)' }])).toBe(
      'Free tier 🆓 (2)'
    );
  });
});

describe('UX_SENTINELS', () => {
  it('pins the sanctioned sentinel strings', () => {
    expect(UX_SENTINELS.NOT_SET).toBe('_Not set_');
    expect(UX_SENTINELS.NEVER).toBe('Never');
  });
});
