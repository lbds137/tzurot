import { describe, it, expect } from 'vitest';
import { derivePointerSets, compareConfigsForList } from './llmConfigListHelpers.js';

describe('derivePointerSets', () => {
  it('returns empty sets when the settings row is null', () => {
    const { globalDefaultIds, freeDefaultIds } = derivePointerSets(null);
    expect(globalDefaultIds.size).toBe(0);
    expect(freeDefaultIds.size).toBe(0);
  });

  it('collects chat + vision global pointers into globalDefaultIds (any-default)', () => {
    const { globalDefaultIds } = derivePointerSets({
      globalDefaultLlmConfigId: 'chat-global',
      globalDefaultVisionConfigId: 'vision-global',
      freeDefaultLlmConfigId: null,
      freeDefaultVisionConfigId: null,
    });
    expect([...globalDefaultIds].sort()).toEqual(['chat-global', 'vision-global']);
  });

  it('collects chat + vision free pointers into freeDefaultIds, dropping nulls', () => {
    const { globalDefaultIds, freeDefaultIds } = derivePointerSets({
      globalDefaultLlmConfigId: null,
      globalDefaultVisionConfigId: null,
      freeDefaultLlmConfigId: 'chat-free',
      freeDefaultVisionConfigId: null,
    });
    expect(globalDefaultIds.size).toBe(0);
    expect([...freeDefaultIds]).toEqual(['chat-free']);
  });
});

describe('compareConfigsForList', () => {
  const cfg = (over: Partial<Parameters<typeof compareConfigsForList>[0]> = {}) => ({
    isDefault: false,
    isFreeDefault: false,
    isGlobal: false,
    name: 'name',
    ...over,
  });

  it('floats the global default first, then free default, then global, then name', () => {
    const list = [
      cfg({ name: 'ZZZ', isDefault: true }),
      cfg({ name: 'plain-b' }),
      cfg({ name: 'AAA', isFreeDefault: true }),
      cfg({ name: 'plain-a', isGlobal: true }),
    ];
    const sorted = [...list].sort(compareConfigsForList).map(c => c.name);
    expect(sorted).toEqual(['ZZZ', 'AAA', 'plain-a', 'plain-b']);
  });

  it('breaks ties by name (locale-aware)', () => {
    const sorted = [cfg({ name: 'Beta' }), cfg({ name: 'alpha' })]
      .sort(compareConfigsForList)
      .map(c => c.name);
    expect(sorted).toEqual(['alpha', 'Beta']);
  });

  it('global-default wins when a config is also a free default', () => {
    // A config can occupy both pointer sets (global + free); isDefault short-
    // circuits first, so it still sorts ahead of a free-default-only config.
    const list = [
      cfg({ name: 'B', isFreeDefault: true }),
      cfg({ name: 'A', isDefault: true, isFreeDefault: true }),
    ];
    expect([...list].sort(compareConfigsForList).map(c => c.name)).toEqual(['A', 'B']);
  });
});
