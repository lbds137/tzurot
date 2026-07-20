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
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type EmbedBuilder,
  escapeMarkdown,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { type EnvConfig, getConfig } from '@tzurot/common-types/config/config';
import { characterBrowseOptions } from '@tzurot/common-types/generated/commandOptions';
import { AUTOCOMPLETE_BADGES } from '@tzurot/common-types/utils/autocompleteFormat';
import { ENTITY_EMOJI, buildBadgeLegend } from '@tzurot/common-types/constants/uxVocabulary';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import type { UserClient } from '@tzurot/clients';
import { clientsFor } from '../../utils/gatewayClients.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import {
  fetchUserCharacters,
  fetchPublicCharacters,
  fetchUsernames,
  fetchCharacter,
} from './api.js';
import {
  getCharacterDashboardConfig,
  buildCharacterDashboardOptions,
  type CharacterBrowseFilter,
  type CharacterBrowseSortType,
} from './config.js';
import type { CharacterData } from './characterTypes.js';
import { buildRedactedViewPage } from './view.js';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  getSessionManager,
  registerBrowseRebuilder,
} from '../../utils/dashboard/index.js';
import {
  buildBrowseButtons as buildSharedBrowseButtons,
  buildBrowseListEmbed,
  buildBrowseSelectMenu,
  buildFilterToggleButton,
  createBrowseCustomIdHelpers,
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
  FILTER_LABELS,
  FILTER_TOGGLE_DISPLAY,
  buildCharacterDescription,
  formatCharacterSelectLabel,
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
 * Build pagination buttons using shared utility, plus the in-place filter
 * toggle (all → mine → public — same coordinates, filter advanced, page 0).
 */
function buildBrowseButtons(
  currentPage: number,
  totalPages: number,
  filter: CharacterBrowseFilter,
  currentSort: CharacterBrowseSortType,
  query: string | null
): ReturnType<typeof buildSharedBrowseButtons> {
  const row = buildSharedBrowseButtons({
    currentPage,
    totalPages,
    filter,
    currentSort,
    query,
    buildCustomId: browseHelpers.build,
    buildInfoId: browseHelpers.buildInfo,
  });
  row.addComponents(
    buildFilterToggleButton({
      filters: VALID_FILTERS,
      display: FILTER_TOGGLE_DISPLAY,
      current: filter,
      buildCustomId: browseHelpers.build,
      sort: currentSort,
      query,
    })
  );
  return row;
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

  // Preamble: search/filter context + the own-section-empty CTA. The CTA is
  // preamble (not the builder's empty state) because it renders ABOVE other
  // users' rows — but ONLY when the list has content: on a fully-empty list
  // the builder's D19 empty state is the single message, and stacking the
  // CTA on top of it would duplicate/contradict it (the old code's
  // `lines.length === 0` guard, carried over to the split).
  const preamble: string[] = [];
  const filterLine = buildFilterLine(query, filter);
  if (filterLine !== null) {
    preamble.push(filterLine);
  }
  if (allItems.length > 0) {
    // Clamp before the page===0 check — callers pre-clamp today, but the
    // guard must not depend on that. Mirrors the builder's own clamp: the
    // two must stay in sync if itemsPerPage semantics ever change.
    const totalPages = Math.max(1, Math.ceil(allItems.length / CHARACTERS_PER_PAGE));
    const clampedPage = Math.min(Math.max(0, page), totalPages - 1);
    const hasOthersInList = !allItems[0].isOwn;
    preamble.push(...buildEmptyStateLines(clampedPage, ownCount, filter, hasOthersInList));
  }

  const {
    embed,
    pageItems,
    startIndex,
    totalPages,
    safePage: renderedPage,
  } = buildBrowseListEmbed<ListItem>({
    entityEmoji: ENTITY_EMOJI.character,
    titleNoun: 'Characters',
    items: allItems,
    page,
    itemsPerPage: CHARACTERS_PER_PAGE,
    preamble,
    formatRow: item => ({
      groupHeader: item.groupHeader,
      badges: `${item.char.isPublic ? AUTOCOMPLETE_BADGES.PUBLIC : AUTOCOMPLETE_BADGES.OWNED}${item.isOwn ? AUTOCOMPLETE_BADGES.EDITABLE : ''}`,
      name: escapeMarkdown(item.char.displayName ?? item.char.name),
      // Slugs are typed in @mentions — the §2.4 case where the tech-id
      // belongs in the row.
      techId: item.char.slug,
    }),
    empty: {
      noItems: "You haven't created any characters yet — start with `/character create`.",
      noMatch: 'No characters match — clear the search or filter to see all.',
    },
    filterActive: query !== null || filter !== 'all',
    footerSegments: [
      pluralize(allItems.length, { singular: 'character', plural: 'characters' }),
      filter !== 'all' && formatFilterLabeled(FILTER_LABELS[filter]),
      sortType === 'date' ? formatSortNatural('date') : formatSortVerbatim('Sorted alphabetically'),
    ],
    badgeLegend: buildBadgeLegend(['PUBLIC', 'OWNED', 'EDITABLE']),
  });

  // Build components
  const components: BrowseActionRow[] = [];

  // Add select menu — factory returns null on empty pageItems
  const selectRow = buildBrowseSelectMenu<ListItem>({
    items: pageItems,
    customId: browseHelpers.buildSelect(renderedPage, filter, sortType, query),
    placeholder: 'Select a character to view/edit...',
    startIndex,
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

  // The button row always renders on filter-bearing browses (alias-pilot
  // norm): the filter toggle must stay reachable even on an empty filtered
  // list — it's the way back out. Pagination buttons disable at one page.
  components.push(buildBrowseButtons(renderedPage, totalPages, filter, sortType, query));

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
  const { userClient } = clientsFor(context.interaction);
  const options = characterBrowseOptions(context.interaction);
  const query = options.query();
  const filter = (options.filter() ?? 'all') as CharacterBrowseFilter;

  try {
    // Fetch user's own characters and all public characters
    const [ownCharacters, publicCharacters] = await Promise.all([
      fetchUserCharacters(userClient, config),
      fetchPublicCharacters(userClient, config),
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
      'Browse characters'
    );
  } catch (error) {
    logger.error({ err: error, userId }, 'Failed to browse characters');
    await context.editReply(
      renderSpec(classifyGatewayFailure(error, 'characters', { operation: 'read' }))
    );
  }
}

/**
 * Build browse response for a given context
 * Reusable for pagination and back-from-dashboard navigation
 */
export async function buildBrowseResponse(
  userClient: UserClient,
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
    fetchUserCharacters(userClient, config),
    fetchPublicCharacters(userClient, config),
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

// Register the character browse rebuilder with the shared registry at module
// load time. Consumed by `renderPostActionScreen` (destructive-action success
// → direct re-render) and `handleSharedBackButton` (Back-to-Browse click).
//
// Character's rebuilder is unique among the four commands in that
// buildBrowseResponse needs `client` (for fetchUsernames) and `config` (for
// REST endpoint URLs). The adapter captures both from the live interaction
// and the static getConfig() — neither is stored in the session.
registerBrowseRebuilder('character', async (interaction, browseContext, successBanner) => {
  try {
    const { userClient } = clientsFor(interaction);
    const result = await buildBrowseResponse(
      userClient,
      interaction.user.id,
      interaction.client,
      getConfig(),
      {
        page: browseContext.page,
        filter: browseContext.filter as CharacterBrowseFilter,
        sort: (browseContext.sort ?? 'date') as CharacterBrowseSortType,
        query: browseContext.query ?? null,
      }
    );
    return {
      content: successBanner,
      embeds: [result.embed],
      components: result.components,
    };
  } catch (error) {
    logger.error({ err: error, userId: interaction.user.id }, 'Browse rebuilder threw');
    return null;
  }
});

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
    const { userClient } = clientsFor(interaction);
    const { embed, components } = await buildBrowseResponse(
      userClient,
      interaction.user.id,
      interaction.client,
      config,
      parsed
    );

    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    logger.error(
      { err: error, userId: interaction.user.id, ...parsed },
      'Failed to load browse page'
    );
    // Keep existing content on error
  }
}

/**
 * Show the private-definition state for a browse-detail open. A non-owner of
 * a definition-private character must NOT get the dashboard — its section
 * previews would all render "_Not configured_", reading as an abandoned
 * character. Reuses /character view's redacted page; keeps Back-to-Browse
 * (same customId contract as renderTerminalScreen) when browse context exists.
 */
async function showRedactedDetail(
  interaction: StringSelectMenuInteraction,
  character: CharacterData,
  hasBrowseContext: boolean
): Promise<void> {
  const { embed } = buildRedactedViewPage(character);
  const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`character::back::${character.slug}`)
      .setLabel('Back to Browse')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
  );
  await interaction.editReply({
    embeds: [embed],
    components: hasBrowseContext ? [backRow] : [],
  });
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
    const { userClient } = clientsFor(interaction);
    // Fetch the character with full data
    const character = await fetchCharacter(slug, config, userClient);

    if (!character) {
      await interaction.editReply({
        content: renderSpec(CATALOG.error.notFound('Character')),
        embeds: [],
        components: [],
      });
      return;
    }

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

    if (character.definitionRedacted) {
      await showRedactedDetail(interaction, character, browseContext !== null);
    } else {
      // Get dashboard config based on edit permissions
      const dashboardConfig = getCharacterDashboardConfig(
        character.canEdit,
        character.hasVoiceReference
      );

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
    }

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
      character.definitionRedacted
        ? 'Opened redacted view from browse'
        : 'Opened dashboard from browse'
    );
  } catch (error) {
    logger.error({ err: error, slug }, 'Failed to open dashboard from browse');
    await interaction.editReply({
      content: renderSpec(classifyGatewayFailure(error, 'character', { operation: 'read' })),
      embeds: [],
      components: [],
    });
  }
}
