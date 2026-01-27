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
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { createLogger, type EnvConfig, DISCORD_COLORS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
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
import { truncateForSelect } from '../../utils/browse/index.js';
import {
  type ListItem,
  filterCharacters,
  createListItems,
  buildFilterLine,
  buildEmptyStateLines,
  renderPageItems,
  FILTER_LABELS,
} from './browseHelpers.js';

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
 * Build custom ID for browse select menu with context
 * Format: character::browse-select::page::filter::sort::query
 */
function buildBrowseSelectCustomId(
  page: number,
  filter: CharacterBrowseFilter,
  sort: CharacterBrowseSortType,
  query: string | null
): string {
  // Truncate query to fit within Discord's 100-char customId limit
  // Base format is ~40 chars, leaving ~60 for query
  const truncatedQuery = query !== null && query.length > 50 ? query.slice(0, 50) : (query ?? '');
  return `${BROWSE_SELECT_PREFIX}::${page}::${filter}::${sort}::${truncatedQuery}`;
}

/**
 * Parse browse select custom ID to extract context
 */
export function parseBrowseSelectCustomId(customId: string): {
  page: number;
  filter: CharacterBrowseFilter;
  sort: CharacterBrowseSortType;
  query: string | null;
} | null {
  if (!customId.startsWith(BROWSE_SELECT_PREFIX)) {
    return null;
  }

  const parts = customId.split('::');
  if (parts.length < 5) {
    // Legacy format without context - return defaults
    return { page: 0, filter: 'all', sort: 'date', query: null };
  }

  const page = parseInt(parts[2], 10);
  const filter = parts[3] as CharacterBrowseFilter;
  const sort = parts[4] as CharacterBrowseSortType;
  const query = parts[5] !== '' ? parts[5] : null;

  if (isNaN(page)) {
    return { page: 0, filter: 'all', sort: 'date', query: null };
  }

  return { page, filter, sort, query };
}

/** Options for buildBrowseSelectMenu */
interface BrowseSelectMenuOptions {
  pageItems: ListItem[];
  startIdx: number;
  page: number;
  filter: CharacterBrowseFilter;
  sort: CharacterBrowseSortType;
  query: string | null;
}

/**
 * Build select menu for choosing a character from the list
 */
function buildBrowseSelectMenu(
  options: BrowseSelectMenuOptions
): ActionRowBuilder<StringSelectMenuBuilder> {
  const { pageItems, startIdx, page, filter, sort, query } = options;

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(buildBrowseSelectCustomId(page, filter, sort, query))
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
    components.push(
      buildBrowseSelectMenu({ pageItems, startIdx, page: safePage, filter, sort: sortType, query })
    );
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
 * Build browse response for a given context
 * Reusable for pagination and back-from-dashboard navigation
 */
export async function buildBrowseResponse(
  userId: string,
  client: ButtonInteraction['client'],
  config: EnvConfig,
  browseContext: {
    page: number;
    filter: CharacterBrowseFilter;
    sort: CharacterBrowseSortType;
    query: string | null;
  }
): Promise<{ embed: EmbedBuilder; components: BrowseActionRow[] }> {
  const { page, filter, sort, query } = browseContext;

  // Re-fetch character data
  const [ownCharacters, publicCharacters] = await Promise.all([
    fetchUserCharacters(userId, config),
    fetchPublicCharacters(userId, config),
  ]);

  // Apply filter and query
  const { own, others } = filterCharacters(ownCharacters, publicCharacters, userId, filter, query);

  // Fetch creator usernames
  const creatorIds = [...new Set(others.map(c => c.ownerId).filter(Boolean))] as string[];
  const creatorNames = await fetchUsernames(client, creatorIds);

  // Create sorted, grouped items with the specified sort
  const allItems = createListItems(own, others, creatorNames, sort);

  // Build requested page (with bounds checking)
  const totalPages = Math.max(1, Math.ceil(allItems.length / CHARACTERS_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);

  return buildBrowsePage({
    allItems,
    ownCount: own.length,
    page: safePage,
    filter,
    sortType: sort,
    query,
  });
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

  try {
    const { embed, components } = await buildBrowseResponse(
      interaction.user.id,
      interaction.client,
      config,
      parsed
    );

    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    logger.error(
      { err: error, userId: interaction.user.id, ...parsed },
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

  // Parse browse context from customId
  const browseContext = parseBrowseSelectCustomId(interaction.customId);

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

    // Build dashboard embed and components - show back button since we're coming from browse
    const embed = buildDashboardEmbed(dashboardConfig, character);
    const components = buildDashboardComponents(dashboardConfig, character.slug, character, {
      showBack: true, // Show "Back to Browse" instead of close
      showRefresh: true,
      showDelete: character.canEdit, // canEdit is server-side authoritative permission
    });

    // Update the message with the dashboard
    await interaction.editReply({ embeds: [embed], components });

    // Create session for tracking - include browse context for back navigation
    const sessionManager = getSessionManager();
    const sessionData: CharacterData = {
      ...character,
      browseContext: browseContext
        ? {
            source: 'browse',
            page: browseContext.page,
            filter: browseContext.filter,
            sort: browseContext.sort,
            query: browseContext.query,
          }
        : undefined,
    };

    await sessionManager.set<CharacterData>({
      userId,
      entityType: 'character',
      entityId: character.slug,
      data: sessionData,
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
