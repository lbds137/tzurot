/**
 * Browse Utilities
 *
 * Shared utilities for browse/list commands across the bot.
 * Provides consistent pagination, truncation, and customId handling.
 *
 * Usage:
 * ```typescript
 * import {
 *   ITEMS_PER_PAGE,
 *   truncateForSelect,
 *   createBrowseCustomIdHelpers,
 *   buildBrowseButtons,
 *   calculatePaginationState,
 * } from '../../utils/browse/index.js';
 * ```
 */

// Constants
export {
  ITEMS_PER_PAGE,
  MAX_SELECT_LABEL_LENGTH,
  MAX_SELECT_DESCRIPTION_LENGTH,
  type BrowseSortType,
} from './constants.js';

// Truncation utilities
export { truncateForSelect, truncateForDescription } from './truncation.js';

// Types
export { calculatePaginationState, type BrowseActionRow } from './types.js';

// CustomId factory
export { createBrowseCustomIdHelpers } from './customIdFactory.js';

// Button builder
export {
  buildBrowseButtons,
  buildSimplePaginationButtons,
  createBrowseSortToggle,
  type BrowseSortToggle,
} from './buttonBuilder.js';

// Select menu builder
export { buildBrowseSelectMenu } from './selectMenuBuilder.js';

// In-place filter toggle (≤3-value filters; spec §3.1)
export { buildFilterToggleButton, type FilterToggleDisplay } from './filterRowBuilder.js';

// Footer helpers
export {
  joinFooter,
  pluralize,
  formatFilterLabeled,
  formatSortNatural,
  formatSortVerbatim,
  formatPageIndicator,
} from './footer.js';

// Shared list-embed builder (§2.4 row grammar, §2.1 titles, D19 empty states)
export { buildBrowseListEmbed } from './listEmbedBuilder.js';
