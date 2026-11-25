import { describe, expect, it } from 'vitest';

import { OPENROUTER_ROUTING } from '@tzurot/common-types/constants/openrouterRouting';
import { resolveOpenRouterProviderRouting } from './providerRouting.js';

describe('resolveOpenRouterProviderRouting', () => {
  it('the pinned id returns the only-shape with fallbacks disabled', () => {
    const routing = resolveOpenRouterProviderRouting('z-ai/glm-5.3-flash');
    expect(routing).toEqual({
      only: [...OPENROUTER_ROUTING.PINNED_MODELS['z-ai/glm-5.3-flash']],
      allow_fallbacks: false,
      data_collection: 'deny',
    });
    expect(routing.only).toHaveLength(30);
    expect(routing.ignore).toBeUndefined();
  });

  it.each([
    'z-ai/glm-5.4',
    'z-ai/glm-5.3-flash:free',
    'openrouter/free',
    'openrouter/auto',
    'minimax/minimax-m3',
    'anthropic/claude-haiku-4.5',
    'constructor',
    '__proto__',
  ])('%s (unpinned) returns the ignore shape', modelId => {
    const routing = resolveOpenRouterProviderRouting(modelId);
    expect(routing).toEqual({
      ignore: [...OPENROUTER_ROUTING.FORWARDER_IGNORE],
      data_collection: 'deny',
    });
    expect(routing.only).toBeUndefined();
    expect(routing.allow_fallbacks).toBeUndefined();
  });

  it('a suffixed variant of the pinned id never exact-matches', () => {
    // The pin is EXACT-id: `:free` is a different catalog entry with different
    // hosts, so it must take the ignore shape, not the measured allowlist.
    const pinned = resolveOpenRouterProviderRouting('z-ai/glm-5.3-flash');
    const suffixed = resolveOpenRouterProviderRouting('z-ai/glm-5.3-flash:free');
    expect(suffixed.only).toBeUndefined();
    expect(suffixed.ignore).toEqual(pinned.ignore ?? [...OPENROUTER_ROUTING.FORWARDER_IGNORE]);
  });

  it('returns fresh arrays per call — mutating one result leaves the next call intact', () => {
    const first = resolveOpenRouterProviderRouting('z-ai/glm-5.3-flash');
    (first.only as string[]).push('injected-host');
    first.ignore = undefined;

    const second = resolveOpenRouterProviderRouting('z-ai/glm-5.3-flash');
    expect(second.only).toEqual([...OPENROUTER_ROUTING.PINNED_MODELS['z-ai/glm-5.3-flash']]);
    expect(second.only).not.toContain('injected-host');
    expect(second.only).not.toBe(OPENROUTER_ROUTING.PINNED_MODELS['z-ai/glm-5.3-flash']);

    const firstIgnore = resolveOpenRouterProviderRouting('openrouter/auto');
    (firstIgnore.ignore as string[]).push('injected-host');
    const secondIgnore = resolveOpenRouterProviderRouting('openrouter/auto');
    expect(secondIgnore.ignore).toEqual([...OPENROUTER_ROUTING.FORWARDER_IGNORE]);
    expect(secondIgnore.ignore).not.toContain('injected-host');
    expect(secondIgnore.ignore).not.toBe(OPENROUTER_ROUTING.FORWARDER_IGNORE);
  });
});
