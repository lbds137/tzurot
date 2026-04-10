/**
 * Browse Utilities Tests
 *
 * Tests for shared browse/list utilities including truncation,
 * pagination calculation, and customId builders/parsers.
 */

import { describe, it, expect } from 'vitest';
import {
  ITEMS_PER_PAGE,
  MAX_SELECT_LABEL_LENGTH,
  MAX_SELECT_DESCRIPTION_LENGTH,
  truncateForSelect,
  truncateForDescription,
  calculatePaginationState,
  createBrowseCustomIdHelpers,
  FOOTER_DELIMITER,
  joinFooter,
  pluralize,
  formatFilterLabeled,
  formatFilterParens,
  formatSortNatural,
  formatSortVerbatim,
  formatPageIndicator,
} from './index.js';

describe('Browse Constants', () => {
  it('should export expected constant values', () => {
    expect(ITEMS_PER_PAGE).toBe(10);
    expect(MAX_SELECT_LABEL_LENGTH).toBe(100);
    expect(MAX_SELECT_DESCRIPTION_LENGTH).toBe(100);
  });
});

describe('truncateForSelect', () => {
  it('should return text unchanged when under limit', () => {
    expect(truncateForSelect('Short text')).toBe('Short text');
  });

  it('should return text unchanged when exactly at limit', () => {
    const exactLength = 'a'.repeat(MAX_SELECT_LABEL_LENGTH);
    expect(truncateForSelect(exactLength)).toBe(exactLength);
  });

  it('should truncate and add ellipsis when over limit', () => {
    const longText = 'a'.repeat(MAX_SELECT_LABEL_LENGTH + 10);
    const result = truncateForSelect(longText);
    expect(result).toHaveLength(MAX_SELECT_LABEL_LENGTH);
    expect(result.endsWith('...')).toBe(true);
  });

  it('should respect custom maxLength parameter', () => {
    const result = truncateForSelect('Hello World', 8);
    expect(result).toBe('Hello...');
    expect(result).toHaveLength(8);
  });

  it('should handle empty string', () => {
    expect(truncateForSelect('')).toBe('');
  });

  it('should handle very short maxLength', () => {
    const result = truncateForSelect('Hello', 5);
    expect(result).toBe('Hello');
  });

  it('should handle maxLength exactly 3 (edge case for ellipsis)', () => {
    const result = truncateForSelect('Hello', 3);
    expect(result).toBe('...');
  });

  it('should accept options object', () => {
    const result = truncateForSelect('Hello World', { maxLength: 8 });
    expect(result).toBe('Hello...');
  });

  it('should strip newlines when requested', () => {
    const result = truncateForSelect('Line 1\nLine 2', { stripNewlines: true });
    expect(result).toBe('Line 1 Line 2');
  });

  it('should strip multiple newlines when requested', () => {
    const result = truncateForSelect('Line 1\n\n\nLine 2', { stripNewlines: true });
    expect(result).toBe('Line 1 Line 2');
  });

  it('should strip newlines and truncate', () => {
    const result = truncateForSelect('Short\nText', { maxLength: 8, stripNewlines: true });
    expect(result).toBe('Short...');
  });

  it('should trim whitespace after stripping newlines', () => {
    const result = truncateForSelect('  Text\n  ', { stripNewlines: true });
    expect(result).toBe('Text');
  });
});

describe('truncateForDescription', () => {
  it('should use MAX_SELECT_DESCRIPTION_LENGTH as default', () => {
    const longText = 'a'.repeat(MAX_SELECT_DESCRIPTION_LENGTH + 10);
    const result = truncateForDescription(longText);
    expect(result).toHaveLength(MAX_SELECT_DESCRIPTION_LENGTH);
    expect(result.endsWith('...')).toBe(true);
  });
});

