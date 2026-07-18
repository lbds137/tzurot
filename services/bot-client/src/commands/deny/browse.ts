/**
 * Deny Browse Subcommand
 *
 * Browse denylist entries with pagination, filtering, and sorting.
 * Bot owner only. Uses the shared browse pattern for consistent UX.
 * Includes a select menu for viewing entry details.
 */

import {
  escapeMarkdown,
  type EmbedBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { formatDateShort } from '@tzurot/common-types/utils/dateFormatting';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import { type OwnerClient } from '@tzurot/clients';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { requireBotOwnerContext } from '../../utils/commandContext/index.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import {
  buildBrowseButtons,
  buildBrowseListEmbed,
  buildBrowseSelectMenu,
  buildFilterToggleButton,
  createBrowseCustomIdHelpers,
  createBrowseSortToggle,
  ITEMS_PER_PAGE,
  pluralize,
  formatFilterLabeled,
  formatSortNatural,
  type BrowseSortType,
  type FilterToggleDisplay,
  type BrowseActionRow,
} from '../../utils/browse/index.js';

const logger = createLogger('deny-browse');

/** Browse filter by entity type */
export type DenyBrowseFilter = 'all' | 'user' | 'guild';

const VALID_FILTERS = ['all', 'user', 'guild'] as const;

const browseHelpers = createBrowseCustomIdHelpers<DenyBrowseFilter>({
  prefix: 'deny',
  validFilters: VALID_FILTERS,
});

import type { DenylistEntryResponse } from './browseTypes.js';

/** Check if custom ID is a deny browse button interaction */
export function isDenyBrowseInteraction(customId: string): boolean {
  return browseHelpers.isBrowse(customId);
}

/** Check if custom ID is a deny browse select interaction */
export function isDenyBrowseSelectInteraction(customId: string): boolean {
  return browseHelpers.isBrowseSelect(customId);
}

/** In-place filter toggle display (§3.1 affordance). */
const FILTER_TOGGLE_DISPLAY: Record<DenyBrowseFilter, FilterToggleDisplay> = {
  all: { label: 'Filter: All', shortLabel: 'All', emoji: '📋' },
  user: { label: 'Filter: Users', shortLabel: 'Users', emoji: '👤' },
  guild: { label: 'Filter: Guilds', shortLabel: 'Guilds', emoji: '🏢' },
};

/**
 * Format entry for select menu label (unprefixed).
 *
 * The numbering and truncation are handled by the shared
 * `buildBrowseSelectMenu` factory; this helper returns just the
 * type-emoji + discordId + mode-indicator portion.
 */
function formatSelectLabel(entry: DenylistEntryResponse): string {
  const typeEmoji = entry.type === 'USER' ? '\u{1F464}' : '\u{1F3E2}';
  const modeIndicator = entry.mode === 'MUTE' ? ' [MUTE]' : '';
  return `${typeEmoji} ${entry.discordId}${modeIndicator}`;
}

/** Sort entries by the specified sort type */
function sortEntries(
  entries: DenylistEntryResponse[],
  sort: BrowseSortType
): DenylistEntryResponse[] {
  const sorted = [...entries];
  if (sort === 'name') {
    sorted.sort((a, b) => a.discordId.localeCompare(b.discordId));
  } else {
    sorted.sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
  }
  return sorted;
}

/** Filter entries by entity type */
function filterByType(
  entries: DenylistEntryResponse[],
  filter: DenyBrowseFilter
): DenylistEntryResponse[] {
  if (filter === 'all') {
    return entries;
  }
  const typeValue = filter.toUpperCase();
  return entries.filter(e => e.type === typeValue);
}

