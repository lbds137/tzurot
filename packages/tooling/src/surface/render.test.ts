import { describe, expect, it } from 'vitest';

import { renderJson, renderMarkdownOutput, renderTerminal } from './render.js';
import { SURFACE_CATEGORIES, type SurfaceInventory } from './types.js';

function inventory(overrides: Partial<SurfaceInventory>): SurfaceInventory {
  return { entries: [], totalSites: 0, elapsedMs: 12.4, ...overrides };
}

describe('renderTerminal', () => {
  it('lists every category, including empty ones', () => {
    const output = renderTerminal(
      inventory({
        entries: [{ category: 'unclassified', file: 'src/a.ts', symbol: 'Mystery', count: 1 }],
        totalSites: 1,
      })
    );
    for (const category of SURFACE_CATEGORIES) {
      expect(output).toContain(`${category}: `);
    }
    expect(output).toContain('client-methods: 0 entries / 0 sites');
    expect(output).toContain('unclassified: 1 entries / 1 sites');
    expect(output).toContain('src/a.ts Mystery 1');
  });

  it('includes the totals and elapsed line', () => {
    const output = renderTerminal(inventory({ elapsedMs: 1234.6 }));
    expect(output).toContain('Total: 0 entries across 0 sites in 1235 ms.');
  });
});

describe('renderJson', () => {
  it('parses and carries elapsedMs at top level', () => {
    const doc = JSON.parse(
      renderJson(
        inventory({
          entries: [{ category: 'flags', file: 'src/a.ts', symbol: 'Ephemeral', count: 2 }],
          totalSites: 2,
        })
      )
    ) as { totals: { entries: number; sites: number }; elapsedMs: number; entries: unknown[] };
    expect(doc.totals).toEqual({ entries: 1, sites: 2 });
    expect(doc.elapsedMs).toBe(12.4);
    expect(doc.entries).toHaveLength(1);
  });
});

describe('renderMarkdownOutput', () => {
  it('renders the snapshot markdown form', () => {
    const output = renderMarkdownOutput(
      inventory({
        entries: [{ category: 'flags', file: 'src/a.ts', symbol: 'Ephemeral', count: 2 }],
        totalSites: 2,
      })
    );
    expect(output).toContain('# bot-client discord.js surface snapshot');
    expect(output).toContain('| src/a.ts | Ephemeral | 2 |');
  });
});
