/**
 * Character Browse Handler
 * Handles /character browse subcommand with optional search and filtering
 *
 * Replaces the old /character list with enhanced functionality:
 * - Optional query parameter for searching by name/slug/displayName
 * - Optional filter parameter (all, mine, public)
 * - Retains sort toggle (date/name) and pagination
 * - Groups characters by owner for better organization
 */

import {
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ActionRowBuilder,
  escapeMarkdown,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { createLogger, type EnvConfig, DISCORD_COLORS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { createListComparator } from '../../utils/listSorting.js';
import {
  fetchUserCharacters,
  fetchPublicCharacters,
  fetchUsernames,
  fetchCharacter,
} from './api.js';
import { getCharacterDashboardConfig, type CharacterData } from './config.js';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  getSessionManager,
} from '../../utils/dashboard/index.js';

const logger = createLogger('character-browse');

/** Characters per page for pagination */
const CHARACTERS_PER_PAGE = 15;

/** Browse filter options */
export type CharacterBrowseFilter = 'all' | 'mine' | 'public';

/** Sort options */
export type CharacterBrowseSortType = 'date' | 'name';

/** Default sort type */
const DEFAULT_SORT: CharacterBrowseSortType = 'date';

/** Custom ID prefix for browse pagination */
const BROWSE_PREFIX = 'character::browse';

/** Custom ID prefix for browse select menu */
const BROWSE_SELECT_PREFIX = 'character::browse-select';

/** Maximum length for select menu option labels */
const MAX_SELECT_LABEL_LENGTH = 100;

/**
 * List item with group markers for rendering.
 * The isGroupStart flag indicates where to render section headers.
 */
interface ListItem {
  char: CharacterData;
  isOwn: boolean;
  isGroupStart: boolean;
  groupHeader?: string;
}

/**
 * Create a character comparator for sorting.
 * Uses shared listSorting utility for consistent sort behavior.
 */
const characterComparator = createListComparator<CharacterData>(
  c => c.displayName ?? c.name,
  c => c.updatedAt
);

/**
 * Build custom ID for browse pagination
 */
function buildBrowseCustomId(
  page: number,
  filter: CharacterBrowseFilter,
  sort: CharacterBrowseSortType,
  query: string | null
): string {
  const encodedQuery = query ?? '';
  return `${BROWSE_PREFIX}::${page}::${filter}::${sort}::${encodedQuery}`;
}

/**
 * Parse browse custom ID
 */
export function parseBrowseCustomId(customId: string): {
  page: number;
  filter: CharacterBrowseFilter;
  sort: CharacterBrowseSortType;
  query: string | null;
} | null {
  if (!customId.startsWith(BROWSE_PREFIX)) {
    return null;
  }

  const parts = customId.split('::');
  if (parts.length < 5) {
    return null;
  }

  const page = parseInt(parts[2], 10);
  const filter = parts[3] as CharacterBrowseFilter;
  const sort = parts[4] as CharacterBrowseSortType;
  const query = parts[5] !== '' ? parts[5] : null;

  if (isNaN(page)) {
    return null;
  }

  if (!['all', 'mine', 'public'].includes(filter)) {
    return null;
  }

  if (!['date', 'name'].includes(sort)) {
    return null;
  }

  return { page, filter, sort, query };
}

/**
 * Check if custom ID is a character browse interaction
 */
export function isCharacterBrowseInteraction(customId: string): boolean {
  return customId.startsWith(BROWSE_PREFIX);
}

/**
 * Check if custom ID is a character browse select interaction
 */
export function isCharacterBrowseSelectInteraction(customId: string): boolean {
  return customId.startsWith(BROWSE_SELECT_PREFIX);
}

/**
 * Format a character line for the list
 */
function formatCharacterLine(c: CharacterData): string {
  const visibility = c.isPublic ? '🌐' : '🔒';
  const displayName = escapeMarkdown(c.displayName ?? c.name);
  return `${visibility} **${displayName}** (\`${c.slug}\`)`;
}

/**
 * Truncate text for select menu label
 */
function truncateForSelect(text: string, maxLength: number = MAX_SELECT_LABEL_LENGTH): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Build select menu for choosing a character from the list
 */
function buildBrowseSelectMenu(
  pageItems: ListItem[],
  startIdx: number
): ActionRowBuilder<StringSelectMenuBuilder> {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(BROWSE_SELECT_PREFIX)
    .setPlaceholder('Select a character to view/edit...')
    .setMinValues(1)
    .setMaxValues(1);

  pageItems.forEach((item, index) => {
    const num = startIdx + index + 1;
    const char = item.char;

    // Build badges
    const visibility = char.isPublic ? '🌐' : '🔒';
    const ownBadge = item.isOwn ? '✏️' : '';

    // Label: "1. 🌐✏️ Character Name"
    const label = truncateForSelect(
      `${num}. ${visibility}${ownBadge} ${char.displayName ?? char.name}`
    );

    // Description: slug + owner indicator
    let description = `/${char.slug}`;
    if (item.isOwn) {
      description += ' (yours)';
    }

    selectMenu.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(label)
        .setValue(char.slug) // Use slug as value to fetch full data
        .setDescription(truncateForSelect(description))
    );
  });

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
}

