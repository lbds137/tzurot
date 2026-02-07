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
export { calculatePaginationState } from './types.js';

// CustomId factory
export { createBrowseCustomIdHelpers } from './customIdFactory.js';

// Button builder
export { buildBrowseButtons } from './buttonBuilder.js';