describe('calculatePaginationState', () => {
  it('should calculate correct pagination for first page', () => {
    const result = calculatePaginationState(25, 10, 0);

    expect(result.page).toBe(0);
    expect(result.safePage).toBe(0);
    expect(result.totalPages).toBe(3);
    expect(result.totalItems).toBe(25);
    expect(result.itemsPerPage).toBe(10);
    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(10);
  });

  it('should calculate correct pagination for middle page', () => {
    const result = calculatePaginationState(25, 10, 1);

    expect(result.page).toBe(1);
    expect(result.startIndex).toBe(10);
    expect(result.endIndex).toBe(20);
  });

  it('should calculate correct pagination for last page with partial items', () => {
    const result = calculatePaginationState(25, 10, 2);

    expect(result.page).toBe(2);
    expect(result.startIndex).toBe(20);
    expect(result.endIndex).toBe(25);
  });

  it('should clamp page to valid range when too high', () => {
    const result = calculatePaginationState(25, 10, 99);

    expect(result.page).toBe(2);
    expect(result.safePage).toBe(2);
  });

  it('should clamp negative page to 0', () => {
    const result = calculatePaginationState(25, 10, -5);

    expect(result.page).toBe(0);
    expect(result.safePage).toBe(0);
  });

  it('should handle empty list', () => {
    const result = calculatePaginationState(0, 10, 0);

    expect(result.page).toBe(0);
    expect(result.totalPages).toBe(1);
    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(0);
  });

  it('should handle single item', () => {
    const result = calculatePaginationState(1, 10, 0);

    expect(result.totalPages).toBe(1);
    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(1);
  });

  it('should handle items exactly filling pages', () => {
    const result = calculatePaginationState(20, 10, 0);

    expect(result.totalPages).toBe(2);
  });
});

describe('createBrowseCustomIdHelpers', () => {
  const helpers = createBrowseCustomIdHelpers({
    prefix: 'test',
    validFilters: ['all', 'mine', 'public'] as const,
  });

  describe('build', () => {
    it('should build correct customId without query', () => {
      const result = helpers.build(0, 'all', 'date', null);
      expect(result).toBe('test::browse::0::all::date::');
    });

    it('should build correct customId with query', () => {
      const result = helpers.build(1, 'mine', 'name', 'search term');
      expect(result).toBe('test::browse::1::mine::name::search term');
    });

    it('should truncate long queries', () => {
      const longQuery = 'a'.repeat(100);
      const result = helpers.build(0, 'all', 'date', longQuery);
      expect(result).toContain('a'.repeat(50));
      expect(result).not.toContain('a'.repeat(51));
    });
  });

  describe('buildSelect', () => {
    it('should build correct select customId', () => {
      const result = helpers.buildSelect(2, 'public', 'date', 'query');
      expect(result).toBe('test::browse-select::2::public::date::query');
    });
  });

  describe('buildInfo', () => {
    it('should build correct info button customId', () => {
      const result = helpers.buildInfo();
      expect(result).toBe('test::browse::info');
    });
  });

  describe('parse', () => {
    it('should parse valid browse customId', () => {
      const result = helpers.parse('test::browse::1::mine::name::search');
      expect(result).toEqual({
        page: 1,
        filter: 'mine',
        sort: 'name',
        query: 'search',
      });
    });

    it('should parse customId without query', () => {
      const result = helpers.parse('test::browse::0::all::date::');
      expect(result).toEqual({
        page: 0,
        filter: 'all',
        sort: 'date',
        query: null,
      });
    });

    it('should return null for invalid prefix', () => {
      const result = helpers.parse('other::browse::0::all::date::');
      expect(result).toBeNull();
    });

    it('should return null for invalid filter', () => {
      const result = helpers.parse('test::browse::0::invalid::date::');
      expect(result).toBeNull();
    });

    it('should return null for non-numeric page', () => {
      const result = helpers.parse('test::browse::abc::all::date::');
      expect(result).toBeNull();
    });

    it('should return null for too few parts', () => {
      const result = helpers.parse('test::browse::0');
      expect(result).toBeNull();
    });
  });

  describe('parseSelect', () => {
    it('should parse valid select customId', () => {
      const result = helpers.parseSelect('test::browse-select::0::all::date::query');
      expect(result).toEqual({
        page: 0,
        filter: 'all',
        sort: 'date',
        query: 'query',
      });
    });

    it('should return null for browse customId (not select)', () => {
      const result = helpers.parseSelect('test::browse::0::all::date::');
      expect(result).toBeNull();
    });
  });

  describe('isBrowse', () => {
    it('should return true for browse customId', () => {
      expect(helpers.isBrowse('test::browse::0::all::date::')).toBe(true);
    });

    it('should return false for select customId', () => {
      expect(helpers.isBrowse('test::browse-select::0::all::date::')).toBe(false);
    });

    it('should return false for other customId', () => {
      expect(helpers.isBrowse('test::other::something')).toBe(false);
    });
  });

  describe('isBrowseSelect', () => {
    it('should return true for select customId', () => {
      expect(helpers.isBrowseSelect('test::browse-select::0::all::date::')).toBe(true);
    });

    it('should return false for browse customId', () => {
      expect(helpers.isBrowseSelect('test::browse::0::all::date::')).toBe(false);
    });
  });

  describe('round-trip build/parse', () => {
    it('should round-trip browse customId', () => {
      const original = { page: 5, filter: 'mine' as const, sort: 'name' as const, query: 'test' };
      const built = helpers.build(original.page, original.filter, original.sort, original.query);
      const parsed = helpers.parse(built);
      expect(parsed).toEqual(original);
    });

    it('should round-trip select customId', () => {
      const original = {
        page: 2,
        filter: 'public' as const,
        sort: 'date' as const,
        query: null,
      };
      const built = helpers.buildSelect(
        original.page,
        original.filter,
        original.sort,
        original.query
      );
      const parsed = helpers.parseSelect(built);
      expect(parsed).toEqual(original);
    });
  });

  describe('strict sort validation (symmetric with filter validation)', () => {
    // Before the "pre-existing is an explanation, not a reason to ignore"
    // fix, invalid sort values silently fell back to validSorts[0] instead
    // of rejecting the customId. The old behavior meant tampered or stale
    // customIds like `test::browse::0::all::invalid::` would parse as
    // sort='date' (first validSort) rather than being rejected — an
    // asymmetry with the filter field, which always hard-rejected invalids.
    // These tests lock in the new symmetric strict-rejection behavior.

    it('should reject customId with invalid sort value', () => {
      expect(helpers.parse('test::browse::0::all::invalid::')).toBeNull();
      expect(helpers.parse('test::browse::0::all::invalid::query')).toBeNull();
      // Filter rejection still works (regression guard for the symmetry)
      expect(helpers.parse('test::browse::0::invalid::date::')).toBeNull();
    });

    it('should reject select customId with invalid sort value', () => {
      expect(helpers.parseSelect('test::browse-select::0::all::invalid::')).toBeNull();
    });

    it('should reject customId with missing sort segment when includeSort is true', () => {
      // Malformed: browse format expects 5+ segments, only 4 provided.
      // The `parts.length < minParts` check at the top of parseCustomIdCore
      // is the sole point of enforcement for this case — the sort block
      // below that check can then access `parts[4]` without a defensive
      // undefined guard. (Previous rounds of this PR had a redundant
      // `parts[4] === undefined` guard inside the sort block; it was
      // unreachable dead code and was removed in round 8.)
      expect(helpers.parse('test::browse::0::all')).toBeNull();
    });
  });
});