/**
 * Filter characters by filter type and query
 */
function filterCharacters(
  ownCharacters: CharacterData[],
  publicCharacters: CharacterData[],
  userId: string,
  filter: CharacterBrowseFilter,
  query: string | null
): { own: CharacterData[]; others: CharacterData[] } {
  let own = ownCharacters;
  let others = publicCharacters.filter(c => c.ownerId !== userId);

  // Apply filter
  switch (filter) {
    case 'mine':
      others = []; // Only show owned characters
      break;
    case 'public':
      // Only show public characters (both own public and others' public)
      own = own.filter(c => c.isPublic);
      break;
    case 'all':
    default:
      // Show all accessible
      break;
  }

  // Apply search query
  if (query !== null && query.length > 0) {
    const lowerQuery = query.toLowerCase();
    const matchesQuery = (c: CharacterData): boolean =>
      (c.displayName ?? c.name).toLowerCase().includes(lowerQuery) ||
      c.slug.toLowerCase().includes(lowerQuery) ||
      (c.characterInfo?.toLowerCase().includes(lowerQuery) ?? false);

    own = own.filter(matchesQuery);
    others = others.filter(matchesQuery);
  }

  return { own, others };
}

/**
 * Create sorted, grouped list items ready for pagination.
 * Groups are sorted by owner name, characters within groups by sort type.
 * This ensures owner groups stay together across page boundaries.
 */
