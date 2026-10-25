/**
 * Tests for the character alias browse view builders (aliasBrowseView.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserClient } from '@tzurot/clients';
import type { BrowseActionRow } from '../../utils/browse/index.js';
import {
  ALIAS_ITEMS_PER_PAGE,
  SELECT_ALIAS_KEY_LENGTH,
  buildAliasBrowseComponents,
  buildAliasListEmbed,
  buildRefreshedAliasView,
  formatAliasSelectOption,
  formatAliasSelectValue,
  type BrowseCoords,
} from './aliasBrowseView.js';
import type { AliasRow } from './aliasData.js';

const CREATED_AT = '2026-07-18T00:00:00.000Z';

const mockUserClient = {
  listPersonalityAliases: vi.fn(),
  listMyAliases: vi.fn(),
};

const MY_MODE_ROWS: AliasRow[] = [
  {
    alias: 'mommy',
    scope: 'user',
    character: { name: 'Lilith', slug: 'lilith' },
    shadowed: false,
  },
  {
    alias: 'lila',
    scope: 'global',
    character: { name: 'Lila Elyona', slug: 'lila-elyona' },
    shadowed: true,
  },
];

function myAliasesResponse(): unknown {
  return {
    ok: true,
    data: {
      aliases: [
        {
          alias: 'mommy',
          scope: 'user',
          personality: { id: 'p-1', name: 'Lilith', slug: 'lilith' },
          shadowed: false,
          createdAt: CREATED_AT,
        },
        {
          alias: 'lila',
          scope: 'global',
          personality: { id: 'p-2', name: 'Lila Elyona', slug: 'lila-elyona' },
          shadowed: true,
          createdAt: CREATED_AT,
        },
      ],
      truncated: false,
    },
  };
}

function componentIds(components: BrowseActionRow[]): string[] {
  return components.flatMap(row =>
    row.toJSON().components.map(component => ('custom_id' in component ? component.custom_id : ''))
  );
}

describe('aliasBrowseView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserClient.listMyAliases.mockResolvedValue(myAliasesResponse());
  });

  describe('formatAliasSelectValue & formatAliasSelectOption', () => {
    it('formats `{scope}:{aliasKey}` and clamps keys over SELECT_ALIAS_KEY_LENGTH', () => {
      expect(formatAliasSelectValue(MY_MODE_ROWS[0])).toBe('user:mommy');
      expect(formatAliasSelectOption(MY_MODE_ROWS[0])).toEqual({
        label: '@mommy',
        value: 'user:mommy',
        description: 'Personal · lilith',
      });
      expect(formatAliasSelectOption(MY_MODE_ROWS[1])).toEqual({
        label: '@lila',
        value: 'global:lila',
        description: 'Global · lila-elyona',
      });

      const longRow: AliasRow = {
        alias: 'x'.repeat(100),
        scope: 'user',
        character: { name: 'Lilith', slug: 'lilith' },
        shadowed: false,
      };
      const value = formatAliasSelectValue(longRow);
      expect(value).toBe(`user:${'x'.repeat(SELECT_ALIAS_KEY_LENGTH)}`);
      expect(value.length).toBe('user:'.length + SELECT_ALIAS_KEY_LENGTH);
    });
  });

  describe('buildAliasListEmbed', () => {
    it('renders badges, character metadata, and shadowed legend in my-aliases mode', () => {
      const coords: BrowseCoords = { page: 0, filter: 'all', query: null };
      const { embed, pageItems, startIndex, totalPages, safePage } = buildAliasListEmbed({
        rows: MY_MODE_ROWS,
        truncated: false,
        coords,
      });

      const json = embed.toJSON();
      expect(json.title).toBe('🏷️ Aliases');
      expect(json.description).toContain('🔒 **@mommy**');
      expect(json.description).toContain('🌐⚠️ **@lila**');
      expect(json.description).toContain('└ Lilith (lilith)');
      expect(json.footer?.text).toContain('Shadowed ⚠️');
      expect(pageItems).toEqual(MY_MODE_ROWS);
      expect(startIndex).toBe(0);
      expect(totalPages).toBe(1);
      expect(safePage).toBe(0);
    });

    it('renders character preamble, banner, and no shadowed legend in character mode', () => {
      const coords: BrowseCoords = { page: 0, filter: 'mine', query: 'lila-elyona' };
      const { embed } = buildAliasListEmbed({
        rows: [MY_MODE_ROWS[0]],
        truncated: true,
        coords,
        banner: '✅ Removed alias `@old`',
      });

      const json = embed.toJSON();
      expect(json.description).toContain('✅ Removed alias `@old`');
      expect(json.description).toContain('Aliases for **lila-elyona**');
      expect(json.footer?.text).toContain('filtered by: Mine');
      expect(json.footer?.text).toContain('list truncated');
      expect(json.footer?.text).not.toContain('Shadowed');
    });

    it('paginates rows across pages and clamps out-of-range page numbers', () => {
      const twentyRows: AliasRow[] = Array.from({ length: 20 }, (_, idx) => ({
        alias: `alias-${idx + 1}`,
        scope: idx % 2 === 0 ? 'user' : 'global',
        character: { name: 'Lilith', slug: 'lilith' },
        shadowed: false,
      }));

      const page0 = buildAliasListEmbed({
        rows: twentyRows,
        truncated: false,
        coords: { page: 0, filter: 'all', query: 'lilith' },
      });
      expect(page0.totalPages).toBe(2);
      expect(page0.safePage).toBe(0);
      expect(page0.startIndex).toBe(0);
      expect(page0.pageItems).toHaveLength(ALIAS_ITEMS_PER_PAGE);
      expect(page0.pageItems[0]?.alias).toBe('alias-1');
      expect(page0.pageItems[14]?.alias).toBe('alias-15');

      const page1Clamped = buildAliasListEmbed({
        rows: twentyRows,
        truncated: false,
        coords: { page: 9, filter: 'all', query: 'lilith' },
      });
      expect(page1Clamped.totalPages).toBe(2);
      expect(page1Clamped.safePage).toBe(1);
      expect(page1Clamped.startIndex).toBe(ALIAS_ITEMS_PER_PAGE);
      expect(page1Clamped.pageItems).toHaveLength(5);
      expect(page1Clamped.pageItems[0]?.alias).toBe('alias-16');
      expect(page1Clamped.pageItems[4]?.alias).toBe('alias-20');
    });
  });

  describe('buildAliasBrowseComponents', () => {
    it('renders select and batch-toggle rows when items exist and omits them when empty', () => {
      const coords: BrowseCoords = { page: 0, filter: 'all', query: null };
      const rows = buildAliasBrowseComponents(MY_MODE_ROWS, 0, 1, coords);
      expect(rows).toHaveLength(3);
      const ids = componentIds(rows);
      expect(ids).toContain('character-alias::browse-select::0::all::');
      expect(ids).toContain('character-alias::batch-select::0::all::');
      expect(ids).toContain('character-alias::browse::0::mine::');

      const emptyRows = buildAliasBrowseComponents([], 0, 1, coords);
      expect(emptyRows).toHaveLength(1);
      expect(componentIds(emptyRows).some(id => id.includes('batch-select'))).toBe(false);
    });
  });

  describe('buildRefreshedAliasView', () => {
    it('returns null when the gateway fetch fails', async () => {
      mockUserClient.listMyAliases.mockResolvedValueOnce({
        ok: false,
        status: 500,
        error: 'gateway down',
      });

      const view = await buildRefreshedAliasView(mockUserClient as unknown as UserClient, {
        page: 0,
        filter: 'all',
        query: null,
      });

      expect(view).toBeNull();
    });

    it('returns the refreshed embed and components with toggle row on success', async () => {
      const view = await buildRefreshedAliasView(mockUserClient as unknown as UserClient, {
        page: 0,
        filter: 'all',
        query: null,
      });

      expect(view).not.toBeNull();
      expect(view?.embed.toJSON().title).toBe('🏷️ Aliases');
      expect(view?.embed.toJSON().description).toContain('@mommy');
      expect(view?.embed.toJSON().description).toContain('@lila');
      const ids = componentIds(view?.components ?? []);
      expect(ids).toContain('character-alias::browse-select::0::all::');
      expect(ids).toContain('character-alias::batch-select::0::all::');
    });
  });
});