describe('createBrowseCustomIdHelpers with custom TSort', () => {
  // Commands with custom sort unions (e.g., admin/servers uses 'members' | 'name'
  // instead of the standard 'name' | 'date') widen TSort. The factory has
  // two overloads: the default overload makes validSorts optional for the
  // standard BrowseSortType, and a second overload makes validSorts REQUIRED
  // when TSort is widened, to catch the footgun where a caller widens TSort
  // without providing a matching runtime validation list.

  it('builds and parses with a custom sort union', () => {
    const helpers = createBrowseCustomIdHelpers<'all', 'members' | 'name'>({
      prefix: 'admin-servers',
      validFilters: ['all'],
      validSorts: ['members', 'name'],
    });

    const customId = helpers.build(0, 'all', 'members', null);
    expect(customId).toBe('admin-servers::browse::0::all::members::');

    const parsed = helpers.parse(customId);
    expect(parsed).toEqual({ page: 0, filter: 'all', sort: 'members', query: null });
  });

  it('refuses to compile when TSort is widened without matching validSorts', () => {
    // This block is a compile-time assertion — the @ts-expect-error directive
    // will fail the build if the error it predicts ever goes away. The fact
    // that this test compiles AT ALL proves the overload is enforcing the
    // required-validSorts constraint on custom TSort.
    //
    // Note: the variable below IS consumed by the expect() call below, so
    // it deliberately does NOT use the `_`-prefix convention (which signals
    // "intentionally unused"). The runtime call still succeeds — overload
    // enforcement is purely compile-time — so the expect is a real runtime
    // check, not a lint workaround.
    // @ts-expect-error — widening TSort without validSorts must be rejected
    const helpersWithoutValidSorts = createBrowseCustomIdHelpers<'all', 'members' | 'name'>({
      prefix: 'bad',
      validFilters: ['all'],
    });
    expect(typeof helpersWithoutValidSorts).toBe('object');
  });
});

