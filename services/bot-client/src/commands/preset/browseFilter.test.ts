/**
 * Tests for the preset browse `scope.kind` composite filter encoding.
 */

import { describe, it, expect } from 'vitest';
import {
  composeBrowseFilter,
  describeFilter,
  splitBrowseFilter,
  VALID_PRESET_FILTERS,
  filterPresets,
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
      capability: 'text',
    });
  });

  it('decodes each axis independently', () => {
    expect(splitBrowseFilter('free.vision')).toEqual({ scope: 'free', capability: 'vision' });
  });

  it('defends the exported boundary: a token with no capability segment defaults to all', () => {
    // The customId factory pre-validates, so production never passes a bare
    // token here — but if a malformed/future-format one ever did, the missing
    // capability must default to "all", NOT the gateway's text default.
    expect(splitBrowseFilter('global' as never)).toEqual({ scope: 'global', capability: 'all' });
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
      const { scope, capability } = splitBrowseFilter(filter);
      expect(composeBrowseFilter(scope, capability)).toBe(filter);
    }
  });
});

describe('describeFilter', () => {
  it('returns null when neither axis is narrowed', () => {
    expect(describeFilter('all', 'all')).toBeNull();
  });

  it('labels a single narrowed axis', () => {
    expect(describeFilter('global', 'all')).toBe('Global Only');
    expect(describeFilter('all', 'vision')).toBe('Vision-capable Models');
  });

  it('joins both axes with a middot when both are narrowed', () => {
    expect(describeFilter('mine', 'text')).toBe('My Presets · Text-only Models');
  });
});

describe('filterPresets', () => {
  const presets = [
    {
      name: 'GlobalVision',
      model: 'x/model-a',
      isGlobal: true,
      isOwned: false,
      supportsVision: true,
    },
    { name: 'MineText', model: 'x/model-b', isGlobal: false, isOwned: true, supportsVision: false },
  ] as never[];

  it('narrows by scope and capability independently', () => {
    expect(filterPresets(presets, 'global', 'all', null, false)).toHaveLength(1);
    expect(filterPresets(presets, 'all', 'vision', null, false)).toHaveLength(1);
    expect(filterPresets(presets, 'mine', 'text', null, false)).toHaveLength(1);
    expect(filterPresets(presets, 'global', 'text', null, false)).toHaveLength(0);
  });

  it('applies the search query over name and model', () => {
    expect(filterPresets(presets, 'all', 'all', 'minetext', false)).toHaveLength(1);
    expect(filterPresets(presets, 'all', 'all', 'model-', false)).toHaveLength(2);
  });
});
