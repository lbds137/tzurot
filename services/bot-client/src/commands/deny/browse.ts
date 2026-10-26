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
import { ENTITY_EMOJI, buildBadgeLegend } from '@tzurot/common-types/constants/uxVocabulary';
import { AUTOCOMPLETE_BADGES } from '@tzurot/common-types/utils/autocompleteFormat';
import { formatDiscordTimestamp } from '@tzurot/common-types/utils/dateFormatting';
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
  type BrowseSelectOption,
} from '../../utils/browse/index.js';
import {
  buildBatchModeRows,
  buildSelectSeveralToggleRow,
} from '../../utils/browse/multiSelectBatch.js';
import { followUpBrowsePageFailure } from '../../utils/browse/pageLoadFailure.js';
import { ackUpdate } from '../../ux/render/reply.js';
import type { DenylistEntryResponse } from './browseTypes.js';
import { MODE_LABELS, formatScopeWithId } from './denyLabels.js';

const logger = createLogger('deny-browse');

/** Browse filter by entity type */
export type DenyBrowseFilter = 'all' | 'user' | 'guild';

const VALID_FILTERS = ['all', 'user', 'guild'] as const;
/** Batch action tokens for the deny browse multi-select flow. */
export const DENY_BATCH_ACTION = {
  /** Enter batch mode (button) and submit the multi-select (menu). */
  SELECT: 'batch-select',
  /** Remove every picked entry. */
  CONFIRM: 'batch-confirm',
  /** Leave batch mode without removing anything. */
  CANCEL: 'batch-cancel',
} as const;
/** One deny batch action token. */
export type DenyBatchAction = (typeof DENY_BATCH_ACTION)[keyof typeof DENY_BATCH_ACTION];
const VALID_BATCH_ACTIONS: readonly string[] = Object.values(DENY_BATCH_ACTION);

/** Parsed coordinates from a deny batch customId (`deny::<action>::<page>::<filter>::<sort>`). */
export interface ParsedDenyBatchCustomId {
  action: DenyBatchAction;
  page: number;
  filter: DenyBrowseFilter;
  sort: BrowseSortType;
}

const browseHelpers = createBrowseCustomIdHelpers<DenyBrowseFilter>({
  prefix: 'deny',
  validFilters: VALID_FILTERS,
});

/** Check if custom ID is a deny browse button interaction */
export function isDenyBrowseInteraction(customId: string): boolean {
  return browseHelpers.isBrowse(customId);
}

/** Check if custom ID is a deny browse select interaction */
export function isDenyBrowseSelectInteraction(customId: string): boolean {
  return browseHelpers.isBrowseSelect(customId);
}

/** Build a customId for a deny browse batch action carrying `{page, filter, sort}`. */
export function buildDenyBatchCustomId(
  action: DenyBatchAction,
  page: number,
  filter: DenyBrowseFilter,
  sort: BrowseSortType
): string {
  return `deny::${action}::${page}::${filter}::${sort}`;
}

/** Parse a deny browse batch customId, or return `null` when unmatched/invalid. */
export function parseDenyBatchCustomId(customId: string): ParsedDenyBatchCustomId | null {
  const parts = customId.split('::');
  if (parts.length !== 5 || parts[0] !== 'deny') {
    return null;
  }
  const [, action, pageRaw, filter, sort] = parts;
  const page = pageRaw !== undefined && /^\d+$/.test(pageRaw) ? Number(pageRaw) : Number.NaN;
  if (
    !Number.isSafeInteger(page) ||
    !VALID_BATCH_ACTIONS.includes(action ?? '') ||
    !(VALID_FILTERS as readonly string[]).includes(filter ?? '') ||
    (sort !== 'name' && sort !== 'date')
  ) {
    return null;
  }
  return {
    action: action as DenyBatchAction,
    page,
    filter: filter as DenyBrowseFilter,
    sort,
  };
}

/** In-place filter toggle display (§3.1 affordance). */
const FILTER_TOGGLE_DISPLAY: Record<DenyBrowseFilter, FilterToggleDisplay> = {
  all: { label: 'Filter: All', shortLabel: 'All', emoji: '📋' },
  // 🧍 USER_TARGET — 👤 belongs to the persona ENTITY register (§2.2).
  user: { label: 'Filter: Users', shortLabel: 'Users', emoji: AUTOCOMPLETE_BADGES.USER_TARGET },
  guild: {
    label: 'Filter: Servers',
    shortLabel: 'Servers',
    emoji: AUTOCOMPLETE_BADGES.GUILD_TARGET,
  },
};

/**
 * Format entry for select menu label (unprefixed).
 *
 * The numbering and truncation are handled by the shared
 * `buildBrowseSelectMenu` factory; this helper returns just the
 * type-emoji + discordId + mode-indicator portion.
 */
function formatSelectLabel(entry: DenylistEntryResponse): string {
  const typeEmoji =
    entry.type === 'USER' ? AUTOCOMPLETE_BADGES.USER_TARGET : AUTOCOMPLETE_BADGES.GUILD_TARGET;
  const modeIndicator = entry.mode === 'MUTE' ? ` [${MODE_LABELS.MUTE}]` : '';
  return `${typeEmoji} ${entry.discordId}${modeIndicator}`;
}

