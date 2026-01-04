/**
 * Shared Sorting Utilities for List Commands
 *
 * Provides reusable comparator functions for sorting lists by name or date.
 * Used by both /channel list and /character list commands.
 */

/** Sort options for list commands */
export type ListSortType = 'name' | 'date';

/**
 * Create a comparator function for list sorting.
 *
 * @param nameAccessor - Function to extract display name from item
 * @param dateAccessor - Function to extract date from item
 * @returns A function that takes a sort type and returns a comparator
 *
 * @example
 * ```typescript
 * const characterComparator = createListComparator(
 *   (c: CharacterData) => c.displayName ?? c.name,
 *   (c: CharacterData) => c.updatedAt
 * );
 * const sorted = [...chars].sort(characterComparator('name'));
 * ```
 */
export function createListComparator<T>(
  nameAccessor: (item: T) => string,
  dateAccessor: (item: T) => string | Date
): (sortType: ListSortType) => (a: T, b: T) => number {
  return (sortType: ListSortType) =>
    (a: T, b: T): number => {
      if (sortType === 'name') {
        return nameAccessor(a).localeCompare(nameAccessor(b));
      }
      // 'date' - newest first (descending)
      return new Date(dateAccessor(b)).getTime() - new Date(dateAccessor(a)).getTime();
    };
}

/**
 * Sort items using a comparator created by createListComparator.
 * Returns a new sorted array (does not mutate original).
 *
 * @param items - Array of items to sort
 * @param comparatorFn - Comparator function from createListComparator
 * @param sortType - Sort type ('name' or 'date')
 * @returns New sorted array
 */
export function sortItems<T>(
  items: T[],
  comparatorFn: (sortType: ListSortType) => (a: T, b: T) => number,
  sortType: ListSortType
): T[] {
  return [...items].sort(comparatorFn(sortType));
}
