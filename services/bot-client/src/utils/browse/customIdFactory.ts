/**
 * Browse CustomId Factory
 *
 * Factory functions for creating type-safe customId builders and parsers
 * for browse commands. Uses the :: delimiter standard.
 *
 * Pattern: {command}::browse::{page}::{filter}::{sort}::{query}
 */

import { CUSTOM_ID_DELIMITER } from '../customIds.js';
import type { BrowseSortType } from './constants.js';
import type { ParsedBrowseCustomId } from './types.js';

/**
 * Maximum query length in customIds.
 * Discord customIds have a 100-char limit, and the base format uses ~45-50 chars.
 */
const MAX_CUSTOMID_QUERY_LENGTH = 50;

/**
 * Configuration for creating browse customId helpers.
 *
 * `TSort` defaults to the standard `BrowseSortType = 'name' | 'date'` but
 * can be widened to a command-specific union (e.g., admin/servers uses
 * `'members' | 'name'`). When a custom `TSort` is used, callers must pass
 * matching `validSorts` to enable runtime validation of parsed values.
 */
interface BrowseCustomIdConfig<TFilter extends string, TSort extends string = BrowseSortType> {
  /** Command prefix (e.g., 'character', 'preset') */
  prefix: string;
  /** Valid filter values for type safety */
  validFilters: readonly TFilter[];
  /** Valid sort values (defaults to ['name', 'date']) */
  validSorts?: readonly TSort[];
  /** Whether to include sort in customId (default: true) */
  includeSort?: boolean;
}

/** Internal config for parse function */
interface ParseConfig<TFilter extends string, TSort extends string = BrowseSortType> {
  validFilters: readonly TFilter[];
  validSorts: readonly TSort[];
  includeSort: boolean;
}

/**
 * Truncate query to fit within Discord's 100-char customId limit.
 *
 * Discord customIds have a 100 character maximum. The base format uses ~45-50 chars
 * for prefix, browse marker, page, filter, and sort (e.g., "character::browse::0::all::date::").
 * To be safe, we limit query strings to 50 characters max.
 *
 * Example: "character::browse::0::public::name::searchquery" (47 chars base + query)
 *
 * Note: This means long search queries will be silently truncated when stored in
 * pagination buttons. The full query should be preserved in the browse context for
 * display purposes, even though the customId uses the truncated version for navigation.
 */
function truncateQuery(query: string | null): string {
  if (query === null) {
    return '';
  }
  return query.length > MAX_CUSTOMID_QUERY_LENGTH
    ? query.slice(0, MAX_CUSTOMID_QUERY_LENGTH)
    : query;
}

/**
 * Core parse function for browse customIds
 */
function parseCustomIdCore<TFilter extends string, TSort extends string = BrowseSortType>(
  customId: string,
  expectedPrefix: string,
  config: ParseConfig<TFilter, TSort>
): ParsedBrowseCustomId<TFilter, TSort> | null {
  if (!customId.startsWith(expectedPrefix)) {
    return null;
  }

  const parts = customId.split(CUSTOM_ID_DELIMITER);
  const minParts = config.includeSort ? 5 : 4;
  if (parts.length < minParts) {
    return null;
  }

  const page = parseInt(parts[2], 10);
  if (isNaN(page)) {
    return null;
  }

  const filter = parts[3] as TFilter;
  if (!config.validFilters.includes(filter)) {
    return null;
  }

  // Sort validation is symmetric with filter validation: when sort IS
  // encoded in the customId (includeSort === true), an invalid value is
  // a hard rejection, matching the filter behavior. This was historically
  // a silent fallback to validSorts[0], which masked tampered/stale
  // customIds and produced inconsistent behavior between the two fields.
  // When `includeSort: false`, sort isn't in the customId at all and the
  // returned value is the first entry in validSorts as a safe default
  // (callers that opt out of sort encoding should not rely on this field).
  let sort: TSort = config.validSorts[0];
  if (config.includeSort) {
    if (parts[4] === undefined) {
      // Missing sort segment where one was expected — malformed, reject.
      return null;
    }
    const sortValue = parts[4] as TSort;
    if (!config.validSorts.includes(sortValue)) {
      // Invalid sort value — reject, matching filter validation.
      return null;
    }
    sort = sortValue;
  }

  const queryIndex = config.includeSort ? 5 : 4;
  const queryValue = parts[queryIndex];
  const query = queryValue !== undefined && queryValue !== '' ? queryValue : null;

  return { page, filter, sort, query };
}

/**
 * Result of createBrowseCustomIdHelpers
 */
export interface BrowseCustomIdHelpers<
  TFilter extends string,
  TSort extends string = BrowseSortType,
