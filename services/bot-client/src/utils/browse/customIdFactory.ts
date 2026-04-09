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
import type { ParsedBrowseCustomIdWithSort, ParsedBrowseCustomIdWithoutSort } from './types.js';

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
 * Core parse function for browse customIds.
 *
 * Returns an internal "always has sort" shape. The public `parse` /
 * `parseSelect` wrappers exposed by {@link createBrowseCustomIdHelpers}
 * strip the sort field at the factory boundary when `includeSort: false`,
 * so external callers see `ParsedBrowseCustomIdWithoutSort` with no
 * sort property (neither at the type level nor at runtime).
 */
interface ParsedCoreResult<TFilter extends string, TSort extends string> {
  page: number;
  filter: TFilter;
  sort: TSort;
  query: string | null;
}

function parseCustomIdCore<TFilter extends string, TSort extends string = BrowseSortType>(
  customId: string,
  expectedPrefix: string,
  config: ParseConfig<TFilter, TSort>
): ParsedCoreResult<TFilter, TSort> | null {
  if (!customId.startsWith(expectedPrefix)) {
    return null;
  }

  const parts = customId.split(CUSTOM_ID_DELIMITER);
  // When `includeSort` is true, `minParts = 5` guarantees `parts[0]`
  // through `parts[4]` are all defined past this check — the sort block
  // below can access `parts[4]` without a defensive `=== undefined`
  // guard. When `includeSort` is false, `minParts = 4` guarantees
  // `parts[0]` through `parts[3]` (prefix, `browse`, page, filter) are
  // defined; query access at `parts[queryIndex]` is optional.
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
  //
  // When `includeSort: false`, this `sort` field is set to `validSorts[0]`
  // as an internal placeholder so the unified core shape
  // (`ParsedCoreResult`) stays consistent. The factory's public `parse`
  // wrappers strip this field before returning, so `includeSort: false`
  // callers never observe it — reading `.sort` on a `WithoutSort` parse
  // result is a TypeScript compile error AND the field is literally
  // absent at runtime (via object destructure at the factory boundary).
  let sort: TSort = config.validSorts[0];
  if (config.includeSort) {
    // `parts[4]` is guaranteed defined here — see the minParts check
    // above. Previous versions had a defensive `=== undefined` guard
    // here, but it was unreachable dead code and caused a coverage
    // miss. The single point of enforcement is the length check.
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
 * Fields common to both helper variants. Extracted to keep the two
 * variant interfaces in sync.
 */
interface BrowseCustomIdHelpersBase {
  /** Build customId for info button (disabled page indicator) */
  buildInfo: () => string;
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
 * Result of `createBrowseCustomIdHelpers` when `includeSort` is `true`
 * or omitted (the default). The `parse` / `parseSelect` functions
 * return results with a typed `sort` field.
 */
export interface BrowseCustomIdHelpersWithSort<
  TFilter extends string,
  TSort extends string = BrowseSortType,
> extends BrowseCustomIdHelpersBase {
  /** Build customId for browse pagination */
  build: (page: number, filter: TFilter, sort: TSort, query: string | null) => string;
  /** Build customId for browse select menu */
  buildSelect: (page: number, filter: TFilter, sort: TSort, query: string | null) => string;
  /** Parse browse customId (includes typed `sort` field) */
  parse: (customId: string) => ParsedBrowseCustomIdWithSort<TFilter, TSort> | null;
  /** Parse browse select customId (includes typed `sort` field) */
  parseSelect: (customId: string) => ParsedBrowseCustomIdWithSort<TFilter, TSort> | null;
}

/**
 * Result of `createBrowseCustomIdHelpers` when `includeSort: false`.
 * The `parse` / `parseSelect` functions return results WITHOUT a
 * `sort` field — reading `.sort` on the result is a TypeScript compile
 * error, and the field is also absent at runtime (stripped at the
 * factory boundary via object destructure).
 *
 * Note: the `build` / `buildSelect` signatures still take a `sort`
 * parameter (typed as `BrowseSortType`) for shape compatibility with
 * `buildBrowseButtons`, which expects a 4-arg `buildCustomId` callback.
 * The parameter is ignored at runtime — the customId format omits the
 * sort segment entirely when `includeSort: false`.
 */
export interface BrowseCustomIdHelpersWithoutSort<
  TFilter extends string,
> extends BrowseCustomIdHelpersBase {
  /** Build customId for browse pagination (sort arg is ignored) */
  build: (page: number, filter: TFilter, sort: BrowseSortType, query: string | null) => string;
  /** Build customId for browse select menu (sort arg is ignored) */
  buildSelect: (
    page: number,
    filter: TFilter,
    sort: BrowseSortType,
    query: string | null
  ) => string;
  /** Parse browse customId (no `sort` field in the result) */
  parse: (customId: string) => ParsedBrowseCustomIdWithoutSort<TFilter> | null;
  /** Parse browse select customId (no `sort` field in the result) */
  parseSelect: (customId: string) => ParsedBrowseCustomIdWithoutSort<TFilter> | null;
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
// Overload 1: standard BrowseSortType, `includeSort` true or omitted.
// `validSorts` is optional and defaults to ['name', 'date']. This is
// the common case — all callers that don't widen TSort and don't opt
// out of sort encoding match this signature.
export function createBrowseCustomIdHelpers<TFilter extends string>(
  config: BrowseCustomIdConfig<TFilter, BrowseSortType> & { includeSort?: true }
): BrowseCustomIdHelpersWithSort<TFilter, BrowseSortType>;

// Overload 2: custom TSort union, `includeSort` true or omitted.
// `validSorts` is REQUIRED. Catches the PR #773 footgun: a caller who
// widens TSort without passing matching validSorts would silently fall
// back to the default ['name', 'date'] cast at runtime, getting 'name'
// on every parse. The required parameter prevents that at compile time —
// admin/servers' `createBrowseCustomIdHelpers<_, 'members' | 'name'>({...})`
// must include `validSorts: ['members', 'name']` or TypeScript rejects it.
export function createBrowseCustomIdHelpers<TFilter extends string, TSort extends string>(
  config: Omit<BrowseCustomIdConfig<TFilter, TSort>, 'validSorts'> & {
    validSorts: readonly TSort[];
    includeSort?: true;
  }
): BrowseCustomIdHelpersWithSort<TFilter, TSort>;

// Overload 3: `includeSort: false`. The returned helpers have no `sort`
// field in parse results (TypeScript compile error to access), and the
// field is also stripped at runtime. TSort doesn't apply — the customId
// format omits the sort segment entirely — so this overload fixes TSort
// to BrowseSortType and treats validSorts as unused (optional).
//
// This overload is the Step 7 enforcement: previous versions returned a
// `validSorts[0]` placeholder for sort that callers were expected not to
// read, enforced via a file-content scan test. The discriminated return
// type makes the contract compile-time-checked — see
// `BrowseCustomIdHelpersWithoutSort` for details.
export function createBrowseCustomIdHelpers<TFilter extends string>(
  config: Omit<BrowseCustomIdConfig<TFilter, BrowseSortType>, 'validSorts'> & {
    includeSort: false;
    validSorts?: readonly BrowseSortType[];
  }
): BrowseCustomIdHelpersWithoutSort<TFilter>;

// Implementation signature (not visible to callers). Returns the union
// of both variants; the runtime branch on `config.includeSort` decides
// which shape is actually returned. Each call site's overload
// resolution narrows the return type correctly.
export function createBrowseCustomIdHelpers<
  TFilter extends string,
  TSort extends string = BrowseSortType,
>(
  config: BrowseCustomIdConfig<TFilter, TSort>
): BrowseCustomIdHelpersWithSort<TFilter, TSort> | BrowseCustomIdHelpersWithoutSort<TFilter> {
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

  const isBrowse = (customId: string): boolean =>
    customId.startsWith(browsePrefix + CUSTOM_ID_DELIMITER) || customId === browsePrefix;

  const isBrowseSelect = (customId: string): boolean =>
    customId.startsWith(browseSelectPrefix + CUSTOM_ID_DELIMITER) ||
    customId === browseSelectPrefix;

  if (includeSort) {
    // Sort IS encoded in the customId. Public parse returns the full
    // core result, typed as `ParsedBrowseCustomIdWithSort<TFilter, TSort>`.
    const parse = (customId: string): ParsedBrowseCustomIdWithSort<TFilter, TSort> | null =>
      parseCustomIdCore(customId, browsePrefix, parseConfig);

    const parseSelect = (customId: string): ParsedBrowseCustomIdWithSort<TFilter, TSort> | null =>
      parseCustomIdCore(customId, browseSelectPrefix, parseConfig);

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

  // `includeSort: false` branch. The core parser still populates `sort`
  // with the `validSorts[0]` placeholder internally (to keep the unified
  // core shape), but we strip it here via object destructure so callers
  // observe no `sort` field at runtime. Combined with the
  // `ParsedBrowseCustomIdWithoutSort` return type on overload 3, this
  // makes `.sort` access on the returned parse result both a compile
  // error AND a runtime `undefined`.
  const stripSort = (
    result: ParsedCoreResult<TFilter, TSort> | null
  ): ParsedBrowseCustomIdWithoutSort<TFilter> | null => {
    if (result === null) {
      return null;
    }
    // Destructure discards `sort`. The `_sort` variable is unused by
    // design — the point of the destructure is the rest-spread, not
    // the named capture.
    const { sort: _sort, ...withoutSort } = result;
    return withoutSort;
  };

  const parse = (customId: string): ParsedBrowseCustomIdWithoutSort<TFilter> | null =>
    stripSort(parseCustomIdCore(customId, browsePrefix, parseConfig));

  const parseSelect = (customId: string): ParsedBrowseCustomIdWithoutSort<TFilter> | null =>
    stripSort(parseCustomIdCore(customId, browseSelectPrefix, parseConfig));

  // The cast is needed because TypeScript can't correlate `includeSort
  // === false` with `TSort === BrowseSortType` at the implementation
  // signature's generic level. Overload 3 constrains TSort to
  // BrowseSortType for this branch, so the cast is sound at every call
  // site — same pattern as the `as unknown as readonly TSort[]` bridge
  // earlier in this file.
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
  } as unknown as BrowseCustomIdHelpersWithoutSort<TFilter>;
}
