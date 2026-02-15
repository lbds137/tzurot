/**
 * Deny Browse Subcommand
 *
 * Browse denylist entries with pagination, filtering, and sorting.
 * Bot owner only. Uses the shared browse pattern for consistent UX.
 * Includes a select menu for viewing entry details.
 */

import {
  EmbedBuilder,
  escapeMarkdown,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
} from 'discord.js';
import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
  ActionRowBuilder as ActionRowBuilderType,
  ButtonBuilder,
} from 'discord.js';
import { createLogger, isBotOwner, DISCORD_COLORS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { requireBotOwnerContext } from '../../utils/commandContext/index.js';
import { adminFetch } from '../../utils/adminApiClient.js';
import {
  buildBrowseButtons,
  createBrowseCustomIdHelpers,
  calculatePaginationState,
  ITEMS_PER_PAGE,
  truncateForSelect,
  type BrowseSortType,
} from '../../utils/browse/index.js';

const logger = createLogger('deny-browse');

/** Browse filter by entity type */
export type DenyBrowseFilter = 'all' | 'user' | 'guild';

const VALID_FILTERS = ['all', 'user', 'guild'] as const;

const browseHelpers = createBrowseCustomIdHelpers<DenyBrowseFilter>({
  prefix: 'deny',
  validFilters: VALID_FILTERS,
});

/** Response shape from GET /admin/denylist */
export interface DenylistEntryResponse {
  id: string;
  type: string;
  discordId: string;
  scope: string;
  scopeId: string;
  mode: string;
  reason: string | null;
  addedAt: string;
  addedBy: string;
}

/** Check if custom ID is a deny browse button interaction */
export function isDenyBrowseInteraction(customId: string): boolean {
  return browseHelpers.isBrowse(customId);
}

/** Check if custom ID is a deny browse select interaction */
export function isDenyBrowseSelectInteraction(customId: string): boolean {
  return browseHelpers.isBrowseSelect(customId);
}

/** Format a single entry for embed display */
function formatEntry(entry: DenylistEntryResponse, index: number): string {
  const num = String(index + 1);
  const target =
    entry.type === 'USER'
      ? `<@${entry.discordId}> (\`${entry.discordId}\`)`
      : `\`${entry.discordId}\` (Guild)`;
  const scopeInfo = entry.scope === 'BOT' ? 'Bot-wide' : `${entry.scope}:${entry.scopeId}`;
  const modeBadge = entry.mode === 'MUTE' ? ' · **MUTE**' : '';
  const date = new Date(entry.addedAt).toLocaleDateString();
  const reason = entry.reason !== null ? `\n   _${escapeMarkdown(entry.reason)}_` : '';
  return `${num}. ${target}\n   ${scopeInfo}${modeBadge} · Added ${date}${reason}`;
}

/** Format entry for select menu label */
function formatSelectLabel(entry: DenylistEntryResponse, index: number): string {
  const num = String(index + 1);
  const typeEmoji = entry.type === 'USER' ? '\u{1F464}' : '\u{1F3E2}';
  const modeIndicator = entry.mode === 'MUTE' ? ' [MUTE]' : '';
  return truncateForSelect(`${num}. ${typeEmoji} ${entry.discordId}${modeIndicator}`);
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

/** Build the browse page embed and components */
function buildBrowsePage(
  entries: DenylistEntryResponse[],
  page: number,
  filter: DenyBrowseFilter,
  sort: BrowseSortType
): { embed: EmbedBuilder; components: ActionRowBuilderType<ButtonBuilder>[] } {
  const { safePage, totalPages, startIndex, endIndex } = calculatePaginationState(
    entries.length,
    ITEMS_PER_PAGE,
    page
  );

  const pageEntries = entries.slice(startIndex, endIndex);

  const embed = new EmbedBuilder()
    .setTitle('\u{1F6AB} Denylist Browser')
    .setColor(DISCORD_COLORS.ERROR)
    .setTimestamp();

  if (pageEntries.length === 0) {
    embed.setDescription('_No denylist entries found._');
  } else {
    const lines = pageEntries.map((e, i) => formatEntry(e, startIndex + i));
    embed.setDescription(lines.join('\n\n'));
  }

  const filterLabel = filter === 'all' ? 'all types' : `${filter}s only`;
  const sortLabel = sort === 'date' ? 'by date' : 'by target ID';
  embed.setFooter({
    text: `${String(entries.length)} entries (${filterLabel}) \u2022 Sorted ${sortLabel}`,
  });

  const components: ActionRowBuilderType<ButtonBuilder>[] = [];
  if (entries.length > 0) {
    components.push(
      buildBrowseButtons({
        currentPage: safePage,
        totalPages,
        filter,
        currentSort: sort,
        query: null,
        buildCustomId: browseHelpers.build,
        buildInfoId: browseHelpers.buildInfo,
        labels: { sortByName: 'Sort by ID' },
      })
    );
  }

  // Add select menu for entry detail view
  if (pageEntries.length > 0) {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(browseHelpers.buildSelect(safePage, filter, sort, null))
      .setPlaceholder('Select an entry to view/edit...');

    for (let i = 0; i < pageEntries.length; i++) {
      const entry = pageEntries[i];
      const label = formatSelectLabel(entry, startIndex + i);
      const scopeInfo = entry.scope === 'BOT' ? 'Bot-wide' : `${entry.scope}:${entry.scopeId}`;
      selectMenu.addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel(label)
          .setValue(entry.id)
          .setDescription(truncateForSelect(scopeInfo))
      );
    }

    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        selectMenu
      ) as unknown as ActionRowBuilderType<ButtonBuilder>
    );
  }

  return { embed, components };
}

/** Fetch denylist entries from admin API */
export async function fetchEntries(userId: string): Promise<DenylistEntryResponse[] | null> {
  try {
    const response = await adminFetch('/admin/denylist', { userId });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as { entries: DenylistEntryResponse[] };
    return data.entries;
  } catch (error) {
    logger.error({ err: error }, '[Deny] Failed to fetch denylist entries');
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
): { embed: EmbedBuilder; components: ActionRowBuilderType<ButtonBuilder>[] } {
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

  const entries = await fetchEntries(context.user.id);
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

  const entries = await fetchEntries(interaction.user.id);
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
  const entries = await fetchEntries(interaction.user.id);
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
    page: parsed.page,
    filter: parsed.filter,
    sort: parsed.sort ?? 'date',
  });
}
