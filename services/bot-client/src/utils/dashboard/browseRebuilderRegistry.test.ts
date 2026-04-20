import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
import type { BrowseContext } from './types.js';
import {
  registerBrowseRebuilder,
  getBrowseRebuilder,
  clearBrowseRegistry,
  type BrowseRebuilder,
} from './browseRebuilderRegistry.js';

const noopInteraction = {} as ButtonInteraction;
const noopContext: BrowseContext = { source: 'browse', page: 0, filter: 'all' };

function makeRebuilder(): BrowseRebuilder {
  return vi.fn(async () => ({ content: 'banner', embeds: [], components: [] }));
}

describe('browseRebuilderRegistry', () => {
  beforeEach(() => {
    clearBrowseRegistry();
  });

  it('returns undefined for unregistered entity types', () => {
    expect(getBrowseRebuilder('preset')).toBeUndefined();
  });

  it('registers and retrieves a rebuilder', async () => {
    const rebuilder = makeRebuilder();
    registerBrowseRebuilder('preset', rebuilder);

    const looked = getBrowseRebuilder('preset');
    expect(looked).toBe(rebuilder);

    // Sanity: the registered function is actually callable.
    await looked?.(noopInteraction, noopContext, 'banner');
    expect(rebuilder).toHaveBeenCalledWith(noopInteraction, noopContext, 'banner');
  });

  it('is idempotent for the same function reference', () => {
    const rebuilder = makeRebuilder();
    registerBrowseRebuilder('character', rebuilder);
    expect(() => registerBrowseRebuilder('character', rebuilder)).not.toThrow();
    expect(getBrowseRebuilder('character')).toBe(rebuilder);
  });

  it('throws when registering a different function for the same entity type', () => {
    registerBrowseRebuilder('persona', makeRebuilder());
    expect(() => registerBrowseRebuilder('persona', makeRebuilder())).toThrow(
      /BrowseRebuilder conflict for entity type "persona"/
    );
  });

  it('supports independent registration for each entity type', () => {
    const preset = makeRebuilder();
    const character = makeRebuilder();
    const persona = makeRebuilder();
    const deny = makeRebuilder();

    registerBrowseRebuilder('preset', preset);
    registerBrowseRebuilder('character', character);
    registerBrowseRebuilder('persona', persona);
    registerBrowseRebuilder('deny', deny);

    expect(getBrowseRebuilder('preset')).toBe(preset);
    expect(getBrowseRebuilder('character')).toBe(character);
    expect(getBrowseRebuilder('persona')).toBe(persona);
    expect(getBrowseRebuilder('deny')).toBe(deny);
  });

  it('clearBrowseRegistry removes all registered rebuilders', () => {
    registerBrowseRebuilder('preset', makeRebuilder());
    registerBrowseRebuilder('deny', makeRebuilder());
    clearBrowseRegistry();
    expect(getBrowseRebuilder('preset')).toBeUndefined();
    expect(getBrowseRebuilder('deny')).toBeUndefined();
  });
});
