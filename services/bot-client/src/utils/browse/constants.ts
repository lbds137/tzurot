/**
 * Browse Constants
 *
 * Shared constants for browse/list commands across the bot.
 * These values are used consistently for pagination and select menus.
 */

/** Default number of items per page for browse lists */
export const ITEMS_PER_PAGE = 10;

/** Maximum length for select menu option labels (Discord limit) */
export const MAX_SELECT_LABEL_LENGTH = 100;

/** Maximum length for select menu option descriptions (Discord limit) */
export const MAX_SELECT_DESCRIPTION_LENGTH = 100;

/** Default sort options */
export type BrowseSortType = 'name' | 'date';

/** Default sort type for browse commands */
export const DEFAULT_BROWSE_SORT: BrowseSortType = 'name';