describe('createBrowseCustomIdHelpers without sort', () => {
  const helpers = createBrowseCustomIdHelpers({
    prefix: 'preset',
    validFilters: ['all', 'global', 'mine', 'free'] as const,
    includeSort: false,
  });

  it('should build customId without sort', () => {
    const result = helpers.build(0, 'all', 'date', null);
    expect(result).toBe('preset::browse::0::all::');
    expect(result).not.toContain('date');
  });

  it('should parse customId without sort', () => {
    const result = helpers.parse('preset::browse::0::global::query');
    // Step 7: `includeSort: false` callers get a discriminated
    // `ParsedBrowseCustomIdWithoutSort` variant — no `sort` field,
    // neither at the type level nor at runtime. Previous versions
    // returned a `validSorts[0]` placeholder with a "don't read this"
    // contract; the discriminated return type makes reading `.sort`
    // a compile error AND the field is stripped at runtime.
    expect(result).toEqual({
      page: 0,
      filter: 'global',
      query: 'query',
    });
    expect(Object.hasOwn(result ?? {}, 'sort')).toBe(false);
  });

  it('should build select customId without sort', () => {
    // Parallel to the `build` test above — `buildSelect` must also honor
    // includeSort: false by omitting the sort segment. Without this test,
    // the `if (includeSort)` branch in `buildSelect` was uncovered (the
    // `build` variant is tested above but buildSelect was not).
    const result = helpers.buildSelect(0, 'all', 'date', null);
    expect(result).toBe('preset::browse-select::0::all::');
    expect(result).not.toContain('date');
  });
});

describe('includeSort: false discriminated return type (Step 7)', () => {
  // The previous "includeSort: false contract" block in this file
  // (PR #773 rounds 4-5) enforced via a file-content scan that callers
  // never read `parsed.sort` when `includeSort: false`. Step 7 replaces
  // that enforcement with a type-level split: `createBrowseCustomIdHelpers`
  // now returns `BrowseCustomIdHelpersWithoutSort<TFilter>` for the
  // includeSort-false case, and its `parse`/`parseSelect` return a
  // `ParsedBrowseCustomIdWithoutSort<TFilter>` that has NO `sort`
  // field at all — reading it is a TypeScript compile error AND the
  // field is stripped at runtime via object destructure.
  //
  // This describe block has two tests:
  // 1. Runtime strip: a real parse result has no `sort` property (via
  //    `Object.hasOwn`). This catches regressions where someone tries
  //    to optimize away the strip destructure at runtime.
  // 2. Compile-time error: a caller that tries to read `.sort` on an
  //    includeSort-false parse result fails to compile. Uses the same
  //    `ts-expect-error` pattern as the other compile-time assertions
  //    in this file (see `createBrowseCustomIdHelpers with custom TSort`
  //    and the `buildBrowseButtons` generic tests).

  const withoutSortHelpers = createBrowseCustomIdHelpers({
    prefix: 'test-no-sort',
    validFilters: ['all'] as const,
    includeSort: false,
  });

  it('parse result has no sort property at runtime (stripped via destructure)', () => {
    const result = withoutSortHelpers.parse('test-no-sort::browse::0::all::');
    expect(result).not.toBeNull();
    // Object.hasOwn is the correct check for "field literally absent",
    // stronger than `result.sort === undefined` which would be true for
    // a field that exists with value undefined.
    expect(Object.hasOwn(result ?? {}, 'sort')).toBe(false);
    // Non-sort fields are still present
    expect(result?.page).toBe(0);
    expect(result?.filter).toBe('all');
  });

  it('parseSelect result also strips sort at runtime', () => {
    const result = withoutSortHelpers.parseSelect('test-no-sort::browse-select::2::all::');
    expect(result).not.toBeNull();
    expect(Object.hasOwn(result ?? {}, 'sort')).toBe(false);
    expect(result?.page).toBe(2);
  });

  it('reading .sort on an includeSort: false parse result is a compile error', () => {
    // Compile-time assertion via `ts-expect-error` directive. If the
    // discriminated return type is accidentally relaxed (e.g.,
    // `BrowseCustomIdHelpersWithoutSort` regains a `sort` field),
    // this directive stops catching an error and the build fails.
    //
    // The variable IS consumed by the expect below — the `_`-prefix
    // convention deliberately does NOT apply here because the runtime
    // access succeeds (returns `undefined`), and we want the runtime
    // value to participate in the assertion.
    const parsed = withoutSortHelpers.parse('test-no-sort::browse::0::all::');
    if (parsed === null) {
      throw new Error('parse should succeed for valid input');
    }
    // @ts-expect-error — `.sort` is absent on ParsedBrowseCustomIdWithoutSort
    const shouldNotCompile: string | undefined = parsed.sort;
    // Runtime value is undefined because the field was stripped.
    expect(shouldNotCompile).toBeUndefined();
  });
});

import type { APIButtonComponentWithCustomId } from 'discord.js';