function createListItems(
  ownCharacters: CharacterData[],
  othersPublic: CharacterData[],
  creatorNames: Map<string, string>,
  sortType: CharacterBrowseSortType
): ListItem[] {
  const items: ListItem[] = [];

  // Sort own characters
  const sortedOwn = [...ownCharacters].sort(characterComparator(sortType));

  // Add own characters (first group)
  for (let i = 0; i < sortedOwn.length; i++) {
    items.push({
      char: sortedOwn[i],
      isOwn: true,
      isGroupStart: i === 0,
      groupHeader: i === 0 ? `**📝 Your Characters (${ownCharacters.length})**` : undefined,
    });
  }

  if (othersPublic.length === 0) {
    return items;
  }

  // Group by owner
  const byOwner = new Map<string, CharacterData[]>();
  for (const char of othersPublic) {
    const ownerId = char.ownerId ?? 'system';
    const existing = byOwner.get(ownerId) ?? [];
    existing.push(char);
    byOwner.set(ownerId, existing);
  }

  // Sort characters within each owner group
  for (const chars of byOwner.values()) {
    chars.sort(characterComparator(sortType));
  }

  // Sort owner groups by owner name
  const sortedOwnerGroups = [...byOwner.entries()]
    .map(([ownerId, chars]) => ({
      ownerId,
      ownerName: ownerId === 'system' ? 'System' : (creatorNames.get(ownerId) ?? 'Unknown'),
      chars,
    }))
    .sort((a, b) => a.ownerName.localeCompare(b.ownerName));

  // Add section header for "Other Users' Characters"
  let isFirstOthersGroup = true;
  for (const group of sortedOwnerGroups) {
    for (let i = 0; i < group.chars.length; i++) {
      const isGroupStart = i === 0;
      let groupHeader: string | undefined;

      if (isGroupStart) {
        if (isFirstOthersGroup) {
          // First group of others gets the section header
          groupHeader = `**🌍 Other Users' Characters (${othersPublic.length})**\n\n__${escapeMarkdown(group.ownerName)}__`;
          isFirstOthersGroup = false;
        } else {
          // Subsequent groups just get owner subheader
          groupHeader = `\n__${escapeMarkdown(group.ownerName)}__`;
        }
      }

      items.push({
        char: group.chars[i],
        isOwn: false,
        isGroupStart,
        groupHeader,
      });
    }
  }

  return items;
}

/**
 * Build pagination and sort buttons for browse
 */
