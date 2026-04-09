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
interface PaginationState {
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
 * Fields common to both parsed-browse variants.
 *
 * The discriminator between variants is the presence or absence of the
 * `sort` field (see below). This base interface is internal — callers
 * should use one of the variant types, not the base directly.
 */
interface ParsedBrowseCustomIdBase<TFilter extends string> {
  /** Current page (0-indexed) */
  page: number;
  /** Filter value */
  filter: TFilter;
  /** Search query */
  query: string | null;
}

/**
 * Parsed browse custom ID result for helpers created with
 * `includeSort: true` (the default).
 *
 * Exposes a typed `sort` field. `TSort` defaults to the standard
 * `BrowseSortType = 'name' | 'date'` but can be widened to a
 * command-specific union (e.g., admin/servers uses `'members' | 'name'`).
 */
export interface ParsedBrowseCustomIdWithSort<
  TFilter extends string,
  TSort extends string = BrowseSortType,
> extends ParsedBrowseCustomIdBase<TFilter> {
  /** Parsed sort type from the customId. */
  sort: TSort;
}

/**
 * Parsed browse custom ID result for helpers created with
 * `includeSort: false`.
 *
 * **Omits the `sort` field entirely.** Previous versions included a
 * placeholder (`validSorts[0]`) with a "don't read this" contract
 * enforced at test time via a file-content scan. The discriminated
 * variant makes reading `.sort` on an `includeSort: false` parse
 * result a TypeScript compile error — the file-content scan is no
 * longer needed and was removed in Step 7.
 */
export type ParsedBrowseCustomIdWithoutSort<TFilter extends string> =
  ParsedBrowseCustomIdBase<TFilter>;
