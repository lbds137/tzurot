import { describe, it, expect } from 'vitest';
import { createListComparator, sortItems, type ListSortType } from './listSorting.js';

interface TestItem {
  name: string;
  date: string;
}

describe('listSorting', () => {
  const testItems: TestItem[] = [
    { name: 'Banana', date: '2024-01-15' },
    { name: 'Apple', date: '2024-03-20' },
    { name: 'Cherry', date: '2024-02-10' },
  ];

  const comparator = createListComparator<TestItem>(
    item => item.name,
    item => item.date
  );

  describe('createListComparator', () => {
    it('should sort by name alphabetically (A-Z)', () => {
      const sorted = [...testItems].sort(comparator('name'));

      expect(sorted.map(i => i.name)).toEqual(['Apple', 'Banana', 'Cherry']);
    });

    it('should sort by date newest first', () => {
      const sorted = [...testItems].sort(comparator('date'));

      expect(sorted.map(i => i.name)).toEqual(['Apple', 'Cherry', 'Banana']);
    });

    it('should handle items with same name', () => {
      const items: TestItem[] = [
        { name: 'Same', date: '2024-01-01' },
        { name: 'Same', date: '2024-02-01' },
      ];

      const sorted = [...items].sort(comparator('name'));

      // localeCompare returns 0 for equal strings, order preserved
      expect(sorted).toHaveLength(2);
    });

    it('should handle items with same date', () => {
      const items: TestItem[] = [
        { name: 'Zebra', date: '2024-01-01' },
        { name: 'Alpha', date: '2024-01-01' },
      ];

      const sorted = [...items].sort(comparator('date'));

      // Same date, order depends on sort stability
      expect(sorted).toHaveLength(2);
    });

    it('should handle Date objects as well as strings', () => {
      const dateComparator = createListComparator<{ name: string; date: Date }>(
        item => item.name,
        item => item.date
      );

      const items = [
        { name: 'Old', date: new Date('2024-01-01') },
        { name: 'New', date: new Date('2024-12-01') },
      ];

      const sorted = [...items].sort(dateComparator('date'));

      expect(sorted[0].name).toBe('New');
      expect(sorted[1].name).toBe('Old');
    });
  });

  describe('sortItems', () => {
    it('should return a new sorted array without mutating original', () => {
      const original = [...testItems];
      const sorted = sortItems(testItems, comparator, 'name');

      // Original should be unchanged
      expect(testItems).toEqual(original);
      // Sorted should be different order
      expect(sorted.map(i => i.name)).toEqual(['Apple', 'Banana', 'Cherry']);
    });

    it('should work with name sort type', () => {
      const sorted = sortItems(testItems, comparator, 'name');

      expect(sorted.map(i => i.name)).toEqual(['Apple', 'Banana', 'Cherry']);
    });

    it('should work with date sort type', () => {
      const sorted = sortItems(testItems, comparator, 'date');

      expect(sorted.map(i => i.name)).toEqual(['Apple', 'Cherry', 'Banana']);
    });

    it('should handle empty array', () => {
      const sorted = sortItems([], comparator, 'name');

      expect(sorted).toEqual([]);
    });

    it('should handle single item array', () => {
      const single = [{ name: 'Only', date: '2024-01-01' }];
      const sorted = sortItems(single, comparator, 'name');

      expect(sorted).toEqual(single);
    });
  });
});