/**
 * Format an entry as a browse select menu option.
 * Shared by the one-pick select menu and the batch multi-select menu.
 */
export function formatDenySelectOption(entry: DenylistEntryResponse): BrowseSelectOption {
  return {
    label: formatSelectLabel(entry),
    value: entry.id,
    description: formatScopeWithId(entry.scope, entry.scopeId),
  };
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

function formatDenyListRow(entry: DenylistEntryResponse): {
  badges: string;
  name: string;
  techId: string | undefined;
  metadata: string[];
} {
  return {
    badges:
      (entry.type === 'USER' ? AUTOCOMPLETE_BADGES.USER_TARGET : AUTOCOMPLETE_BADGES.GUILD_TARGET) +
      (entry.mode === 'MUTE' ? AUTOCOMPLETE_BADGES.MUTED : ''),
    // Users render as a live mention with the raw id as techId; guilds
    // only have the raw id, which becomes the name itself.
    name: entry.type === 'USER' ? `<@${entry.discordId}>` : entry.discordId,
    techId: entry.type === 'USER' ? entry.discordId : undefined,
    metadata: [
      formatScopeWithId(entry.scope, entry.scopeId),
      `Added ${formatDiscordTimestamp(entry.addedAt, 'D')}`,
      ...(entry.reason !== null ? [escapeMarkdown(entry.reason)] : []),
    ],
  };
}

/** Build the browse page embed and components on the shared list builder. */
function buildBrowsePage(
  entries: DenylistEntryResponse[],
  page: number,
  filter: DenyBrowseFilter,
  sort: BrowseSortType,
  options?: { mode?: 'single' | 'batch' }
): { embed: EmbedBuilder; components: BrowseActionRow[] } {
  const { embed, pageItems, startIndex, totalPages, safePage } =
    buildBrowseListEmbed<DenylistEntryResponse>({
      entityEmoji: ENTITY_EMOJI.denial,
      titleNoun: 'Denylist',
      items: entries,
      page,
      itemsPerPage: ITEMS_PER_PAGE,
      formatRow: formatDenyListRow,
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
        options?.mode === 'batch' && entries.length > 0 && 'Select several below, then confirm',
      ],
      badgeLegend: buildBadgeLegend(['USER_TARGET', 'GUILD_TARGET', 'MUTED']),
      // No ERROR color: browse is an informational surface and stays BLURPLE
      // (\u00A72.3 names "red deny lists" as the drift to kill).
    });

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

  // Empty page early-returns before the batch-mode branch (renders no menu, no toggle).
  if (pageItems.length === 0) {
    return { embed, components: [buttonRow] };
  }

  if (options?.mode === 'batch') {
    const batchSelectRow = buildBrowseSelectMenu<DenylistEntryResponse>({
      items: pageItems,
      customId: buildDenyBatchCustomId(DENY_BATCH_ACTION.SELECT, safePage, filter, sort),
      placeholder: 'Select several entries to remove...',
      startIndex,
      maxValues: ITEMS_PER_PAGE,
      formatItem: formatDenySelectOption,
    });
    return {
      embed,
      components: buildBatchModeRows({
        selectRow: batchSelectRow,
        cancelCustomId: buildDenyBatchCustomId(DENY_BATCH_ACTION.CANCEL, safePage, filter, sort),
      }),
    };
  }

  const components: BrowseActionRow[] = [];

  // Select first, toggle second, buttons third — the design system's composition order.
  const selectRow = buildBrowseSelectMenu<DenylistEntryResponse>({
    items: pageItems,
    customId: browseHelpers.buildSelect(safePage, filter, sort, null),
    placeholder: 'Select an entry to view/edit...',
    startIndex,
    formatItem: formatDenySelectOption,
  });
  if (selectRow !== null) {
    components.push(
      selectRow,
      buildSelectSeveralToggleRow(
        buildDenyBatchCustomId(DENY_BATCH_ACTION.SELECT, safePage, filter, sort)
      )
    );
  }
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
 * Used by detail.ts for back navigation and browseBatch.ts for batch mode / refresh.
 */
export function buildBrowseResponse(
  entries: DenylistEntryResponse[],
  page: number,
  filter: DenyBrowseFilter,
  sort: BrowseSortType,
  options?: { mode?: 'single' | 'batch' }
): { embed: EmbedBuilder; components: BrowseActionRow[] } {
  const filtered = filterByType(entries, filter);
  const sorted = sortEntries(filtered, sort);
  return buildBrowsePage(sorted, page, filter, sort, options);
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

  await ackUpdate(interaction);

  const { page, filter, sort } = parsed;

  const { ownerClient } = clientsFor(interaction);
  const entries = await fetchEntries(ownerClient);
  if (entries === null) {
    // `fetchEntries` collapses both failure arms (a `!ok` gateway result and a
    // thrown error) into `null`, so there is no failure object to classify —
    // the helper renders its generic load-failure shape (classify.test.ts's
    // "TOTAL: unknown error shapes" case pins `null` among its inputs).
    await followUpBrowsePageFailure(interaction, null);
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

  await ackUpdate(interaction);

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
