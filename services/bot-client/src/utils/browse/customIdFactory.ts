/**
 * Browse CustomId Factory
 *
 * Factory functions for creating type-safe customId builders and parsers
 * for browse commands. Built on `defineCustomIdFamily`
 * (`../customIdFamily.js`) — that module owns segment encoding, delimiter
 * safety, and the Discord customId length ceiling; this factory wraps it
 * into the browse-specific typed interfaces below.
 *
 * Pattern: {command}::browse::{page}::{filter}::{sort}::{query}
 */

import { CUSTOM_ID_DELIMITER, defineCustomIdFamily, seg } from '../customIdFamily.js';
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
 * Encode a free-text browse query for the customId wire format.
 *
 * Collapses any run of 2+ colons to a single colon before truncating. A
 * free-text query is the one user-typed segment in a browse customId, and
 * the family builder (`defineCustomIdFamily`) throws when an encoded
 * segment contains the `::` delimiter. The OLD hand-rolled parser emitted a
 * `::`-bearing query verbatim and then silently read back only the text
 * before the first `::` on parse — so this collapse changes bytes ONLY for
 * inputs that never round-tripped correctly under that implementation
 * either. Pinned by a test in customIdFactory.test.ts.
 */
function encodeQuery(query: string | null): string {
  if (query === null) {
    return truncateQuery(null);
  }
  return truncateQuery(query.replace(/:{2,}/g, ':'));
}

const queryCodec = {
  encode: (q: string | null): string => encodeQuery(q),
  decode: (raw: string): string | null => (raw === '' ? null : raw),
};

/** The family action name for the browse-select variant; kept as one
 * constant to avoid repeating the quoted literal (`sonarjs/no-duplicate-string`).
 */
const BROWSE_SELECT_ACTION = 'browse-select';

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
 * Fields shared by both helper variants: the two prefix strings, the
 * info-button builder, and the browse/browse-select predicates. `is` is the
 * owning branch's `family.is` — its `is.browse`/`is['browse-select']`
 * predicates are behaviorally identical to the hand-rolled
 * `startsWith(prefix + '::') || === prefix` checks this used to build
 * locally (same `::`-suffix semantics that stop `browse` from matching
 * `browse-select`), so this reuses them instead of re-declaring them.
 */
function createBaseHelpers(
  prefix: string,
  is: { browse: (customId: string) => boolean; 'browse-select': (customId: string) => boolean }
): BrowseCustomIdHelpersBase {
  const browsePrefix = `${prefix}${CUSTOM_ID_DELIMITER}browse`;
  const browseSelectPrefix = `${prefix}${CUSTOM_ID_DELIMITER}browse-select`;

  return {
    browsePrefix,
    browseSelectPrefix,
    buildInfo: (): string => `${browsePrefix}${CUSTOM_ID_DELIMITER}info`,
    isBrowse: is.browse,
    isBrowseSelect: is[BROWSE_SELECT_ACTION],
  };
}

/**
 * Build the `includeSort: true` (default) variant. One family per branch —
 * the with-sort and without-sort action maps declare different segment
 * tuples, so this function (and `createWithoutSortHelpers` below) each
 * define their own `family` const with a concrete (non-union) type.
 */
function createWithSortHelpers<TFilter extends string, TSort extends string>(
  prefix: string,
  validFilters: readonly TFilter[],
  validSorts: readonly TSort[]
): BrowseCustomIdHelpersWithSort<TFilter, TSort> {
  const filterSeg = seg.enum('filter', validFilters);
  const querySeg = seg.optional(seg.codec('query', queryCodec));

  const family = defineCustomIdFamily(prefix, {
    browse: [seg.int('page'), filterSeg, seg.enum('sort', validSorts), querySeg],
    [BROWSE_SELECT_ACTION]: [seg.int('page'), filterSeg, seg.enum('sort', validSorts), querySeg],
  });

  const base = createBaseHelpers(prefix, family.is);

  const build = (page: number, filter: TFilter, sort: TSort, query: string | null): string =>
    family.build.browse(page, filter, sort, query);

  const buildSelect = (page: number, filter: TFilter, sort: TSort, query: string | null): string =>
    family.build[BROWSE_SELECT_ACTION](page, filter, sort, query);

  const parse = (customId: string): ParsedBrowseCustomIdWithSort<TFilter, TSort> | null => {
    const p = family.parse(customId);
    if (p?.action !== 'browse') {
      return null;
    }
    return { page: p.page, filter: p.filter, sort: p.sort, query: p.query ?? null };
  };

  const parseSelect = (customId: string): ParsedBrowseCustomIdWithSort<TFilter, TSort> | null => {
    const p = family.parse(customId);
    if (p?.action !== BROWSE_SELECT_ACTION) {
      return null;
    }
    return { page: p.page, filter: p.filter, sort: p.sort, query: p.query ?? null };
  };

  return { ...base, build, buildSelect, parse, parseSelect };
}

/**
 * Build the `includeSort: false` variant. The family's action map omits the
 * sort segment entirely, so the wire format never carries it and the
 * parsed result never carries a `sort` key (neither at the type level via
 * `ParsedBrowseCustomIdWithoutSort`, nor at runtime).
 *
 * No cast is needed on the returned object (unlike the original hand-rolled
 * implementation): `build`/`buildSelect`/`parse`/`parseSelect` below are
 * already typed concretely against `BrowseCustomIdHelpersWithoutSort<TFilter>`'s
 * member signatures, since `family` here is this function's own
 * (non-generic-union) type rather than a shared `TSort`-parameterized one.
 */
function createWithoutSortHelpers<TFilter extends string>(
  prefix: string,
  validFilters: readonly TFilter[]
): BrowseCustomIdHelpersWithoutSort<TFilter> {
  const filterSeg = seg.enum('filter', validFilters);
  const querySeg = seg.optional(seg.codec('query', queryCodec));

  const family = defineCustomIdFamily(prefix, {
    browse: [seg.int('page'), filterSeg, querySeg],
    [BROWSE_SELECT_ACTION]: [seg.int('page'), filterSeg, querySeg],
  });

  const base = createBaseHelpers(prefix, family.is);

  const build = (
    page: number,
    filter: TFilter,
    _sort: BrowseSortType,
    query: string | null
  ): string => family.build.browse(page, filter, query);

  const buildSelect = (
    page: number,
    filter: TFilter,
    _sort: BrowseSortType,
    query: string | null
  ): string => family.build[BROWSE_SELECT_ACTION](page, filter, query);

  const parse = (customId: string): ParsedBrowseCustomIdWithoutSort<TFilter> | null => {
    const p = family.parse(customId);
    if (p?.action !== 'browse') {
      return null;
    }
    return { page: p.page, filter: p.filter, query: p.query ?? null };
  };

  const parseSelect = (customId: string): ParsedBrowseCustomIdWithoutSort<TFilter> | null => {
    const p = family.parse(customId);
    if (p?.action !== BROWSE_SELECT_ACTION) {
      return null;
    }
    return { page: p.page, filter: p.filter, query: p.query ?? null };
  };

  return { ...base, build, buildSelect, parse, parseSelect };
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

  if (includeSort) {
    return createWithSortHelpers(prefix, validFilters, validSorts);
  }
  return createWithoutSortHelpers(prefix, validFilters);
}