> {
  /** Build customId for browse pagination */
  build: (page: number, filter: TFilter, sort: TSort, query: string | null) => string;
  /** Build customId for browse select menu */
  buildSelect: (page: number, filter: TFilter, sort: TSort, query: string | null) => string;
  /** Build customId for info button (disabled page indicator) */
  buildInfo: () => string;
  /** Parse browse customId */
  parse: (customId: string) => ParsedBrowseCustomId<TFilter, TSort> | null;
  /** Parse browse select customId */
  parseSelect: (customId: string) => ParsedBrowseCustomId<TFilter, TSort> | null;
  /** Check if customId is a browse interaction */
  isBrowse: (customId: string) => boolean;
  /** Check if customId is a browse select interaction */
  isBrowseSelect: (customId: string) => boolean;
  /** Browse prefix for matching */
  browsePrefix: string;
  /** Browse select prefix for matching */
  browseSelectPrefix: string;
}

/**
 * Create type-safe browse customId helpers for a command
 *
 * @param config - Configuration for the browse command
 * @returns Object with build/parse/check functions
 *
 * @example
 * ```typescript
 * const helpers = createBrowseCustomIdHelpers({
 *   prefix: 'character',
 *   validFilters: ['all', 'mine', 'public'] as const,
 * });
 *
 * const customId = helpers.build(0, 'all', 'date', null);
 * // 'character::browse::0::all::date::'
 *
 * const parsed = helpers.parse(customId);
 * // { page: 0, filter: 'all', sort: 'date', query: null }
 * ```
 */
// Overload 1: standard BrowseSortType (validSorts is optional, defaults to
// ['name', 'date']). This is the common case — all callers that don't widen
// TSort match this signature.
export function createBrowseCustomIdHelpers<TFilter extends string>(
  config: BrowseCustomIdConfig<TFilter, BrowseSortType>
): BrowseCustomIdHelpers<TFilter, BrowseSortType>;

// Overload 2: custom TSort union (validSorts is REQUIRED). This catches the
// footgun the PR #773 reviewer flagged: a caller who widens TSort without
// passing matching validSorts would get the default ['name', 'date'] cast
// at runtime, silently falling back to 'name' on every parse. The required
// parameter in this overload prevents that at compile time — admin/servers'
// `createBrowseCustomIdHelpers<_, 'members' | 'name'>({...})` must include
// `validSorts: ['members', 'name']` or TypeScript rejects it.
export function createBrowseCustomIdHelpers<TFilter extends string, TSort extends string>(
  config: Omit<BrowseCustomIdConfig<TFilter, TSort>, 'validSorts'> & {
    validSorts: readonly TSort[];
  }
): BrowseCustomIdHelpers<TFilter, TSort>;

// Implementation signature (not visible to callers)
export function createBrowseCustomIdHelpers<
  TFilter extends string,
  TSort extends string = BrowseSortType,
>(config: BrowseCustomIdConfig<TFilter, TSort>): BrowseCustomIdHelpers<TFilter, TSort> {
  const {
    prefix,
    validFilters,
    // When `TSort` is omitted/defaults to `BrowseSortType`, the default
    // ['name', 'date'] is valid. When callers widen `TSort` to a custom
    // union (e.g., 'members' | 'name' for admin/servers), they MUST pass
    // a matching `validSorts` — the default cast below is only sound for
    // the `BrowseSortType` case. TypeScript can't express this constraint
    // at the type level, so the `unknown` bridge documents the invariant.
    validSorts = ['name', 'date'] as unknown as readonly TSort[],
    includeSort = true,
  } = config;

  const browsePrefix = `${prefix}${CUSTOM_ID_DELIMITER}browse`;
  const browseSelectPrefix = `${prefix}${CUSTOM_ID_DELIMITER}browse-select`;
  const parseConfig: ParseConfig<TFilter, TSort> = { validFilters, validSorts, includeSort };

  const build = (page: number, filter: TFilter, sort: TSort, query: string | null): string => {
    const parts = [browsePrefix, String(page), filter];
    if (includeSort) {
      parts.push(sort);
    }
    parts.push(truncateQuery(query));
    return parts.join(CUSTOM_ID_DELIMITER);
  };

  const buildSelect = (
    page: number,
    filter: TFilter,
    sort: TSort,
    query: string | null
  ): string => {
    const parts = [browseSelectPrefix, String(page), filter];
    if (includeSort) {
      parts.push(sort);
    }
    parts.push(truncateQuery(query));
    return parts.join(CUSTOM_ID_DELIMITER);
  };

  const buildInfo = (): string => `${browsePrefix}${CUSTOM_ID_DELIMITER}info`;

  const parse = (customId: string): ParsedBrowseCustomId<TFilter, TSort> | null =>
    parseCustomIdCore(customId, browsePrefix, parseConfig);

  const parseSelect = (customId: string): ParsedBrowseCustomId<TFilter, TSort> | null =>
    parseCustomIdCore(customId, browseSelectPrefix, parseConfig);

  const isBrowse = (customId: string): boolean =>
    customId.startsWith(browsePrefix + CUSTOM_ID_DELIMITER) || customId === browsePrefix;

  const isBrowseSelect = (customId: string): boolean =>
    customId.startsWith(browseSelectPrefix + CUSTOM_ID_DELIMITER) ||
    customId === browseSelectPrefix;

  return {
    build,
    buildSelect,
    buildInfo,
    parse,
    parseSelect,
    isBrowse,
    isBrowseSelect,
    browsePrefix,
    browseSelectPrefix,
  };
}
