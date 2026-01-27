/**
 * Browse Utilities Tests
 *
 * Tests for shared browse/list utilities including truncation,
 * pagination calculation, and customId builders/parsers.
 */

import { describe, it, expect } from 'vitest';
import {
  ITEMS_PER_PAGE,
  MAX_SELECT_LABEL_LENGTH,
  MAX_SELECT_DESCRIPTION_LENGTH,
  truncateForSelect,
  truncateForDescription,
  calculatePaginationState,
  createBrowseCustomIdHelpers,
} from './index.js';

describe('Browse Constants', () => {
  it('should export expected constant values', () => {
    expect(ITEMS_PER_PAGE).toBe(10);
    expect(MAX_SELECT_LABEL_LENGTH).toBe(100);
    expect(MAX_SELECT_DESCRIPTION_LENGTH).toBe(100);
  });
});

describe('truncateForSelect', () => {
  it('should return text unchanged when under limit', () => {
    expect(truncateForSelect('Short text')).toBe('Short text');
  });

  it('should return text unchanged when exactly at limit', () => {
    const exactLength = 'a'.repeat(MAX_SELECT_LABEL_LENGTH);
    expect(truncateForSelect(exactLength)).toBe(exactLength);
  });

  it('should truncate and add ellipsis when over limit', () => {
    const longText = 'a'.repeat(MAX_SELECT_LABEL_LENGTH + 10);
    const result = truncateForSelect(longText);
    expect(result).toHaveLength(MAX_SELECT_LABEL_LENGTH);
    expect(result.endsWith('...')).toBe(true);
  });

  it('should respect custom maxLength parameter', () => {
    const result = truncateForSelect('Hello World', 8);
    expect(result).toBe('Hello...');
    expect(result).toHaveLength(8);
  });

  it('should handle empty string', () => {
    expect(truncateForSelect('')).toBe('');
  });

  it('should handle very short maxLength', () => {
    const result = truncateForSelect('Hello', 5);
    expect(result).toBe('Hello');
  });

  it('should handle maxLength exactly 3 (edge case for ellipsis)', () => {
    const result = truncateForSelect('Hello', 3);
    expect(result).toBe('...');
  });
});

describe('truncateForDescription', () => {
  it('should use MAX_SELECT_DESCRIPTION_LENGTH as default', () => {
    const longText = 'a'.repeat(MAX_SELECT_DESCRIPTION_LENGTH + 10);
    const result = truncateForDescription(longText);
    expect(result).toHaveLength(MAX_SELECT_DESCRIPTION_LENGTH);
    expect(result.endsWith('...')).toBe(true);
  });
});

describe('calculatePaginationState', () => {
  it('should calculate correct pagination for first page', () => {
    const result = calculatePaginationState(25, 10, 0);

    expect(result.page).toBe(0);
    expect(result.safePage).toBe(0);
    expect(result.totalPages).toBe(3);
    expect(result.totalItems).toBe(25);
    expect(result.itemsPerPage).toBe(10);
    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(10);
  });

  it('should calculate correct pagination for middle page', () => {
    const result = calculatePaginationState(25, 10, 1);

    expect(result.page).toBe(1);
    expect(result.startIndex).toBe(10);
    expect(result.endIndex).toBe(20);
  });

  it('should calculate correct pagination for last page with partial items', () => {
    const result = calculatePaginationState(25, 10, 2);

    expect(result.page).toBe(2);
    expect(result.startIndex).toBe(20);
    expect(result.endIndex).toBe(25);
  });

  it('should clamp page to valid range when too high', () => {
    const result = calculatePaginationState(25, 10, 99);

    expect(result.page).toBe(2);
    expect(result.safePage).toBe(2);
  });

  it('should clamp negative page to 0', () => {
    const result = calculatePaginationState(25, 10, -5);

    expect(result.page).toBe(0);
    expect(result.safePage).toBe(0);
  });

  it('should handle empty list', () => {
    const result = calculatePaginationState(0, 10, 0);

    expect(result.page).toBe(0);
    expect(result.totalPages).toBe(1);
    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(0);
  });

  it('should handle single item', () => {
    const result = calculatePaginationState(1, 10, 0);

    expect(result.totalPages).toBe(1);
    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(1);
  });

  it('should handle items exactly filling pages', () => {
    const result = calculatePaginationState(20, 10, 0);

    expect(result.totalPages).toBe(2);
  });
});

