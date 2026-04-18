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

import { EmbedBuilder } from 'discord.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import {
  createLogger,
  type EnvConfig,
  DISCORD_COLORS,
  characterBrowseOptions,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { toGatewayUser, type GatewayUser } from '../../utils/userGatewayClient.js';
import {
  fetchUserCharacters,
  fetchPublicCharacters,
  fetchUsernames,
  fetchCharacter,
} from './api.js';
import {
  getCharacterDashboardConfig,
  buildCharacterDashboardOptions,
  type CharacterData,
  type CharacterBrowseFilter,
  type CharacterBrowseSortType,
} from './config.js';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  getSessionManager,
} from '../../utils/dashboard/index.js';
import {
  buildBrowseButtons as buildSharedBrowseButtons,
  buildBrowseSelectMenu,
  createBrowseCustomIdHelpers,
  joinFooter,
  pluralize,
  formatFilterLabeled,
  formatSortNatural,
  formatSortVerbatim,
  type BrowseActionRow,
} from '../../utils/browse/index.js';
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

/** Default sort type */
const DEFAULT_SORT: CharacterBrowseSortType = 'date';

/** Valid filters for character browse */
const VALID_FILTERS = ['all', 'mine', 'public'] as const;

/** Browse customId helpers using shared factory */
const browseHelpers = createBrowseCustomIdHelpers<CharacterBrowseFilter>({
  prefix: 'character',
  validFilters: VALID_FILTERS,
});

/**
 * Check if custom ID is a character browse interaction
 */
export function isCharacterBrowseInteraction(customId: string): boolean {
  return browseHelpers.isBrowse(customId);
}

/**
 * Check if custom ID is a character browse select interaction
 */
export function isCharacterBrowseSelectInteraction(customId: string): boolean {
  return browseHelpers.isBrowseSelect(customId);
}

/**
 * Format a character for the select menu — returns the unprefixed
 * label (numbering is added by the buildBrowseSelectMenu factory).
 */
function formatCharacterSelectLabel(item: ListItem): string {
  const char = item.char;
  const visibility = char.isPublic ? '🌐' : '🔒';
  const ownBadge = item.isOwn ? '✏️' : '';
  return `${visibility}${ownBadge} ${char.displayName ?? char.name}`;
}

/**
 * Build the description for a character's select menu option.
 * Slug-prefixed identifier with an optional ownership marker.
 */
function buildCharacterDescription(item: ListItem): string {
  let description = `/${item.char.slug}`;
  if (item.isOwn) {
    description += ' (yours)';
  }
  return description;
}

/**
 * Build pagination buttons using shared utility
 */
function buildBrowseButtons(
  currentPage: number,
  totalPages: number,
  filter: CharacterBrowseFilter,
  currentSort: CharacterBrowseSortType,
  query: string | null
): ReturnType<typeof buildSharedBrowseButtons> {
  return buildSharedBrowseButtons({
    currentPage,
    totalPages,
    filter,
    currentSort,
    query,
    buildCustomId: browseHelpers.build,
    buildInfoId: browseHelpers.buildInfo,
  });
}

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
  embed.setFooter({
    text: joinFooter(
      pluralize(allItems.length, { singular: 'character', plural: 'characters' }),
      filter !== 'all' && formatFilterLabeled(FILTER_LABELS[filter]),
      sortType === 'date' ? formatSortNatural('date') : formatSortVerbatim('Sorted alphabetically'),
      '\uD83C\uDF10 Public \uD83D\uDD12 Private'
    ),
  });

  // Build components
  const components: BrowseActionRow[] = [];

  // Add select menu — factory returns null on empty pageItems
  const selectRow = buildBrowseSelectMenu<ListItem>({
    items: pageItems,
    customId: browseHelpers.buildSelect(safePage, filter, sortType, query),
    placeholder: 'Select a character to view/edit...',
    startIndex: startIdx,
    formatItem: item => ({
      label: formatCharacterSelectLabel(item),
      // Use slug as value to fetch full character data on selection
      value: item.char.slug,
      description: buildCharacterDescription(item),
    }),
  });
  if (selectRow !== null) {
    components.push(selectRow);
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
  const user = toGatewayUser(context.user);
  const options = characterBrowseOptions(context.interaction);
  const query = options.query();
  const filter = (options.filter() ?? 'all') as CharacterBrowseFilter;

  try {
    // Fetch user's own characters and all public characters
    const [ownCharacters, publicCharacters] = await Promise.all([
      fetchUserCharacters(user, config),
      fetchPublicCharacters(user, config),
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
  user: GatewayUser,
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
    fetchUserCharacters(user, config),
    fetchPublicCharacters(user, config),
  ]);

  // Apply filter and query
  const { own, others } = filterCharacters(
    ownCharacters,
    publicCharacters,
    user.discordId,
    filter,
    query
  );

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
  const parsed = browseHelpers.parse(interaction.customId);
  if (parsed === null) {
    return;
  }

  await interaction.deferUpdate();

  try {
    const { embed, components } = await buildBrowseResponse(
      toGatewayUser(interaction.user),
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
  const browseContext = browseHelpers.parseSelect(interaction.customId);

  await interaction.deferUpdate();

  try {
    // Fetch the character with full data
    const character = await fetchCharacter(slug, config, toGatewayUser(interaction.user));

    if (!character) {
      await interaction.editReply({
        content: '❌ Character not found or you do not have access.',
        embeds: [],
        components: [],
      });
      return;
    }

    // Get dashboard config based on edit permissions
    const dashboardConfig = getCharacterDashboardConfig(
      character.canEdit,
      character.hasVoiceReference
    );

    // Create session data with browse context for back navigation
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

    // Build dashboard embed and components using shared options builder
    const embed = buildDashboardEmbed(dashboardConfig, character);
    const components = buildDashboardComponents(
      dashboardConfig,
      character.slug,
      character,
      buildCharacterDashboardOptions(sessionData)
    );

    // Update the message with the dashboard
    await interaction.editReply({ embeds: [embed], components });

    // Store session for tracking
    const sessionManager = getSessionManager();

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
