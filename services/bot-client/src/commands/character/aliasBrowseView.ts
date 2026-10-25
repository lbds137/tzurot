/**
 * /character alias browse — view builders (list embed, action rows, select
 * option formatting, and refreshed browse view).
 */

import { escapeMarkdown, type EmbedBuilder } from 'discord.js';
import { AUTOCOMPLETE_BADGES } from '@tzurot/common-types/utils/autocompleteFormat';
import {
  ENTITY_EMOJI,
  buildBadgeLegend,
  type LegendEntry,
} from '@tzurot/common-types/constants/uxVocabulary';
import type { UserClient } from '@tzurot/clients';
import { buildSimplePaginationButtons } from '../../utils/browse/buttonBuilder.js';
import { createBrowseCustomIdHelpers } from '../../utils/browse/customIdFactory.js';
import {
  buildFilterToggleButton,
  type FilterToggleDisplay,
} from '../../utils/browse/filterRowBuilder.js';
import { formatFilterLabeled, pluralize } from '../../utils/browse/footer.js';
import { buildBrowseListEmbed } from '../../utils/browse/listEmbedBuilder.js';
import {
  buildBrowseSelectMenu,
  type BrowseSelectOption,
} from '../../utils/browse/selectMenuBuilder.js';
import { truncateForSelect } from '../../utils/browse/truncation.js';
import type { BrowseActionRow } from '../../utils/browse/types.js';
import { buildSelectSeveralToggleRow } from '../../utils/browse/multiSelectBatch.js';
import {
  ALIAS_FILTERS,
  applyFilter,
  fetchAliasRows,
  type AliasFilter,
  type AliasRow,
} from './aliasData.js';

export const ALIAS_ITEMS_PER_PAGE = 15;

/** Select values must fit Discord's 100-char cap: `{scope}:{aliasKey}`. */
export const SELECT_ALIAS_KEY_LENGTH = 92;

export const aliasHelpers = createBrowseCustomIdHelpers<AliasFilter>({
  prefix: 'character-alias',
  validFilters: ALIAS_FILTERS,
  includeSort: false,
});

/** Batch multi-select toggle customId prefix carrying the browse coordinates. */
export const BATCH_SELECT_PREFIX = 'character-alias::batch-select::';

export function buildRemoveCustomId(
  prefix: string,
  page: number,
  filter: AliasFilter,
  query: string | null
): string {
  // Same segment shape as the factory's coords: {page}::{filter}::{query}.
  return `${prefix}${page}::${filter}::${query ?? ''}`;
}

const FILTER_TOGGLE_DISPLAY: Record<AliasFilter, FilterToggleDisplay> = {
  all: { label: 'Filter: All', shortLabel: 'All', emoji: '📋' },
  mine: { label: 'Filter: Mine', shortLabel: 'Mine', emoji: '🔒' },
  global: { label: 'Filter: Global', shortLabel: 'Global', emoji: '🌐' },
};

function scopeBadge(row: AliasRow): string {
  const base = row.scope === 'global' ? AUTOCOMPLETE_BADGES.GLOBAL : AUTOCOMPLETE_BADGES.OWNED;
  return row.shadowed ? `${base}${AUTOCOMPLETE_BADGES.SHADOWED}` : base;
}

/**
 * Legend in the alias domain's words — Global/Personal (the filter toggle's
 * vocabulary), overriding the registry's standard Public/Private.
 */
function aliasLegend(myMode: boolean): string {
  const base: LegendEntry[] = [
    { key: 'GLOBAL', word: 'Global' },
    { key: 'OWNED', word: 'Personal' },
  ];
  return buildBadgeLegend(myMode ? [...base, 'SHADOWED'] : base);
}

export interface BrowseCoords {
  page: number;
  filter: AliasFilter;
  /** The character slug coordinate; null = my-aliases mode. */
  query: string | null;
}

/**
 * Build the select menu value for one alias row (`{scope}:{aliasKey}`).
 * Two same-scope aliases sharing a 92-char prefix produce the same value:
 * the value carries a 92-char slice of an alias column capped at 100 chars,
 * leaving an 8-char suffix two same-prefix aliases can share. Believed to
 * fail at Discord render rather than silently mis-clearing; not pinned by a
 * test — that hedge covers only same-menu collisions, since a row on another
 * page or behind a filter never renders beside the pick; cross-page and
 * filtered collisions are handled by the batch resolver's fail-closed
 * multi-match rule (resolveAliasBatchItems in aliasBatchConfirm.ts) and the
 * single-pick confirm's full-alias display.
 */
export function formatAliasSelectValue(row: AliasRow): string {
  return `${row.scope}:${row.alias.slice(0, SELECT_ALIAS_KEY_LENGTH)}`;
}