function buildBrowseButtons(
  currentPage: number,
  totalPages: number,
  filter: CharacterBrowseFilter,
  currentSort: CharacterBrowseSortType,
  query: string | null
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();

  // Previous button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildBrowseCustomId(currentPage - 1, filter, currentSort, query))
      .setLabel('◀ Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage === 0)
  );

  // Page indicator (disabled)
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`${BROWSE_PREFIX}::info`)
      .setLabel(`Page ${currentPage + 1} of ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true)
  );

  // Next button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildBrowseCustomId(currentPage + 1, filter, currentSort, query))
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages - 1)
  );

  // Sort toggle button
  const newSort: CharacterBrowseSortType = currentSort === 'date' ? 'name' : 'date';
  const sortLabel = currentSort === 'date' ? '🔤 Sort A-Z' : '📅 Sort by Date';
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildBrowseCustomId(currentPage, filter, newSort, query))
      .setLabel(sortLabel)
      .setStyle(ButtonStyle.Primary)
  );

  return row;
}

/** Filter labels for display */
const FILTER_LABELS: Record<CharacterBrowseFilter, string> = {
  all: 'All',
  mine: 'My Characters',
  public: 'Public Only',
};

/**
 * Build the search/filter info line for the embed description
 */
function buildFilterLine(query: string | null, filter: CharacterBrowseFilter): string | null {
  if (query !== null) {
    return `🔍 Searching: "${query}" • Filter: ${FILTER_LABELS[filter]}\n`;
  }
  if (filter !== 'all') {
    return `Filter: ${FILTER_LABELS[filter]}\n`;
  }
  return null;
}

/**
 * Build empty state lines when user has no own characters
 */
function buildEmptyStateLines(
  safePage: number,
  ownCount: number,
  filter: CharacterBrowseFilter,
  hasOthersOnPage: boolean
): string[] {
  const lines: string[] = [];
  if (safePage === 0 && ownCount === 0 && filter !== 'public') {
    lines.push(`**📝 Your Characters (0)**`);
    lines.push("_You don't have any characters yet._");
    lines.push('Use `/character create` to create your first one!');
    if (hasOthersOnPage) {
      lines.push('');
    }
  }
  return lines;
}

/**
 * Render page items with their group headers
 */
function renderPageItems(pageItems: ListItem[], existingLinesLength: number): string[] {
  const lines: string[] = [];
  for (const item of pageItems) {
    if (item.groupHeader !== undefined) {
      // Add separator before "Other Users" section if coming from own chars
      const totalLines = existingLinesLength + lines.length;
      const lastLine = lines.length > 0 ? lines[lines.length - 1] : '';
      if (!item.isOwn && totalLines > 0 && !lastLine.startsWith('**🌍')) {
        lines.push('');
      }
      lines.push(item.groupHeader);
    }
    lines.push(formatCharacterLine(item.char));
  }
  return lines;
}

/** Union type for action rows that can contain buttons or select menus */
type BrowseActionRow = ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>;

/** Options for buildBrowsePage */
interface BuildBrowsePageOptions {
  allItems: ListItem[];
  ownCount: number;
  page: number;
  filter: CharacterBrowseFilter;
  sortType: CharacterBrowseSortType;
  query: string | null;
}

/**
 * Build the browse embed and components
 */
function buildBrowsePage(options: BuildBrowsePageOptions): {
  embed: EmbedBuilder;
  components: BrowseActionRow[];
} {
  const { allItems, ownCount, page, filter, sortType, query } = options;

  const totalPages = Math.max(1, Math.ceil(allItems.length / CHARACTERS_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);

  const startIdx = safePage * CHARACTERS_PER_PAGE;
  const endIdx = Math.min(startIdx + CHARACTERS_PER_PAGE, allItems.length);
  const pageItems = allItems.slice(startIdx, endIdx);

  // Build description lines
  const lines: string[] = [];

  const filterLine = buildFilterLine(query, filter);
  if (filterLine !== null) {
    lines.push(filterLine);
  }

  const hasOthersOnPage = pageItems.length > 0 && !pageItems[0].isOwn;
  const emptyLines = buildEmptyStateLines(safePage, ownCount, filter, hasOthersOnPage);
  lines.push(...emptyLines);

  // Check if no results at all
  if (allItems.length === 0 && lines.length === 0 && (query !== null || filter !== 'all')) {
    lines.push('_No characters match your search._');
  }

  // Render page items
  const itemLines = renderPageItems(pageItems, lines.length);
  lines.push(...itemLines);

  // Build embed
  const embed = new EmbedBuilder()
    .setTitle('📚 Character Browser')
    .setColor(DISCORD_COLORS.BLURPLE)
    .setDescription(lines.join('\n') || 'No characters found.')
    .setTimestamp();

  // Footer with legend
  const sortLabel = sortType === 'date' ? 'by date' : 'alphabetically';
  const footerParts = [`${allItems.length} characters`];
  if (filter !== 'all') {
    footerParts.push(`filtered by: ${FILTER_LABELS[filter]}`);
  }
  footerParts.push(`Sorted ${sortLabel} • 🌐 Public 🔒 Private`);
  embed.setFooter({ text: footerParts.join(' • ') });

  // Build components
  const components: BrowseActionRow[] = [];

  // Add select menu if there are items on this page
  if (pageItems.length > 0) {
    components.push(buildBrowseSelectMenu(pageItems, startIdx));
  }

  // Add pagination buttons if multiple pages or items exist
  if (totalPages > 1 || allItems.length > 0) {
    components.push(buildBrowseButtons(safePage, totalPages, filter, sortType, query));
  }

  return { embed, components };
}

/**
 * Handle /character browse [query?] [filter?]
 */
export async function handleBrowse(
  context: DeferredCommandContext,
  config: EnvConfig
): Promise<void> {
  const userId = context.user.id;
  const query = context.interaction.options.getString('query');
  const filterStr = context.interaction.options.getString('filter') ?? 'all';
  const filter = filterStr as CharacterBrowseFilter;

  try {
    // Fetch user's own characters and all public characters
    const [ownCharacters, publicCharacters] = await Promise.all([
      fetchUserCharacters(userId, config),
      fetchPublicCharacters(userId, config),
    ]);

    // Apply filter and query
    const { own, others } = filterCharacters(
      ownCharacters,
      publicCharacters,
      userId,
      filter,
      query
    );

    // Fetch creator usernames for others' characters
    const creatorIds = [...new Set(others.map(c => c.ownerId).filter(Boolean))] as string[];
    const creatorNames = await fetchUsernames(context.interaction.client, creatorIds);

    // Create sorted, grouped items
    const allItems = createListItems(own, others, creatorNames, DEFAULT_SORT);

    // Build first page
    const { embed, components } = buildBrowsePage({
      allItems,
      ownCount: own.length,
      page: 0,
      filter,
      sortType: DEFAULT_SORT,
      query,
    });

    await context.editReply({ embeds: [embed], components });

    logger.info(
      { userId, total: ownCharacters.length + others.length, filter, query },
      '[Character] Browse characters'
    );
  } catch (error) {
    logger.error({ err: error, userId }, '[Character] Failed to browse characters');
    await context.editReply('❌ Failed to load characters. Please try again.');
  }
}

/**
 * Handle browse pagination button clicks
 */
export async function handleBrowsePagination(
  interaction: ButtonInteraction,
  config: EnvConfig
): Promise<void> {
  const parsed = parseBrowseCustomId(interaction.customId);
  if (parsed === null) {
    return;
  }

  await interaction.deferUpdate();

  const { page, filter, sort, query } = parsed;
  const userId = interaction.user.id;

  try {
    // Re-fetch character data
    const [ownCharacters, publicCharacters] = await Promise.all([
      fetchUserCharacters(userId, config),
      fetchPublicCharacters(userId, config),
    ]);

    // Apply filter and query
    const { own, others } = filterCharacters(
      ownCharacters,
      publicCharacters,
      userId,
      filter,
      query
    );

    // Fetch creator usernames
    const creatorIds = [...new Set(others.map(c => c.ownerId).filter(Boolean))] as string[];
    const creatorNames = await fetchUsernames(interaction.client, creatorIds);

    // Create sorted, grouped items with the specified sort
    const allItems = createListItems(own, others, creatorNames, sort);

    // Build requested page
    const { embed, components } = buildBrowsePage({
      allItems,
      ownCount: own.length,
      page,
      filter,
      sortType: sort,
      query,
    });

    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    logger.error(
      { err: error, userId, page, filter, sort },
      '[Character] Failed to load browse page'
    );
    // Keep existing content on error
  }
}

/**
 * Handle browse select menu - open character dashboard
 */
export async function handleBrowseSelect(
  interaction: StringSelectMenuInteraction,
  config: EnvConfig
): Promise<void> {
  const slug = interaction.values[0];
  const userId = interaction.user.id;

  await interaction.deferUpdate();

  try {
    // Fetch the character with full data
    const character = await fetchCharacter(slug, config, userId);

    if (!character) {
      await interaction.editReply({
        content: '❌ Character not found or you do not have access.',
        embeds: [],
        components: [],
      });
      return;
    }

    // Get dashboard config based on edit permissions
    const dashboardConfig = getCharacterDashboardConfig(character.canEdit);

    // Build dashboard embed and components
    const embed = buildDashboardEmbed(dashboardConfig, character);
    const components = buildDashboardComponents(dashboardConfig, character.slug, character, {
      showClose: true,
      showRefresh: true,
      showDelete: character.canEdit && character.ownerId === userId,
    });

    // Update the message with the dashboard
    await interaction.editReply({ embeds: [embed], components });

    // Create session for tracking
    const sessionManager = getSessionManager();
    await sessionManager.set<CharacterData>({
      userId,
      entityType: 'character',
      entityId: character.slug,
      data: character,
      messageId: interaction.message.id,
      channelId: interaction.channelId,
    });

    logger.info(
      { userId, slug, name: character.displayName ?? character.name, canEdit: character.canEdit },
      '[Character] Opened dashboard from browse'
    );
  } catch (error) {
    logger.error({ err: error, slug }, '[Character] Failed to open dashboard from browse');
    await interaction.editReply({
      content: '❌ Failed to load character. Please try again.',
      embeds: [],
      components: [],
    });
  }
}