describe('createBrowseCustomIdHelpers', () => {
  const helpers = createBrowseCustomIdHelpers({
    prefix: 'test',
    validFilters: ['all', 'mine', 'public'] as const,
  });

  describe('build', () => {
    it('should build correct customId without query', () => {
      const result = helpers.build(0, 'all', 'date', null);
      expect(result).toBe('test::browse::0::all::date::');
    });

    it('should build correct customId with query', () => {
      const result = helpers.build(1, 'mine', 'name', 'search term');
      expect(result).toBe('test::browse::1::mine::name::search term');
    });

    it('should truncate long queries', () => {
      const longQuery = 'a'.repeat(100);
      const result = helpers.build(0, 'all', 'date', longQuery);
      expect(result).toContain('a'.repeat(50));
      expect(result).not.toContain('a'.repeat(51));
    });
  });

  describe('buildSelect', () => {
    it('should build correct select customId', () => {
      const result = helpers.buildSelect(2, 'public', 'date', 'query');
      expect(result).toBe('test::browse-select::2::public::date::query');
    });
  });

  describe('buildInfo', () => {
    it('should build correct info button customId', () => {
      const result = helpers.buildInfo();
      expect(result).toBe('test::browse::info');
    });
  });

  describe('parse', () => {
    it('should parse valid browse customId', () => {
      const result = helpers.parse('test::browse::1::mine::name::search');
      expect(result).toEqual({
        page: 1,
        filter: 'mine',
        sort: 'name',
        query: 'search',
      });
    });

    it('should parse customId without query', () => {
      const result = helpers.parse('test::browse::0::all::date::');
      expect(result).toEqual({
        page: 0,
        filter: 'all',
        sort: 'date',
        query: null,
      });
    });

    it('should return null for invalid prefix', () => {
      const result = helpers.parse('other::browse::0::all::date::');
      expect(result).toBeNull();
    });

    it('should return null for invalid filter', () => {
      const result = helpers.parse('test::browse::0::invalid::date::');
      expect(result).toBeNull();
    });

    it('should return null for non-numeric page', () => {
      const result = helpers.parse('test::browse::abc::all::date::');
      expect(result).toBeNull();
    });

    it('should return null for too few parts', () => {
      const result = helpers.parse('test::browse::0');
      expect(result).toBeNull();
    });
  });

  describe('parseSelect', () => {
    it('should parse valid select customId', () => {
      const result = helpers.parseSelect('test::browse-select::0::all::date::query');
      expect(result).toEqual({
        page: 0,
        filter: 'all',
        sort: 'date',
        query: 'query',
      });
    });

    it('should return null for browse customId (not select)', () => {
      const result = helpers.parseSelect('test::browse::0::all::date::');
      expect(result).toBeNull();
    });
  });

  describe('isBrowse', () => {
    it('should return true for browse customId', () => {
      expect(helpers.isBrowse('test::browse::0::all::date::')).toBe(true);
    });

    it('should return false for select customId', () => {
      expect(helpers.isBrowse('test::browse-select::0::all::date::')).toBe(false);
    });

    it('should return false for other customId', () => {
      expect(helpers.isBrowse('test::other::something')).toBe(false);
    });
  });

  describe('isBrowseSelect', () => {
    it('should return true for select customId', () => {
      expect(helpers.isBrowseSelect('test::browse-select::0::all::date::')).toBe(true);
    });

    it('should return false for browse customId', () => {
      expect(helpers.isBrowseSelect('test::browse::0::all::date::')).toBe(false);
    });
  });

  describe('round-trip build/parse', () => {
    it('should round-trip browse customId', () => {
      const original = { page: 5, filter: 'mine' as const, sort: 'name' as const, query: 'test' };
      const built = helpers.build(original.page, original.filter, original.sort, original.query);
      const parsed = helpers.parse(built);
      expect(parsed).toEqual(original);
    });

    it('should round-trip select customId', () => {
      const original = {
        page: 2,
        filter: 'public' as const,
        sort: 'date' as const,
        query: null,
      };
      const built = helpers.buildSelect(
        original.page,
        original.filter,
        original.sort,
        original.query
      );
      const parsed = helpers.parseSelect(built);
      expect(parsed).toEqual(original);
    });
  });
});

describe('createBrowseCustomIdHelpers without sort', () => {
  const helpers = createBrowseCustomIdHelpers({
    prefix: 'preset',
    validFilters: ['all', 'global', 'mine', 'free'] as const,
    includeSort: false,
  });

  it('should build customId without sort', () => {
    const result = helpers.build(0, 'all', 'date', null);
    expect(result).toBe('preset::browse::0::all::');
    expect(result).not.toContain('date');
  });

  it('should parse customId without sort', () => {
    const result = helpers.parse('preset::browse::0::global::query');
    expect(result).toEqual({
      page: 0,
      filter: 'global',
      sort: 'date', // Default value when not in customId
      query: 'query',
    });
  });
});