describe('buildBrowseButtons', async () => {
  // Import dynamically to avoid hoisting issues
  const { buildBrowseButtons, buildSimplePaginationButtons } = await import('./buttonBuilder.js');
  const { ButtonStyle } = await import('discord.js');

  // Helper to type-narrow button data for assertions
  function getButtonData(button: { toJSON: () => unknown }): APIButtonComponentWithCustomId {
    return button.toJSON() as APIButtonComponentWithCustomId;
  }

  const baseConfig = {
    currentPage: 1,
    totalPages: 5,
    filter: 'all' as const,
    currentSort: 'date' as const,
    query: null,
    buildCustomId: (page: number, filter: string, sort: string, query: string | null) =>
      `test::browse::${page}::${filter}::${sort}::${query ?? ''}`,
    buildInfoId: () => 'test::browse::info',
  };

  describe('button structure', () => {
    it('should create row with 4 buttons when sort toggle enabled', () => {
      const row = buildBrowseButtons(baseConfig);
      const buttons = row.components;

      expect(buttons).toHaveLength(4);
    });

    it('should create row with 3 buttons when sort toggle disabled', () => {
      const row = buildBrowseButtons({ ...baseConfig, showSortToggle: false });
      const buttons = row.components;

      expect(buttons).toHaveLength(3);
    });
  });

  describe('previous button', () => {
    it('should be enabled on middle page', () => {
      const row = buildBrowseButtons({ ...baseConfig, currentPage: 2 });
      const prevButton = row.components[0];
      const buttonData = getButtonData(prevButton);

      expect(buttonData.disabled).toBe(false);
      expect(buttonData.custom_id).toBe('test::browse::1::all::date::');
    });

    it('should be disabled on first page', () => {
      const row = buildBrowseButtons({ ...baseConfig, currentPage: 0 });
      const prevButton = row.components[0];
      const buttonData = getButtonData(prevButton);

      expect(buttonData.disabled).toBe(true);
    });
  });

  describe('page indicator', () => {
    it('should show correct page number', () => {
      const row = buildBrowseButtons({ ...baseConfig, currentPage: 2 });
      const infoButton = row.components[1];
      const buttonData = getButtonData(infoButton);

      expect(buttonData.label).toBe('Page 3 of 5');
      expect(buttonData.disabled).toBe(true);
      expect(buttonData.custom_id).toBe('test::browse::info');
    });
  });

  describe('next button', () => {
    it('should be enabled on middle page', () => {
      const row = buildBrowseButtons({ ...baseConfig, currentPage: 2 });
      const nextButton = row.components[2];
      const buttonData = getButtonData(nextButton);

      expect(buttonData.disabled).toBe(false);
      expect(buttonData.custom_id).toBe('test::browse::3::all::date::');
    });

    it('should be disabled on last page', () => {
      const row = buildBrowseButtons({ ...baseConfig, currentPage: 4 });
      const nextButton = row.components[2];
      const buttonData = getButtonData(nextButton);

      expect(buttonData.disabled).toBe(true);
    });
  });

  describe('sort toggle button', () => {
    it('should toggle from date to name sort', () => {
      const row = buildBrowseButtons({ ...baseConfig, currentSort: 'date' });
      const sortButton = row.components[3];
      const buttonData = getButtonData(sortButton);

      expect(buttonData.custom_id).toContain('::name::');
      expect(buttonData.label).toBe('Sort A-Z');
      expect(buttonData.emoji?.name).toBe('🔤');
      expect(buttonData.style).toBe(ButtonStyle.Primary);
    });

    it('should toggle from name to date sort', () => {
      const row = buildBrowseButtons({ ...baseConfig, currentSort: 'name' });
      const sortButton = row.components[3];
      const buttonData = getButtonData(sortButton);

      expect(buttonData.custom_id).toContain('::date::');
      expect(buttonData.label).toBe('Sort by Date');
      expect(buttonData.emoji?.name).toBe('📅');
    });
  });

  describe('createBrowseSortToggle helper', () => {
    // Imported via the dynamic import at the top of the parent describe,
    // but Node can't destructure an async import at that depth — re-import
    // here. The overhead is negligible (cached) and keeps this block
    // self-contained.
    it('returns default labels when no overrides given', async () => {
      const { createBrowseSortToggle } = await import('./buttonBuilder.js');
      const toggle = createBrowseSortToggle();

      expect(toggle.next('date')).toBe('name');
      expect(toggle.next('name')).toBe('date');
      expect(toggle.labelFor('name')).toEqual({ label: 'Sort A-Z', emoji: '🔤' });
      expect(toggle.labelFor('date')).toEqual({ label: 'Sort by Date', emoji: '📅' });
    });

    it('overrides sortByName while preserving sortByDate default', async () => {
      const { createBrowseSortToggle } = await import('./buttonBuilder.js');
      const toggle = createBrowseSortToggle({
        sortByName: { label: 'Sort by ID', emoji: '🆔' },
      });

      expect(toggle.labelFor('name')).toEqual({ label: 'Sort by ID', emoji: '🆔' });
      // sortByDate untouched
      expect(toggle.labelFor('date')).toEqual({ label: 'Sort by Date', emoji: '📅' });
    });

    it('overrides both sortByName and sortByDate', async () => {
      const { createBrowseSortToggle } = await import('./buttonBuilder.js');
      const toggle = createBrowseSortToggle({
        sortByName: { label: 'ABC', emoji: '🔠' },
        sortByDate: { label: 'Recent', emoji: '🕒' },
      });

      expect(toggle.labelFor('name')).toEqual({ label: 'ABC', emoji: '🔠' });
      expect(toggle.labelFor('date')).toEqual({ label: 'Recent', emoji: '🕒' });
    });

    it('custom labels flow through buildBrowseButtons when TSort = BrowseSortType', async () => {
      const { createBrowseSortToggle } = await import('./buttonBuilder.js');
      const row = buildBrowseButtons({
        ...baseConfig,
        currentSort: 'date',
        sortToggle: createBrowseSortToggle({
          sortByName: { label: 'ABC', emoji: '🔠' },
        }),
      });
      const sortButton = row.components[3];
      const buttonData = getButtonData(sortButton);

      // currentSort is 'date', so the button shows the label for the
      // NEXT sort ('name'), which is our overridden 'ABC' label.
      expect(buttonData.label).toBe('ABC');
      expect(buttonData.emoji?.name).toBe('🔠');
      expect(buttonData.custom_id).toContain('::name::');
    });
  });

  describe('custom TSort path (generic)', () => {
    // These tests exercise the second overload where TSort is widened
    // beyond BrowseSortType. The factory requires sortToggle in this
    // case — the compile-time assertion test below enforces that via
    // a `@ts-expect-error` directive (backticks intentional — without
    // them, TypeScript would treat the comment itself as a real
    // suppression directive and complain about it being unused).

    type CustomSort = 'priority' | 'alpha' | 'recent';

    const customConfig = {
      currentPage: 0,
      totalPages: 3,
      filter: 'all' as const,
      currentSort: 'priority' as CustomSort,
      query: null,
      buildCustomId: (page: number, filter: string, sort: string, query: string | null) =>
        `custom::browse::${page}::${filter}::${sort}::${query ?? ''}`,
      buildInfoId: () => 'custom::browse::info',
    };

    it('uses caller-provided sortToggle for a 3-element cycle', () => {
      // 3-element cycle demonstrates the generic handles more than the
      // binary toggle that `BrowseSortType` supports.
      const cycle: CustomSort[] = ['priority', 'alpha', 'recent'];
      const sortToggle = {
        next: (current: CustomSort): CustomSort => {
          const idx = cycle.indexOf(current);
          return cycle[(idx + 1) % cycle.length];
        },
        labelFor: (sort: CustomSort) =>
          ({
            priority: { label: 'By Priority', emoji: '⭐' },
            alpha: { label: 'A-Z', emoji: '🔤' },
            recent: { label: 'Recent', emoji: '🕒' },
          })[sort],
      };

      const row = buildBrowseButtons<'all', CustomSort>({
        ...customConfig,
        sortToggle,
      });
      const sortButton = row.components[3];
      const buttonData = getButtonData(sortButton);

      // currentSort is 'priority', next is 'alpha', label is 'A-Z'
      expect(buttonData.custom_id).toContain('::alpha::');
      expect(buttonData.label).toBe('A-Z');
      expect(buttonData.emoji?.name).toBe('🔤');
    });

    it('advances through the cycle on repeated toggles', () => {
      const cycle: CustomSort[] = ['priority', 'alpha', 'recent'];
      const sortToggle = {
        next: (current: CustomSort): CustomSort => {
          const idx = cycle.indexOf(current);
          return cycle[(idx + 1) % cycle.length];
        },
        labelFor: (sort: CustomSort) =>
          ({
            priority: { label: 'By Priority', emoji: '⭐' },
            alpha: { label: 'A-Z', emoji: '🔤' },
            recent: { label: 'Recent', emoji: '🕒' },
          })[sort],
      };

      // Start at 'alpha' — next should be 'recent'
      const rowFromAlpha = buildBrowseButtons<'all', CustomSort>({
        ...customConfig,
        currentSort: 'alpha',
        sortToggle,
      });
      expect(getButtonData(rowFromAlpha.components[3]).custom_id).toContain('::recent::');
      expect(getButtonData(rowFromAlpha.components[3]).label).toBe('Recent');

      // Start at 'recent' — next should wrap to 'priority'
      const rowFromRecent = buildBrowseButtons<'all', CustomSort>({
        ...customConfig,
        currentSort: 'recent',
        sortToggle,
      });
      expect(getButtonData(rowFromRecent.components[3]).custom_id).toContain('::priority::');
      expect(getButtonData(rowFromRecent.components[3]).label).toBe('By Priority');
    });

    it('refuses to compile when TSort is widened without matching sortToggle', () => {
      // Compile-time assertion: the second overload requires `sortToggle`
      // when TSort is widened beyond BrowseSortType. If the overload is
      // accidentally relaxed (e.g., sortToggle becomes optional on
      // overload 2), this `@ts-expect-error` stops being an error and
      // the build fails.
      //
      // Mirrors the parallel assertion for `createBrowseCustomIdHelpers`
      // in the 'createBrowseCustomIdHelpers with custom TSort' describe
      // block earlier in this file. Same pattern, same rationale: catch
      // the footgun at compile time rather than at runtime (where a
      // missing sortToggle would silently fall back to the default
      // BrowseSortType toggle — wrong behavior for non-BrowseSortType
      // callers).
      //
      // The config is inlined (not the `customConfig` fixture) because
      // TypeScript's overload resolution needs precisely-typed literals
      // to discriminate between overload 1 (BrowseSortType) and overload
      // 2 (custom TSort). The fixture's `sort: string` / `filter: string`
      // parameters on `buildCustomId` are too loose — the inlined form
      // lets TypeScript infer against the narrow types the overloads
      // actually constrain.
      //
      // The variable IS consumed by the expect below, so it deliberately
      // does NOT use the `_`-prefix convention (which signals
      // "intentionally unused"). The runtime call still succeeds —
      // overload enforcement is purely compile-time.
      // @ts-expect-error — widening TSort without sortToggle must be rejected
      const buttonsWithoutSortToggle = buildBrowseButtons<'all', CustomSort>({
        currentPage: 0,
        totalPages: 3,
        filter: 'all',
        currentSort: 'priority',
        query: null,
        buildCustomId: (page: number, _filter: 'all', sort: CustomSort, query: string | null) =>
          `custom::browse::${page}::all::${sort}::${query ?? ''}`,
        buildInfoId: () => 'custom::browse::info',
      });
      expect(buttonsWithoutSortToggle.components.length).toBeGreaterThan(0);
    });
  });

  describe('query preservation', () => {
    it('should include query in customIds', () => {
      const row = buildBrowseButtons({ ...baseConfig, query: 'search term' });
      const prevButton = row.components[0];
      const buttonData = getButtonData(prevButton);

      expect(buttonData.custom_id).toBe('test::browse::0::all::date::search term');
    });
  });

  describe('buildSimplePaginationButtons', () => {
    it('should create pagination without sort toggle', () => {
      const row = buildSimplePaginationButtons(baseConfig);
      const buttons = row.components;

      expect(buttons).toHaveLength(3);
    });
  });
});

