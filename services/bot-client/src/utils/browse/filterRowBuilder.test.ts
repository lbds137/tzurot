/**
 * Tests for the in-place filter toggle builder.
 */

import { describe, it, expect } from 'vitest';
import { ButtonStyle } from 'discord.js';
import { buildFilterToggleButton, nextFilter } from './filterRowBuilder.js';

const FILTERS = ['all', 'mine', 'global'] as const;
type Filter = (typeof FILTERS)[number];

const DISPLAY = {
  all: { label: 'Filter: All', shortLabel: 'All', emoji: '📋' },
  mine: { label: 'Filter: Mine', shortLabel: 'Mine', emoji: '🔒' },
  global: { label: 'Filter: Global', shortLabel: 'Global', emoji: '🌐' },
} as const;

function buildCustomId(page: number, filter: Filter, _sort: string, query: string | null): string {
  return `x::browse::${page}::${filter}::${query ?? ''}`;
}

describe('nextFilter', () => {
  it('cycles through the list and wraps', () => {
    expect(nextFilter(FILTERS, 'all')).toBe('mine');
    expect(nextFilter(FILTERS, 'mine')).toBe('global');
    expect(nextFilter(FILTERS, 'global')).toBe('all');
  });
});

describe('buildFilterToggleButton', () => {
  it('targets the NEXT filter with page reset to 0 and preserved query', () => {
    const button = buildFilterToggleButton({
      filters: FILTERS,
      display: DISPLAY,
      current: 'all',
      buildCustomId,
      query: 'some-slug',
    }).toJSON() as { custom_id: string; label: string; style: number };

    // Page 0 (a narrower filter renumbers the list), filter advanced, query kept.
    expect(button.custom_id).toBe('x::browse::0::mine::some-slug');
    expect(button.label).toBe('Filter: Mine');
    expect(button.style).toBe(ButtonStyle.Primary);
  });

  it("labels with the TARGET filter's display, not the current one", () => {
    const button = buildFilterToggleButton({
      filters: FILTERS,
      display: DISPLAY,
      current: 'global',
      buildCustomId,
      query: null,
    }).toJSON() as { custom_id: string; label: string };

    expect(button.custom_id).toBe('x::browse::0::all::');
    expect(button.label).toBe('Filter: All');
  });
});
