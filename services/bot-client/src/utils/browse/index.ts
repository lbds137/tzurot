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
  DEFAULT_BROWSE_SORT,
  type BrowseSortType,
} from './constants.js';

// Truncation utilities
export { truncateForSelect, truncateForDescription } from './truncation.js';

// Types
export {
  type PaginationState,
  type BrowseState,
  type ParsedBrowseCustomId,
  calculatePaginationState,
} from './types.js';

// CustomId factory
export {
  MAX_CUSTOMID_QUERY_LENGTH,
  type BrowseCustomIdConfig,
  type BrowseCustomIdHelpers,
  createBrowseCustomIdHelpers,
} from './customIdFactory.js';

// Button builder
export {
  type BrowseButtonConfig,
  buildBrowseButtons,
  buildSimplePaginationButtons,
} from './buttonBuilder.js';
