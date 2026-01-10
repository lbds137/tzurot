/**
 * Shared Pagination Builder
 *
 * Provides reusable pagination components for list commands.
 * Used by /character list, /channel list, /memory list, etc.
 *
 * Standard button layout:
 *   [◀ Previous] [Page X of Y] [Next ▶] [🔤 Sort A-Z]
 *
 * Custom ID format:
 *   {prefix}::list::{page}::{sort}  - Navigation buttons
 *   {prefix}::sort::{page}::{sort}  - Sort toggle button
 *   {prefix}::list::info            - Page indicator (disabled)
 */

import { ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { CUSTOM_ID_DELIMITER } from './customIds.js';
import type { ListSortType } from './listSorting.js';

/**
 * Configuration for pagination buttons
 */
export interface PaginationConfig {
  /** Command prefix for custom IDs (e.g., 'character', 'channel', 'memory') */
  prefix: string;

  /** Custom labels (optional) */
  labels?: {
    previous?: string;
    next?: string;
    sortByName?: string;
    sortByDate?: string;
  };
}

/**
 * Parsed pagination custom ID result
 */
export interface PaginationParseResult {
  /** The command prefix */
  prefix: string;
  /** Action type: 'list' for navigation, 'sort' for sort toggle */
  action: 'list' | 'sort';
  /** Target page number (undefined for info button) */
  page?: number;
  /** Sort type */
  sort?: ListSortType;
}

/**
 * Default labels for pagination buttons
 */
const DEFAULT_LABELS = {
  previous: '◀ Previous',
  next: 'Next ▶',
  sortByName: '🔤 Sort A-Z',
  sortByDate: '📅 Sort by Date',
} as const;

/**
 * Build custom ID for list navigation
 */
export function buildListPageId(prefix: string, page: number, sort: ListSortType): string {
  return `${prefix}${CUSTOM_ID_DELIMITER}list${CUSTOM_ID_DELIMITER}${page}${CUSTOM_ID_DELIMITER}${sort}`;
}

/**
 * Build custom ID for page info (disabled button)
 */
export function buildListInfoId(prefix: string): string {
  return `${prefix}${CUSTOM_ID_DELIMITER}list${CUSTOM_ID_DELIMITER}info`;
}

/**
 * Build custom ID for sort toggle
 */
export function buildSortToggleId(prefix: string, page: number, newSort: ListSortType): string {
  return `${prefix}${CUSTOM_ID_DELIMITER}sort${CUSTOM_ID_DELIMITER}${page}${CUSTOM_ID_DELIMITER}${newSort}`;
}

/**
 * Parse a pagination custom ID
 *
 * @param customId - The custom ID to parse
 * @param expectedPrefix - Optional prefix to validate against
 * @returns Parsed result or null if not a pagination ID
 */
export function parsePaginationId(
  customId: string,
  expectedPrefix?: string
): PaginationParseResult | null {
  const parts = customId.split(CUSTOM_ID_DELIMITER);

  if (parts.length < 2) {
    return null;
  }

  const prefix = parts[0];
  const action = parts[1];

  // Validate prefix if expected
  if (expectedPrefix !== undefined && prefix !== expectedPrefix) {
    return null;
  }

  // Must be list or sort action
  if (action !== 'list' && action !== 'sort') {
    return null;
  }

  // Info button has no page/sort
  if (parts[2] === 'info') {
    return { prefix, action: 'list', page: undefined, sort: undefined };
  }

  // Parse page and sort
  const result: PaginationParseResult = {
    prefix,
    action: action,
  };

  if (parts[2] !== undefined) {
    const pageNum = parseInt(parts[2], 10);
    if (!isNaN(pageNum)) {
      result.page = pageNum;
    }
  }

  if (parts[3] === 'date' || parts[3] === 'name') {
    result.sort = parts[3];
  }

  return result;
}

/**
 * Check if a custom ID is a pagination ID for a specific prefix
 */
export function isPaginationId(customId: string, prefix: string): boolean {
  return (
    customId.startsWith(`${prefix}${CUSTOM_ID_DELIMITER}list`) ||
    customId.startsWith(`${prefix}${CUSTOM_ID_DELIMITER}sort`)
  );
}

/**
 * Build pagination buttons row
 *
 * @param config - Pagination configuration
 * @param currentPage - Current page (0-indexed)
 * @param totalPages - Total number of pages
 * @param currentSort - Current sort type
 * @returns ActionRowBuilder with pagination buttons
 *
 * @example
 * ```typescript
 * const buttons = buildPaginationButtons(
 *   { prefix: 'memory' },
 *   0,  // first page
 *   5,  // 5 pages total
 *   'date'
 * );
 * await interaction.editReply({ embeds: [embed], components: [buttons] });
 * ```
 */
export function buildPaginationButtons(
  config: PaginationConfig,
  currentPage: number,
  totalPages: number,
  currentSort: ListSortType
): ActionRowBuilder<ButtonBuilder> {
  const labels = { ...DEFAULT_LABELS, ...config.labels };
  const row = new ActionRowBuilder<ButtonBuilder>();

  // Previous button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildListPageId(config.prefix, currentPage - 1, currentSort))
      .setLabel(labels.previous)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage === 0)
  );

  // Page indicator (disabled button)
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildListInfoId(config.prefix))
      .setLabel(`Page ${currentPage + 1} of ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true)
  );

  // Next button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildListPageId(config.prefix, currentPage + 1, currentSort))
      .setLabel(labels.next)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages - 1)
  );

  // Sort toggle button
  const newSort: ListSortType = currentSort === 'date' ? 'name' : 'date';
  const sortLabel = currentSort === 'date' ? labels.sortByName : labels.sortByDate;
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildSortToggleId(config.prefix, currentPage, newSort))
      .setLabel(sortLabel)
      .setStyle(ButtonStyle.Primary)
  );

  return row;
}

/**
 * Calculate pagination info
 *
 * @param totalItems - Total number of items
 * @param itemsPerPage - Items per page
 * @param requestedPage - Requested page (0-indexed)
 * @returns Pagination info with safe page and slice indices
 */
export function calculatePagination(
  totalItems: number,
  itemsPerPage: number,
  requestedPage: number
): {
  totalPages: number;
  safePage: number;
  startIndex: number;
  endIndex: number;
} {
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const safePage = Math.min(Math.max(0, requestedPage), totalPages - 1);
  const startIndex = safePage * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, totalItems);

  return { totalPages, safePage, startIndex, endIndex };
}
