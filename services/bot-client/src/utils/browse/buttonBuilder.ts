/**
 * Browse Button Builder
 *
 * Shared button building utilities for browse commands.
 * Creates consistent pagination and sort toggle buttons.
 */

import { ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import type { BrowseSortType } from './constants.js';

/**
 * Configuration for building browse buttons
 */
export interface BrowseButtonConfig<TFilter extends string> {
  /** Current page (0-indexed) */
  currentPage: number;
  /** Total number of pages */
  totalPages: number;
  /** Current filter value */
  filter: TFilter;
  /** Current sort type */
  currentSort: BrowseSortType;
  /** Search query if any */
  query: string | null;
  /** Function to build custom ID for pagination */
  buildCustomId: (
    page: number,
    filter: TFilter,
    sort: BrowseSortType,
    query: string | null
  ) => string;
  /** Function to build info button custom ID */
  buildInfoId: () => string;
  /** Whether to show sort toggle button (default: true) */
  showSortToggle?: boolean;
  /** Custom labels for buttons */
  labels?: {
    previous?: string;
    next?: string;
    sortByName?: string;
    sortByDate?: string;
  };
}

/**
 * Default button labels (without emojis - use setEmoji() separately for consistent sizing)
 */
const DEFAULT_LABELS = {
  previous: 'Previous',
  next: 'Next',
  sortByName: 'Sort A-Z',
  sortByDate: 'Sort by Date',
} as const;

/**
 * Default button emojis (set via .setEmoji() for consistent button sizing)
 */
const DEFAULT_EMOJIS = {
  previous: '◀️',
  next: '▶️',
  sortByName: '🔤',
  sortByDate: '📅',
} as const;

/**
 * Build pagination and sort buttons for browse lists
 *
 * Creates a standard button row with:
 * - Previous button (disabled on first page)
 * - Page indicator (disabled)
 * - Next button (disabled on last page)
 * - Sort toggle button (optional)
 *
 * @param config - Button configuration
 * @returns Action row with buttons
 */
export function buildBrowseButtons<TFilter extends string>(
  config: BrowseButtonConfig<TFilter>
): ActionRowBuilder<ButtonBuilder> {
  const {
    currentPage,
    totalPages,
    filter,
    currentSort,
    query,
    buildCustomId,
    buildInfoId,
    showSortToggle = true,
    labels: customLabels,
  } = config;

  const labels = { ...DEFAULT_LABELS, ...customLabels };
  const row = new ActionRowBuilder<ButtonBuilder>();

  // Previous button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId(currentPage - 1, filter, currentSort, query))
      .setLabel(labels.previous)
      .setEmoji(DEFAULT_EMOJIS.previous)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage === 0)
  );

  // Page indicator (disabled button)
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildInfoId())
      .setLabel(`Page ${currentPage + 1} of ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true)
  );

  // Next button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId(currentPage + 1, filter, currentSort, query))
      .setLabel(labels.next)
      .setEmoji(DEFAULT_EMOJIS.next)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages - 1)
  );

  // Sort toggle button (optional)
  if (showSortToggle) {
    const newSort: BrowseSortType = currentSort === 'date' ? 'name' : 'date';
    const sortLabel = currentSort === 'date' ? labels.sortByName : labels.sortByDate;
    const sortEmoji =
      currentSort === 'date' ? DEFAULT_EMOJIS.sortByName : DEFAULT_EMOJIS.sortByDate;
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(buildCustomId(currentPage, filter, newSort, query))
        .setLabel(sortLabel)
        .setEmoji(sortEmoji)
        .setStyle(ButtonStyle.Primary)
    );
  }

  return row;
}

/**
 * Build simple pagination buttons without sort toggle
 *
 * Convenience function for browse commands that don't need sorting.
 *
 * @param config - Button configuration
 * @returns Action row with pagination buttons
 */
export function buildSimplePaginationButtons<TFilter extends string>(
  config: Omit<BrowseButtonConfig<TFilter>, 'showSortToggle'>
): ActionRowBuilder<ButtonBuilder> {
  return buildBrowseButtons({ ...config, showSortToggle: false });
}
