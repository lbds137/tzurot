/**
 * Browse Utilities Tests
 *
 * Tests for shared browse/list utilities including truncation,
 * pagination calculation, and customId builders/parsers.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ITEMS_PER_PAGE,
  MAX_SELECT_LABEL_LENGTH,
  MAX_SELECT_DESCRIPTION_LENGTH,
  truncateForSelect,
  truncateForDescription,
  calculatePaginationState,
  createBrowseCustomIdHelpers,
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
    expect(result).toEqual({
      page: 0,
      filter: 'global',
      // Default fallback when sort isn't encoded — uses validSorts[0]
      // ('name' in the default config). When `includeSort: false`, the
      // caller has explicitly opted out of sort encoding and should not
      // rely on this default for anything observable.
      sort: 'name',
      query: 'query',
    });
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

describe('includeSort: false contract', () => {
  // Mechanical enforcement of the contract documented on
  // `ParsedBrowseCustomId.sort` and in `parseCustomIdCore`: when a helper
  // is created with `includeSort: false`, the parsed `sort` field is an
  // arbitrary placeholder (`validSorts[0]`) and MUST NOT be read by callers.
  //
  // PR #773 round 4 replaced a commit-message-documented grep audit with
  // this test after round 4's own exhaustiveness check caught a 5th
  // caller (`settings/voices/browse.ts`) that the round-2 grep missed
  // because it was added later. As of that round there are 5 callers;
  // see `INCLUDE_SORT_FALSE_CALLERS` below for the authoritative list
  // (the exhaustiveness test further down keeps that list honest).
  //
  // Why a file-content scan and not a type-level check: TypeScript can't
  // express "this field is a placeholder" — the field has to have *some*
  // type. Runtime checks can't distinguish "deliberately reading the
  // placeholder" from "accidentally reading it." A lint rule would work
  // but adds infrastructure. A targeted test run against the known
  // caller set is the simplest durable enforcement.
  const INCLUDE_SORT_FALSE_CALLERS = [
    '../../commands/preset/browse.ts',
    '../../commands/inspect/browse.ts',
    '../../commands/memory/browse.ts',
    '../../commands/memory/search.ts',
    '../../commands/settings/voices/browse.ts',
  ] as const;

  // Resolve caller paths relative to this test file. ESM doesn't have
  // __dirname, so we derive it from import.meta.url.
  const thisDir = dirname(fileURLToPath(import.meta.url));

  // Variable names that conventionally hold a `browseHelpers.parse(...)` or
  // `browseHelpers.parseSelect(...)` result in this codebase. The regex is
  // deliberately narrower than a blanket `\.sort\b` so that legitimate
  // `Array.prototype.sort()` calls on arbitrary local variables don't trip
  // the contract — memory/browse.ts in particular might plausibly need to
  // sort a local memory list in the future, and that shouldn't fail this
  // test.
  //
  // The trade-off: if a future caller stores a parse result in a variable
  // whose name isn't in this list (e.g., `const x = helpers.parse(...)`
  // followed by `x.sort`), the check will miss it. Mitigations:
  // 1. The exhaustiveness test below keeps the caller set explicit, so
  //    new `includeSort: false` callers get code review that should
  //    catch an unusual variable name.
  // 2. The JSDoc on `ParsedBrowseCustomId.sort` documents the contract,
  //    so a reviewer seeing `x.sort` has a clear reference to flag.
  // 3. Adding a new name to this list is a one-line fix and the failure
  //    is local, so future-maintenance cost is bounded.
  const PARSE_RESULT_VAR_NAMES =
    '(?:parsed|parseResult|browseContext|browseResult|customIdParsed|browseData|browseParsed)';
  const PARSE_RESULT_SORT_ACCESS_RE = new RegExp(`\\b${PARSE_RESULT_VAR_NAMES}\\.sort\\b`);

  it.each(INCLUDE_SORT_FALSE_CALLERS)(
    '%s must not read .sort on a parsed browse result',
    caller => {
      const filePath = resolve(thisDir, caller);
      const content = readFileSync(filePath, 'utf-8');

      const match = PARSE_RESULT_SORT_ACCESS_RE.exec(content);
      expect(
        match,
        `${caller} contains \`${match?.[0] ?? '<none>'}\` — reading .sort ` +
          `on a parsed browse result violates the includeSort: false contract. ` +
          `If this is intentional (e.g., you just added a new caller that ` +
          `DOES use sort), either switch to \`includeSort: true\` or remove ` +
          `this file from INCLUDE_SORT_FALSE_CALLERS.`
      ).toBeNull();
    }
  );

  it('regex sanity check: detects violations, ignores Array.sort on other names', () => {
    // Meta-test: verify the narrowed regex actually does what we want. If
    // someone accidentally breaks the alternation list (typo, regex escape
    // error), this test fails loudly instead of silently passing the
    // per-caller checks above.
    const violations = [
      'const sort = parsed.sort;',
      'return { sort: parseResult.sort };',
      'if (browseContext.sort === "name") { ... }',
      'const { sort } = browseResult;\nreturn sort;\n// later: browseResult.sort',
      'customIdParsed.sort',
      'browseData.sort',
      'browseParsed.sort',
    ];
    for (const v of violations) {
      expect(PARSE_RESULT_SORT_ACCESS_RE.test(v), `should match: ${v}`).toBe(true);
    }

    const safe = [
      'memories.sort((a, b) => a.createdAt - b.createdAt)',
      'const sorted = [...items].sort(compareByName)',
      'results.sort()',
      'const sort: Sort = "name"', // bare `sort` identifier, not a property access
      'parsedMemories.sort((a, b) => ...)', // "parsed" is a prefix, not a whole word
    ];
    for (const s of safe) {
      expect(PARSE_RESULT_SORT_ACCESS_RE.test(s), `should NOT match: ${s}`).toBe(false);
    }
  });

  it('caller list is exhaustive — update when adding a new includeSort: false caller', () => {
    // Also a static check: fail loudly if someone adds a new
    // `includeSort: false` caller without adding it to the list above.
    // The check is a grep-style scan of the commands tree rooted at the
    // service's src/commands dir. If it finds more `includeSort: false`
    // occurrences than the known callers, this test fails and the new
    // caller must either be added to INCLUDE_SORT_FALSE_CALLERS or the
    // test must be updated to reflect the new set.
    const commandsDir = resolve(thisDir, '../../commands');

    // Walk the commands tree looking for `includeSort: false`. Using a
    // plain readdirSync walk keeps the test dependency-free (no glob lib).
    const foundFiles = new Set<string>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = resolve(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
          const text = readFileSync(full, 'utf-8');
          if (/includeSort:\s*false/.test(text)) {
            foundFiles.add(full);
          }
        }
      }
    };
    walk(commandsDir);

    const expectedFiles = new Set(INCLUDE_SORT_FALSE_CALLERS.map(c => resolve(thisDir, c)));

    // Symmetric diff: both directions must be empty.
    const unexpected = [...foundFiles].filter(f => !expectedFiles.has(f));
    const missing = [...expectedFiles].filter(f => !foundFiles.has(f));

    expect(
      unexpected,
      `New includeSort: false caller(s) not in allowlist — add them to ` +
        `INCLUDE_SORT_FALSE_CALLERS and verify they don't read .sort`
    ).toEqual([]);
    expect(
      missing,
      `Allowlist references file(s) that no longer use includeSort: false — ` +
        `remove them from INCLUDE_SORT_FALSE_CALLERS`
    ).toEqual([]);
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

  describe('custom labels', () => {
    it('should use custom button labels', () => {
      const row = buildBrowseButtons({
        ...baseConfig,
        labels: {
          previous: 'Back',
          next: 'Forward',
          sortByName: 'ABC',
          sortByDate: 'Recent',
        },
      });
      const buttons = row.components;

      expect(getButtonData(buttons[0]).label).toBe('Back');
      expect(getButtonData(buttons[2]).label).toBe('Forward');
      expect(getButtonData(buttons[3]).label).toBe('ABC'); // currentSort is 'date', so shows name option
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