/** Build the browse page embed and components on the shared list builder. */
function buildBrowsePage(
  entries: DenylistEntryResponse[],
  page: number,
  filter: DenyBrowseFilter,
  sort: BrowseSortType
): { embed: EmbedBuilder; components: BrowseActionRow[] } {
  const { embed, pageItems, startIndex, totalPages, safePage } =
    buildBrowseListEmbed<DenylistEntryResponse>({
      entityEmoji: '\u{1F6AB}',
      titleNoun: 'Denylist',
      items: entries,
      page,
      itemsPerPage: ITEMS_PER_PAGE,
      formatRow: entry => ({
        badges:
          (entry.type === 'USER' ? '\u{1F464}' : '\u{1F3E2}') +
          (entry.mode === 'MUTE' ? '\u{1F507}' : ''),
        // Users render as a live mention with the raw id as techId; guilds
        // only have the raw id, which becomes the name itself.
        name: entry.type === 'USER' ? `<@${entry.discordId}>` : entry.discordId,
        techId: entry.type === 'USER' ? entry.discordId : undefined,
        metadata: [
          entry.scope === 'BOT' ? 'Bot-wide' : `${entry.scope}:${entry.scopeId}`,
          `Added ${formatDateShort(entry.addedAt)}`,
          ...(entry.reason !== null ? [escapeMarkdown(entry.reason)] : []),
        ],
      }),
      empty: {
        noItems: 'The denylist is empty \u2014 add entries with `/deny add`.',
        noMatch: 'No entries match this filter \u2014 toggle it to see all.',
      },
      filterActive: filter !== 'all',
      footerSegments: [
        pluralize(entries.length, { singular: 'entry', plural: 'entries' }),
        // Derived from the toggle display so button and footer can't drift.
        filter !== 'all' && formatFilterLabeled(FILTER_TOGGLE_DISPLAY[filter].shortLabel),
        sort === 'date' ? formatSortNatural('date') : formatSortNatural('target ID'),
      ],
      badgeLegend: 'User \u{1F464} \u00B7 Guild \u{1F3E2} \u00B7 Muted \u{1F507}',
      color: DISCORD_COLORS.ERROR,
    });

  const components: BrowseActionRow[] = [];

  // Select first, buttons second — the design system's composition order.
  const selectRow = buildBrowseSelectMenu<DenylistEntryResponse>({
    items: pageItems,
    customId: browseHelpers.buildSelect(safePage, filter, sort, null),
    placeholder: 'Select an entry to view/edit...',
    startIndex,
    formatItem: entry => ({
      label: formatSelectLabel(entry),
      value: entry.id,
      description: entry.scope === 'BOT' ? 'Bot-wide' : `${entry.scope}:${entry.scopeId}`,
    }),
  });
  if (selectRow !== null) {
    components.push(selectRow);
  }

  // The button row always renders on filter-bearing browses (alias-pilot
  // norm): the filter toggle stays reachable even on an empty filtered list.
  const buttonRow = buildBrowseButtons({
    currentPage: safePage,
    totalPages,
    filter,
    currentSort: sort,
    query: null,
    buildCustomId: browseHelpers.build,
    buildInfoId: browseHelpers.buildInfo,
    // Deny entries are keyed by ID (not name), so override the
    // default 'Sort A-Z' label to reflect that. The rest of the
    // default BrowseSortType toggle (toggling between 'name' and
    // 'date', the emoji choices) is preserved.
    sortToggle: createBrowseSortToggle({
      sortByName: { label: 'Sort by ID', emoji: '\u{1F524}' },
    }),
  });
  buttonRow.addComponents(
    buildFilterToggleButton({
      filters: VALID_FILTERS,
      display: FILTER_TOGGLE_DISPLAY,
      current: filter,
      buildCustomId: browseHelpers.build,
      sort,
      query: null,
    })
  );
  components.push(buttonRow);

  return { embed, components };
}

/** Fetch denylist entries via the typed owner client */
export async function fetchEntries(
  ownerClient: OwnerClient
): Promise<DenylistEntryResponse[] | null> {
  try {
    const result = await ownerClient.listDenylistEntries();
    if (!result.ok) {
      return null;
    }
    return result.data.entries;
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch denylist entries');
    return null;
  }
}

/**
 * Build a browse response from raw entries and browse context.
 * Used by detail.ts for back navigation.
 */
export function buildBrowseResponse(
  entries: DenylistEntryResponse[],
  page: number,
  filter: DenyBrowseFilter,
  sort: BrowseSortType
): { embed: EmbedBuilder; components: BrowseActionRow[] } {
  const filtered = filterByType(entries, filter);
  const sorted = sortEntries(filtered, sort);
  return buildBrowsePage(sorted, page, filter, sort);
}

/** Handle /deny browse [filter?] */
export async function handleBrowse(context: DeferredCommandContext): Promise<void> {
  if (!(await requireBotOwnerContext(context))) {
    return;
  }

  const filterOption = context.getOption<string>('filter');
  const filter: DenyBrowseFilter =
    filterOption === 'user' || filterOption === 'guild' ? filterOption : 'all';

  const { ownerClient } = clientsFor(context.interaction);
  const entries = await fetchEntries(ownerClient);
  if (entries === null) {
    await context.editReply('\u274C Failed to fetch denylist entries.');
    return;
  }

  const filtered = filterByType(entries, filter);
  const sorted = sortEntries(filtered, 'date');
  const { embed, components } = buildBrowsePage(sorted, 0, filter, 'date');

  await context.editReply({ embeds: [embed], components });
}

/** Handle browse pagination button clicks */
export async function handleBrowsePagination(interaction: ButtonInteraction): Promise<void> {
  const parsed = browseHelpers.parse(interaction.customId);
  if (parsed === null) {
    return;
  }

  // Owner-only — silent deny for non-owners
  if (!isBotOwner(interaction.user.id)) {
    return;
  }

  await interaction.deferUpdate();

  const { page, filter, sort } = parsed;

  const { ownerClient } = clientsFor(interaction);
  const entries = await fetchEntries(ownerClient);
  if (entries === null) {
    return;
  }

  const filtered = filterByType(entries, filter);
  const sorted = sortEntries(filtered, sort);
  const { embed, components } = buildBrowsePage(sorted, page, filter, sort);

  await interaction.editReply({ embeds: [embed], components });
}

/** Handle browse select menu selection */
export async function handleBrowseSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  // Owner-only — silent deny for non-owners
  if (!isBotOwner(interaction.user.id)) {
    return;
  }

  const parsed = browseHelpers.parseSelect(interaction.customId);
  if (parsed === null) {
    return;
  }

  await interaction.deferUpdate();

  const selectedId = interaction.values[0];
  if (selectedId === undefined) {
    return;
  }

  // Fetch entries to find the selected one
  const { ownerClient } = clientsFor(interaction);
  const entries = await fetchEntries(ownerClient);
  if (entries === null) {
    return;
  }

  const entry = entries.find(e => e.id === selectedId);
  if (entry === undefined) {
    await interaction.editReply({ content: '\u274C Entry not found.', embeds: [], components: [] });
    return;
  }

  // Import detail handler lazily to avoid circular dependency
  const { showDetailView } = await import('./detail.js');
  await showDetailView(interaction, entry, {
    source: 'browse',
    page: parsed.page,
    filter: parsed.filter,
    sort: parsed.sort ?? 'date',
  });
}