// ============================================================================
// Footer Helpers
// ============================================================================

describe('FOOTER_DELIMITER', () => {
  it('should be a bullet with surrounding spaces', () => {
    expect(FOOTER_DELIMITER).toBe(' \u2022 ');
  });
});

describe('joinFooter', () => {
  it('should join string segments with the standard delimiter', () => {
    expect(joinFooter('a', 'b', 'c')).toBe('a \u2022 b \u2022 c');
  });

  it('should filter out null, undefined, false, and empty strings', () => {
    expect(joinFooter('a', null, 'b', undefined, 'c', false, '', 'd')).toBe(
      'a \u2022 b \u2022 c \u2022 d'
    );
  });

  it('should filter out numeric values (guards against 0 leaking from && short-circuit)', () => {
    // Note: do NOT use `count && pluralize(count, noun)` — when count is 0,
    // && short-circuits to 0 which is silently dropped. Use a boolean guard
    // like `count > 0 && pluralize(count, noun)` instead.
    expect(joinFooter(0, 'b', 'c')).toBe('b \u2022 c');
  });

  it('should filter out boolean true', () => {
    expect(joinFooter(true, 'a')).toBe('a');
  });

  it('should return empty string when all segments are falsy or non-string', () => {
    expect(joinFooter(null, undefined, false, 0)).toBe('');
  });

  it('should return empty string when called with no arguments', () => {
    expect(joinFooter()).toBe('');
  });

  it('should return a single segment without delimiter', () => {
    expect(joinFooter('only')).toBe('only');
  });
});

