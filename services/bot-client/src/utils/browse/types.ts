/**
 * Browse Types
 *
 * Type definitions for browse/list commands, including pagination state
 * and browse context for back navigation.
 */

import type { BrowseSortType } from './constants.js';

/**
 * Pagination state for browse lists
 */
export interface PaginationState {
  /** Current page (0-indexed) */
  page: number;
  /** Total number of pages */
  totalPages: number;
  /** Total number of items */
  totalItems: number;
  /** Items per page */
  itemsPerPage: number;
}

/**
 * Generic browse state that can be extended by specific commands
 */
export interface BrowseState<TFilter extends string = string> {
  /** Current page (0-indexed) */
  page: number;
  /** Current filter value */
  filter: TFilter;
  /** Current sort type */
  sort: BrowseSortType;
  /** Search query if any */
  query: string | null;
}

/**
 * Calculate pagination info from total items
 *
 * @param totalItems - Total number of items
 * @param itemsPerPage - Items per page
 * @param requestedPage - Requested page (0-indexed)
 * @returns Pagination info with safe page and slice indices
 */
export function calculatePaginationState(
  totalItems: number,
  itemsPerPage: number,
  requestedPage: number
): PaginationState & { startIndex: number; endIndex: number; safePage: number } {
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const safePage = Math.min(Math.max(0, requestedPage), totalPages - 1);
  const startIndex = safePage * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, totalItems);

  return {
    page: safePage,
    safePage,
    totalPages,
    totalItems,
    itemsPerPage,
    startIndex,
    endIndex,
  };
}

/**
 * Parsed browse custom ID result
 * Generic version that specific commands can extend
 */
export interface ParsedBrowseCustomId<TFilter extends string = string> {
  /** Current page (0-indexed) */
  page: number;
  /** Filter value */
  filter: TFilter;
  /** Sort type */
  sort: BrowseSortType;
  /** Search query */
  query: string | null;
}
