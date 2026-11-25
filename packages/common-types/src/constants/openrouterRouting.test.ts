import { describe, expect, it } from 'vitest';

import { OPENROUTER_ROUTING } from './openrouterRouting.js';

describe('OPENROUTER_ROUTING', () => {
  it('the GLM allowlist has exactly 30 unique host slugs', () => {
    const allowlist = OPENROUTER_ROUTING.PINNED_MODELS['z-ai/glm-5.3-flash'];
    expect(allowlist).toHaveLength(30);
    expect(new Set(allowlist).size).toBe(30);
  });

  it('FORWARDER_IGNORE has unique entries and no overlap with the allowlist', () => {
    const ignore = OPENROUTER_ROUTING.FORWARDER_IGNORE;
    expect(new Set(ignore).size).toBe(ignore.length);
    const allowlist = new Set<string>(OPENROUTER_ROUTING.PINNED_MODELS['z-ai/glm-5.3-flash']);
    for (const slug of ignore) {
      expect(allowlist.has(slug)).toBe(false);
    }
  });
});