describe('pluralize', () => {
  const noun = { singular: 'item', plural: 'items' };

  it('should return singular for count === 1', () => {
    expect(pluralize(1, noun)).toBe('1 item');
  });

  it('should return plural for count === 0', () => {
    expect(pluralize(0, noun)).toBe('0 items');
  });

  it('should return plural for count > 1', () => {
    expect(pluralize(5, noun)).toBe('5 items');
  });

  it('should work with irregular nouns', () => {
    expect(pluralize(1, { singular: 'entry', plural: 'entries' })).toBe('1 entry');
    expect(pluralize(3, { singular: 'entry', plural: 'entries' })).toBe('3 entries');
  });
});

describe('formatFilterLabeled', () => {
  it('should format with "filtered by:" prefix', () => {
    expect(formatFilterLabeled('mine')).toBe('filtered by: mine');
  });
});

describe('formatFilterParens', () => {
  it('should wrap in parentheses', () => {
    expect(formatFilterParens('all types')).toBe('(all types)');
  });

  it('should handle filter-specific values', () => {
    expect(formatFilterParens('users only')).toBe('(users only)');
  });
});

describe('formatSortNatural', () => {
  it('should prefix with "Sorted by"', () => {
    expect(formatSortNatural('date')).toBe('Sorted by date');
  });

  it('should work with multi-word labels', () => {
    expect(formatSortNatural('member count')).toBe('Sorted by member count');
  });
});

