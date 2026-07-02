/**
 * Tests for the TTS list-shaping helpers: pointer normalization, flag
 * decoration, and defaults-first ordering. Pure functions — no mocks.
 */

import { describe, it, expect } from 'vitest';
import {
  deriveTtsDefaultPointers,
  decorateTtsConfigWithDefaultFlags,
  compareTtsConfigsForList,
} from './ttsConfigListHelpers.js';

describe('deriveTtsDefaultPointers', () => {
  it('normalizes a missing AdminSettings row to null pointers', () => {
    expect(deriveTtsDefaultPointers(null)).toEqual({
      globalDefaultId: null,
      freeDefaultId: null,
    });
  });

  it('passes through set pointers and nulls independently', () => {
    expect(
      deriveTtsDefaultPointers({ globalDefaultTtsConfigId: 'g1', freeDefaultTtsConfigId: null })
    ).toEqual({ globalDefaultId: 'g1', freeDefaultId: null });
  });
});

describe('decorateTtsConfigWithDefaultFlags', () => {
  const pointers = { globalDefaultId: 'g1', freeDefaultId: 'f1' };

  it('marks the pointed-at rows and leaves others false', () => {
    expect(decorateTtsConfigWithDefaultFlags({ id: 'g1' }, pointers)).toMatchObject({
      isDefault: true,
      isFreeDefault: false,
    });
    expect(decorateTtsConfigWithDefaultFlags({ id: 'f1' }, pointers)).toMatchObject({
      isDefault: false,
      isFreeDefault: true,
    });
    expect(decorateTtsConfigWithDefaultFlags({ id: 'other' }, pointers)).toMatchObject({
      isDefault: false,
      isFreeDefault: false,
    });
  });

  it('marks both flags when one config holds both pointers (fresh-install bootstrap shape)', () => {
    const both = { globalDefaultId: 'k1', freeDefaultId: 'k1' };
    expect(decorateTtsConfigWithDefaultFlags({ id: 'k1' }, both)).toMatchObject({
      isDefault: true,
      isFreeDefault: true,
    });
  });

  it('yields all-false flags when no pointers are set (pointer set but row missing case)', () => {
    const none = { globalDefaultId: null, freeDefaultId: null };
    expect(decorateTtsConfigWithDefaultFlags({ id: 'x' }, none)).toMatchObject({
      isDefault: false,
      isFreeDefault: false,
    });
  });
});

describe('compareTtsConfigsForList', () => {
  const base = { isDefault: false, isFreeDefault: false, isGlobal: true };

  it('orders global default → free default → globals → name', () => {
    const rows = [
      { ...base, name: 'zeta' },
      { ...base, name: 'alpha', isGlobal: false },
      { ...base, name: 'free', isFreeDefault: true },
      { ...base, name: 'default', isDefault: true },
      { ...base, name: 'beta' },
    ];
    const sorted = [...rows].sort(compareTtsConfigsForList);
    expect(sorted.map(r => r.name)).toEqual(['default', 'free', 'beta', 'zeta', 'alpha']);
  });
});
