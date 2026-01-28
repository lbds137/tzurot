/**
 * Pagination Builder Tests
 */

import { describe, it, expect } from 'vitest';
import { ButtonStyle, ComponentType } from 'discord.js';
import {
  buildPaginationButtons,
  buildListPageId,
  buildListInfoId,
  buildSortToggleId,
  parsePaginationId,
  isPaginationId,
  calculatePagination,
} from './paginationBuilder.js';

describe('paginationBuilder', () => {
  describe('buildListPageId', () => {
    it('should build correct custom ID for list page', () => {
      expect(buildListPageId('memory', 0, 'date')).toBe('memory::list::0::date');
      expect(buildListPageId('character', 5, 'name')).toBe('character::list::5::name');
    });
  });

  describe('buildListInfoId', () => {
    it('should build correct custom ID for info button', () => {
      expect(buildListInfoId('memory')).toBe('memory::list::info');
      expect(buildListInfoId('channel')).toBe('channel::list::info');
    });
  });

  describe('buildSortToggleId', () => {
    it('should build correct custom ID for sort toggle', () => {
      expect(buildSortToggleId('memory', 0, 'name')).toBe('memory::sort::0::name');
      expect(buildSortToggleId('character', 2, 'date')).toBe('character::sort::2::date');
    });
  });

  describe('parsePaginationId', () => {
    it('should parse list navigation custom ID', () => {
      const result = parsePaginationId('memory::list::2::date');
      expect(result).toEqual({
        prefix: 'memory',
        action: 'list',
        page: 2,
        sort: 'date',
      });
    });

    it('should parse sort toggle custom ID', () => {
      const result = parsePaginationId('character::sort::1::name');
      expect(result).toEqual({
        prefix: 'character',
        action: 'sort',
        page: 1,
        sort: 'name',
      });
    });

    it('should parse info button custom ID', () => {
      const result = parsePaginationId('memory::list::info');
      expect(result).toEqual({
        prefix: 'memory',
        action: 'list',
        page: undefined,
        sort: undefined,
      });
    });

    it('should return null for non-pagination custom IDs', () => {
      expect(parsePaginationId('memory::delete::abc')).toBeNull();
      expect(parsePaginationId('memory::view::123')).toBeNull();
      expect(parsePaginationId('invalid')).toBeNull();
    });

    it('should validate expected prefix when provided', () => {
      expect(parsePaginationId('memory::list::0::date', 'memory')).not.toBeNull();
      expect(parsePaginationId('memory::list::0::date', 'character')).toBeNull();
    });
  });

  describe('isPaginationId', () => {
    it('should return true for list custom IDs', () => {
      expect(isPaginationId('memory::list::0::date', 'memory')).toBe(true);
      expect(isPaginationId('memory::list::info', 'memory')).toBe(true);
    });

    it('should return true for sort custom IDs', () => {
      expect(isPaginationId('memory::sort::0::name', 'memory')).toBe(true);
    });

    it('should return false for other custom IDs', () => {
      expect(isPaginationId('memory::delete::abc', 'memory')).toBe(false);
      expect(isPaginationId('character::list::0::date', 'memory')).toBe(false);
    });
  });

  describe('buildPaginationButtons', () => {
    it('should build action row with 4 buttons', () => {
      const row = buildPaginationButtons({ prefix: 'memory' }, 0, 5, 'date');

      expect(row.components).toHaveLength(4);
      expect(row.components[0].data.type).toBe(ComponentType.Button);
    });

    it('should disable previous button on first page', () => {
      const row = buildPaginationButtons({ prefix: 'memory' }, 0, 5, 'date');
      const prevButton = row.components[0];

      expect(prevButton.data.disabled).toBe(true);
      expect(prevButton.data.custom_id).toBe('memory::list::-1::date');
    });

    it('should disable next button on last page', () => {
      const row = buildPaginationButtons({ prefix: 'memory' }, 4, 5, 'date');
      const nextButton = row.components[2];

      expect(nextButton.data.disabled).toBe(true);
    });

    it('should enable both nav buttons on middle page', () => {
      const row = buildPaginationButtons({ prefix: 'memory' }, 2, 5, 'date');

      expect(row.components[0].data.disabled).toBe(false); // Previous
      expect(row.components[2].data.disabled).toBe(false); // Next
    });

    it('should always disable page indicator button', () => {
      const row = buildPaginationButtons({ prefix: 'memory' }, 0, 5, 'date');
      const infoButton = row.components[1];

      expect(infoButton.data.disabled).toBe(true);
      expect(infoButton.data.label).toBe('Page 1 of 5');
    });

    it('should toggle sort button based on current sort', () => {
      const rowDate = buildPaginationButtons({ prefix: 'memory' }, 0, 5, 'date');
      expect(rowDate.components[3].data.label).toBe('Sort A-Z');
      expect(rowDate.components[3].data.emoji?.name).toBe('🔤');
      expect(rowDate.components[3].data.custom_id).toBe('memory::sort::0::name');

      const rowName = buildPaginationButtons({ prefix: 'memory' }, 0, 5, 'name');
      expect(rowName.components[3].data.label).toBe('Sort by Date');
      expect(rowName.components[3].data.emoji?.name).toBe('📅');
      expect(rowName.components[3].data.custom_id).toBe('memory::sort::0::date');
    });

    it('should use Primary style for sort button', () => {
      const row = buildPaginationButtons({ prefix: 'memory' }, 0, 5, 'date');
      expect(row.components[3].data.style).toBe(ButtonStyle.Primary);
    });

    it('should use custom labels when provided', () => {
      const row = buildPaginationButtons(
        {
          prefix: 'memory',
          labels: {
            previous: '← Back',
            next: 'Forward →',
          },
        },
        1,
        5,
        'date'
      );

      expect(row.components[0].data.label).toBe('← Back');
      expect(row.components[2].data.label).toBe('Forward →');
    });
  });

  describe('calculatePagination', () => {
    it('should calculate correct pagination for full pages', () => {
      const result = calculatePagination(50, 10, 2);

      expect(result.totalPages).toBe(5);
      expect(result.safePage).toBe(2);
      expect(result.startIndex).toBe(20);
      expect(result.endIndex).toBe(30);
    });

    it('should handle partial last page', () => {
      const result = calculatePagination(25, 10, 2);

      expect(result.totalPages).toBe(3);
      expect(result.safePage).toBe(2);
      expect(result.startIndex).toBe(20);
      expect(result.endIndex).toBe(25); // Only 5 items on last page
    });

    it('should clamp page to valid range', () => {
      // Negative page
      expect(calculatePagination(50, 10, -1).safePage).toBe(0);

      // Page beyond total
      expect(calculatePagination(50, 10, 10).safePage).toBe(4);
    });

    it('should handle empty list', () => {
      const result = calculatePagination(0, 10, 0);

      expect(result.totalPages).toBe(1);
      expect(result.safePage).toBe(0);
      expect(result.startIndex).toBe(0);
      expect(result.endIndex).toBe(0);
    });

    it('should handle single item', () => {
      const result = calculatePagination(1, 10, 0);

      expect(result.totalPages).toBe(1);
      expect(result.startIndex).toBe(0);
      expect(result.endIndex).toBe(1);
    });
  });
});