/** Option fields for one alias in single-select and multi-select menus. */
export function formatAliasSelectOption(row: AliasRow): BrowseSelectOption {
  return {
    label: truncateForSelect(`@${row.alias}`),
    value: formatAliasSelectValue(row),
    description: truncateForSelect(
      row.scope === 'global' ? `Global · ${row.character.slug}` : `Personal · ${row.character.slug}`
    ),
  };
}

/** Build the browse list embed and pagination slice for filtered alias rows. */
export function buildAliasListEmbed(options: {
  rows: AliasRow[];
  truncated: boolean;
  coords: BrowseCoords;
  banner?: string;
}): ReturnType<typeof buildBrowseListEmbed<AliasRow>> {
  const { rows, truncated, coords, banner } = options;
  const { filter, query: slug } = coords;
  const myMode = slug === null;
  const preamble: string[] = [];
  if (banner !== undefined) {
    preamble.push(banner, '');
  }
  if (!myMode) {
    preamble.push(
      `Aliases for **${escapeMarkdown(slug)}** — they resolve @mentions like the name.`
    );
  }

  return buildBrowseListEmbed<AliasRow>({
    entityEmoji: ENTITY_EMOJI.alias,
    titleNoun: 'Aliases',
    items: rows,
    page: coords.page,
    itemsPerPage: ALIAS_ITEMS_PER_PAGE,
    preamble,
    formatRow: row => ({
      badges: scopeBadge(row),
      name: `@${escapeMarkdown(row.alias)}`,
      metadata: myMode
        ? [`${row.character.name ?? row.character.slug} (${row.character.slug})`]
        : undefined,
    }),
    empty: {
      noItems: myMode
        ? 'You have no personal aliases yet — add one with `/character alias add`.'
        : 'No aliases you can see here — add one with `/character alias add`.',
      noMatch: 'No aliases match this filter — toggle it to see the rest.',
    },
    filterActive: filter !== 'all',
    footerSegments: [
      pluralize(rows.length, { singular: 'alias', plural: 'aliases' }),
      filter !== 'all' && formatFilterLabeled(FILTER_TOGGLE_DISPLAY[filter].shortLabel),
      truncated && 'list truncated',
    ],
    badgeLegend: aliasLegend(myMode),
  });
}

export function buildAliasBrowseComponents(
  pageItems: AliasRow[],
  startIndex: number,
  totalPages: number,
  coords: BrowseCoords
): BrowseActionRow[] {
  const { page: safePage, filter, query } = coords;
  const components: BrowseActionRow[] = [];

  const selectRow = buildBrowseSelectMenu<AliasRow>({
    items: pageItems,
    customId: aliasHelpers.buildSelect(safePage, filter, 'name', query),
    placeholder: 'Select an alias to remove...',
    startIndex,
    formatItem: formatAliasSelectOption,
  });
  if (selectRow !== null) {
    const toggleId = buildRemoveCustomId(BATCH_SELECT_PREFIX, safePage, filter, query);
    components.push(selectRow, buildSelectSeveralToggleRow(toggleId));
  }

  const buttonRow = buildSimplePaginationButtons<AliasFilter>({
    currentPage: safePage,
    totalPages,
    filter,
    currentSort: 'name',
    query,
    buildCustomId: aliasHelpers.build,
    buildInfoId: aliasHelpers.buildInfo,
  });
  // The in-place FILTER toggle (owner-adopted design affordance), via the
  // shared builder this pilot's usage was generalized into.
  buttonRow.addComponents(
    buildFilterToggleButton({
      filters: ALIAS_FILTERS,
      display: FILTER_TOGGLE_DISPLAY,
      current: filter,
      buildCustomId: aliasHelpers.build,
      query,
    })
  );
  components.push(buttonRow);
  return components;
}

/**
 * Build the refreshed browse view (embed + components) for the given coords.
 * Returns null when the fetch fails so callers can keep the message intact.
 */
export async function buildRefreshedAliasView(
  userClient: UserClient,
  coords: BrowseCoords
): Promise<{ embed: EmbedBuilder; components: BrowseActionRow[] } | null> {
  const fetched = await fetchAliasRows(userClient, coords.query);
  if (!fetched.ok) {
    return null;
  }
  const filtered = applyFilter(fetched.data.rows, coords.filter);
  const { embed, pageItems, startIndex, totalPages, safePage } = buildAliasListEmbed({
    rows: filtered,
    truncated: fetched.data.truncated,
    coords,
  });
  const safeCoords: BrowseCoords = { page: safePage, filter: coords.filter, query: coords.query };
  return {
    embed,
    components: buildAliasBrowseComponents(pageItems, startIndex, totalPages, safeCoords),
  };
}
