/**
 * Unit tests for customIdFactory.ts, focused on the behaviors that changed
 * (or are newly pinned) after re-implementing `createBrowseCustomIdHelpers`
 * on `defineCustomIdFamily`. The pre-existing `browse.test.ts` (colocated at
 * `utils/browse/browse.test.ts`) covers the unchanged public contract and
 * stays green unmodified.
 */

import { describe, it, expect } from 'vitest';
import { createBrowseCustomIdHelpers } from './customIdFactory.js';

describe('customIdFactory — family-backed behavioral deltas', () => {
  const helpers = createBrowseCustomIdHelpers({
    prefix: 't',
    validFilters: ['all', 'mine'] as const,
  });

  it('parse rejects a browse-select id', () => {
    expect(helpers.parse('t::browse-select::0::all::date::')).toBeNull();
  });

  it('parseSelect rejects a browse id', () => {
    expect(helpers.parseSelect('t::browse::0::all::date::')).toBeNull();
  });

  it('rejects an extra trailing segment', () => {
    expect(helpers.parse('t::browse::0::all::date::query::extra')).toBeNull();
  });

  it('rejects a non-numeric page', () => {
    expect(helpers.parse('t::browse::3abc::all::date::')).toBeNull();
  });

  it('round-trips a negative page', () => {
    const customId = helpers.build(-1, 'all', 'date', null);
    expect(customId).toBe('t::browse::-1::all::date::');
    expect(helpers.parse(customId)).toEqual({ page: -1, filter: 'all', sort: 'date', query: null });
  });

  it('collapses a run of colons in the query', () => {
    const customId = helpers.build(0, 'all', 'date', 'a::b');
    expect(customId).toBe('t::browse::0::all::date::a:b');
    expect(helpers.parse(customId)?.query).toBe('a:b');
  });

  it('still truncates the query to 50 characters', () => {
    const customId = helpers.build(0, 'all', 'date', 'x'.repeat(60));
    expect(customId).toBe(`t::browse::0::all::date::${'x'.repeat(50)}`);
  });

  it('throws naming the action and length when the customId exceeds 100 chars', () => {
    const longHelpers = createBrowseCustomIdHelpers({
      prefix: 'x'.repeat(35),
      validFilters: ['all'] as const,
    });
    expect(() => longHelpers.build(0, 'all', 'date', 'y'.repeat(50))).toThrow(/browse/);
    expect(() => longHelpers.build(0, 'all', 'date', 'y'.repeat(50))).toThrow(
      /\d+ chars \(max 100\)/
    );
  });

  describe('includeSort: false variant', () => {
    const withoutSort = createBrowseCustomIdHelpers({
      prefix: 't-no-sort',
      validFilters: ['all'] as const,
      includeSort: false,
    });

    it('parse result has no sort key', () => {
      const result = withoutSort.parse('t-no-sort::browse::0::all::');
      expect(result).not.toBeNull();
      expect(Object.hasOwn(result ?? {}, 'sort')).toBe(false);
    });
  });
});