describe('formatSortVerbatim', () => {
  it('should return the phrase verbatim', () => {
    expect(formatSortVerbatim('Newest first')).toBe('Newest first');
  });

  it('should pass through "Sorted alphabetically" unchanged', () => {
    expect(formatSortVerbatim('Sorted alphabetically')).toBe('Sorted alphabetically');
  });
});

describe('formatPageIndicator', () => {
  it('should format as "Page X of Y"', () => {
    expect(formatPageIndicator(2, 5)).toBe('Page 2 of 5');
  });

  it('should append + when hasMore is true', () => {
    expect(formatPageIndicator(1, 3, { hasMore: true })).toBe('Page 1 of 3+');
  });

  it('should not append + when hasMore is false', () => {
    expect(formatPageIndicator(1, 3, { hasMore: false })).toBe('Page 1 of 3');
  });

  it('should not append + when options are omitted', () => {
    expect(formatPageIndicator(1, 3)).toBe('Page 1 of 3');
  });
});

describe('footer composition patterns', () => {
  it('should produce character/browse style footer', () => {
    expect(
      joinFooter(
        pluralize(5, { singular: 'character', plural: 'characters' }),
        formatFilterLabeled('mine'),
        formatSortNatural('date'),
        '\uD83C\uDF10 Public \uD83D\uDD12 Private'
      )
    ).toBe(
      '5 characters \u2022 filtered by: mine \u2022 Sorted by date \u2022 \uD83C\uDF10 Public \uD83D\uDD12 Private'
    );
  });

  it('should produce character/browse singular footer', () => {
    expect(
      joinFooter(
        pluralize(1, { singular: 'character', plural: 'characters' }),
        formatSortNatural('date'),
        '\uD83C\uDF10 Public \uD83D\uDD12 Private'
      )
    ).toBe('1 character \u2022 Sorted by date \u2022 \uD83C\uDF10 Public \uD83D\uDD12 Private');
  });

  it('should produce inspect/browse style footer (page-first)', () => {
    expect(
      joinFooter(
        formatPageIndicator(2, 5),
        pluralize(42, { singular: 'total log', plural: 'total logs' }),
        'Select a log below to inspect'
      )
    ).toBe('Page 2 of 5 \u2022 42 total logs \u2022 Select a log below to inspect');
  });

  it('should produce memory/search style footer (no count, hasMore)', () => {
    expect(
      joinFooter('Semantic search', 'Filtered', formatPageIndicator(1, 3, { hasMore: true }))
    ).toBe('Semantic search \u2022 Filtered \u2022 Page 1 of 3+');
  });

  it('should produce admin/servers style footer (custom count string)', () => {
    expect(joinFooter('12.5K total members', formatSortNatural('member count'))).toBe(
      '12.5K total members \u2022 Sorted by member count'
    );
  });

  it('should handle conditional filter with && pattern', () => {
    const filter = 'all';
    expect(
      joinFooter(
        pluralize(10, { singular: 'character', plural: 'characters' }),
        filter !== 'all' && formatFilterLabeled(filter),
        formatSortNatural('date')
      )
    ).toBe('10 characters \u2022 Sorted by date');
  });
});
