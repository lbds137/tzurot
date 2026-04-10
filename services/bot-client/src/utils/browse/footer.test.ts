/**
 * Browse Footer Helpers Tests
 *
 * Unit tests for composable footer helpers and composition pattern tests
 * that document the intended output for each command pattern.
 */

import { describe, it, expect } from 'vitest';
import {
  FOOTER_DELIMITER,
  joinFooter,
  pluralize,
  formatFilterLabeled,
  formatFilterParens,
  formatSortNatural,
  formatSortVerbatim,
  formatPageIndicator,
} from './footer.js';

describe('FOOTER_DELIMITER', () => {
  it('should be a bullet with surrounding spaces', () => {
    expect(FOOTER_DELIMITER).toBe(' \u2022 ');
  });
});

describe('joinFooter', () => {
  it('should join string segments with the standard delimiter', () => {
    expect(joinFooter('a', 'b', 'c')).toBe('a \u2022 b \u2022 c');
  });

  it('should filter out null, undefined, false, and empty strings', () => {
    expect(joinFooter('a', null, 'b', undefined, 'c', false, '', 'd')).toBe(
      'a \u2022 b \u2022 c \u2022 d'
    );
  });

  it('should return empty string when all segments are falsy', () => {
    expect(joinFooter(null, undefined, false)).toBe('');
  });

  it('should return empty string when called with no arguments', () => {
    expect(joinFooter()).toBe('');
  });

  it('should return a single segment without delimiter', () => {
    expect(joinFooter('only')).toBe('only');
  });
});

describe('pluralize', () => {
  const noun = { singular: 'item', plural: 'items' };

  it('should return singular for count === 1', () => {
    expect(pluralize(1, noun)).toBe('1 item');
  });

  it('should return plural for count === 0', () => {
    expect(pluralize(0, noun)).toBe('0 items');
  });

  it('should return plural for count > 1', () => {
    expect(pluralize(5, noun)).toBe('5 items');
  });

  it('should work with irregular nouns', () => {
    expect(pluralize(1, { singular: 'entry', plural: 'entries' })).toBe('1 entry');
    expect(pluralize(3, { singular: 'entry', plural: 'entries' })).toBe('3 entries');
  });
});

describe('formatFilterLabeled', () => {
  it('should format with "filtered by:" prefix', () => {
    expect(formatFilterLabeled('mine')).toBe('filtered by: mine');
  });
});

describe('formatFilterParens', () => {
  it('should wrap in parentheses', () => {
    expect(formatFilterParens('all types')).toBe('(all types)');
  });

  it('should handle filter-specific values', () => {
    expect(formatFilterParens('users only')).toBe('(users only)');
  });
});

describe('formatSortNatural', () => {
  it('should prefix with "Sorted by"', () => {
    expect(formatSortNatural('date')).toBe('Sorted by date');
  });

  it('should work with multi-word labels', () => {
    expect(formatSortNatural('member count')).toBe('Sorted by member count');
  });
});

describe('formatSortVerbatim', () => {
  it('should return the phrase verbatim', () => {
    expect(formatSortVerbatim('Newest first')).toBe('Newest first');
  });

  it('should pass through "Sorted alphabetically" unchanged', () => {
    expect(formatSortVerbatim('Sorted alphabetically')).toBe('Sorted alphabetically');
  });
});

describe('formatPageIndicator', () => {
  it('should format as "Page X of Y"', () => {
    expect(formatPageIndicator(2, 5)).toBe('Page 2 of 5');
  });

  it('should append + when hasMore is true', () => {
    expect(formatPageIndicator(1, 3, { hasMore: true })).toBe('Page 1 of 3+');
  });

  it('should not append + when hasMore is false', () => {
    expect(formatPageIndicator(1, 3, { hasMore: false })).toBe('Page 1 of 3');
  });

  it('should not append + when options are omitted', () => {
    expect(formatPageIndicator(1, 3)).toBe('Page 1 of 3');
  });
});

describe('footer composition patterns', () => {
  it('should produce character/browse style footer', () => {
    expect(
      joinFooter(
        pluralize(5, { singular: 'character', plural: 'characters' }),
        formatFilterLabeled('mine'),
        formatSortNatural('date'),
        '\uD83C\uDF10 Public \uD83D\uDD12 Private'
      )
    ).toBe(
      '5 characters \u2022 filtered by: mine \u2022 Sorted by date \u2022 \uD83C\uDF10 Public \uD83D\uDD12 Private'
    );
  });

  it('should produce character/browse singular footer', () => {
    expect(
      joinFooter(
        pluralize(1, { singular: 'character', plural: 'characters' }),
        formatSortNatural('date'),
        '\uD83C\uDF10 Public \uD83D\uDD12 Private'
      )
    ).toBe('1 character \u2022 Sorted by date \u2022 \uD83C\uDF10 Public \uD83D\uDD12 Private');
  });

  it('should produce inspect/browse style footer (page-first)', () => {
    expect(
      joinFooter(
        formatPageIndicator(2, 5),
        pluralize(42, { singular: 'total log', plural: 'total logs' }),
        'Select a log below to inspect'
      )
    ).toBe('Page 2 of 5 \u2022 42 total logs \u2022 Select a log below to inspect');
  });

  it('should produce memory/search style footer (no count, hasMore)', () => {
    expect(
      joinFooter('Semantic search', 'Filtered', formatPageIndicator(1, 3, { hasMore: true }))
    ).toBe('Semantic search \u2022 Filtered \u2022 Page 1 of 3+');
  });

  it('should produce admin/servers style footer (custom count string)', () => {
    expect(joinFooter('12.5K total members', formatSortNatural('member count'))).toBe(
      '12.5K total members \u2022 Sorted by member count'
    );
  });

  it('should handle conditional filter with && pattern', () => {
    const filter = 'all';
    expect(
      joinFooter(
        pluralize(10, { singular: 'character', plural: 'characters' }),
        filter !== 'all' && formatFilterLabeled(filter),
        formatSortNatural('date')
      )
    ).toBe('10 characters \u2022 Sorted by date');
  });
});
