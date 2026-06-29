/**
 * Tests for the preset browse `scope.kind` composite filter encoding.
 */

import { describe, it, expect } from 'vitest';
import {
  composeBrowseFilter,
  describeFilter,
  splitBrowseFilter,
  VALID_PRESET_FILTERS,
} from './browseFilter.js';

describe('composeBrowseFilter', () => {
  it('packs scope + kind into a dotted token', () => {
    expect(composeBrowseFilter('global', 'vision')).toBe('global.vision');
    expect(composeBrowseFilter('all', 'all')).toBe('all.all');
  });
});

describe('splitBrowseFilter', () => {
  it('round-trips a composed token', () => {
    expect(splitBrowseFilter(composeBrowseFilter('mine', 'text'))).toEqual({
      scope: 'mine',
      kind: 'text',
    });
  });

  it('decodes each axis independently', () => {
    expect(splitBrowseFilter('free.vision')).toEqual({ scope: 'free', kind: 'vision' });
  });

  it('defends the exported boundary: a token with no kind segment defaults to all-kinds', () => {
    // The customId factory pre-validates, so production never passes a bare
    // token here — but if a malformed/future-format one ever did, the missing
    // kind must default to "all kinds", NOT the gateway's text default.
    expect(splitBrowseFilter('global' as never)).toEqual({ scope: 'global', kind: 'all' });
  });
});

describe('VALID_PRESET_FILTERS', () => {
  it('is the full scope×kind cartesian product (4 × 3 = 12)', () => {
    expect(VALID_PRESET_FILTERS).toHaveLength(12);
    expect(VALID_PRESET_FILTERS).toContain('all.all');
    expect(VALID_PRESET_FILTERS).toContain('global.vision');
    expect(VALID_PRESET_FILTERS).toContain('free.text');
    // No duplicates.
    expect(new Set(VALID_PRESET_FILTERS).size).toBe(VALID_PRESET_FILTERS.length);
  });

  it('every entry round-trips through split → compose', () => {
    for (const filter of VALID_PRESET_FILTERS) {
      const { scope, kind } = splitBrowseFilter(filter);
      expect(composeBrowseFilter(scope, kind)).toBe(filter);
    }
  });
});

describe('describeFilter', () => {
  it('returns null when neither axis is narrowed', () => {
    expect(describeFilter('all', 'all')).toBeNull();
  });

  it('labels a single narrowed axis', () => {
    expect(describeFilter('global', 'all')).toBe('Global Only');
    expect(describeFilter('all', 'vision')).toBe('Vision Only');
  });

  it('joins both axes with a middot when both are narrowed', () => {
    expect(describeFilter('mine', 'text')).toBe('My Presets · Text Only');
  });
});
