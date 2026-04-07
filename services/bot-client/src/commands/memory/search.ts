/**
 * Memory Search Handler
 *
 * Router-pattern implementation (no inline collectors) for /memory search.
 * State (query, personality filter, searchType, current page) lives in a
 * dashboard session keyed by messageId so pagination and detail "back"
 * buttons survive bot restarts.
 *
 * Uses rolling-window pagination (no total count from API):
 * - If hasMore is true: show "Page X of X+1+"
 * - If hasMore is false: current page is the last page
 */

import type {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from 'discord.js';
import { escapeMarkdown, EmbedBuilder, MessageFlags } from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  memorySearchOptions,
  formatDateShort,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import {
  createBrowseCustomIdHelpers,
  buildBrowseButtons as buildSharedBrowseButtons,
} from '../../utils/browse/index.js';
import { resolveOptionalPersonality } from './resolveHelpers.js';
import { buildMemorySelectMenu, handleMemorySelect, type MemoryItem } from './detail.js';
import type { ListContext } from './detailApi.js';
import { handleMemoryDetailAction } from './detailActionRouter.js';
import { formatSimilarity, truncateContent } from './formatters.js';
import {
  saveMemoryListSession,
  findMemoryListSessionByMessage,
  updateMemoryListSessionPage,
  MEMORY_SEARCH_ENTITY_TYPE,
} from './browseSession.js';

/** Union type for action rows containing buttons or select menus */
type SearchActionRow = ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>;

const logger = createLogger('memory-search');

/**
 * Default page size when the user doesn't pass `limit`. The slash
 * command bounds limit to 1–10, so the actual session pageSize is
 * always within that range.
 */
const DEFAULT_RESULTS_PER_PAGE = 5;

/** Search customId helpers — filter is always 'all', query stored in session */
export const searchHelpers = createBrowseCustomIdHelpers<'all'>({
  prefix: MEMORY_SEARCH_ENTITY_TYPE,
  validFilters: ['all'],
  includeSort: false,
});

/** Prefix exported for componentPrefixes registration */
export const MEMORY_SEARCH_PREFIX = MEMORY_SEARCH_ENTITY_TYPE;

/**
 * Check if a customId belongs to a memory search pagination interaction.
 */
export function isMemorySearchPagination(customId: string): boolean {
  return searchHelpers.isBrowse(customId) || searchHelpers.isBrowseSelect(customId);
}

interface SearchResult extends MemoryItem {
  similarity: number | null; // null for text search results
}

interface SearchResponse {
  results: SearchResult[];
  count: number;
  hasMore: boolean;
  searchType?: 'semantic' | 'text'; // undefined for backwards compatibility
}

interface BuildSearchEmbedOptions {
  results: SearchResult[];
  query: string;
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
  searchType?: 'semantic' | 'text';
  personalityFilter?: string;
}

/**
 * Build the search results embed
 */
function buildSearchEmbed(options: BuildSearchEmbedOptions): EmbedBuilder {
  const { results, query, page, pageSize, totalPages, hasMore, searchType, personalityFilter } =
    options;
  const isTextFallback = searchType === 'text';

  const embed = new EmbedBuilder().setTitle('🔍 Memory Search').setColor(DISCORD_COLORS.BLURPLE);

  if (results.length === 0) {
    embed.setDescription(
      `No memories found matching: **${escapeMarkdown(truncateContent(query, 50))}**\n\nTry a different search query or check if you have memories with this personality.`
    );
    return embed;
  }

  // Build results description
  const lines: string[] = [`Results for: **${escapeMarkdown(truncateContent(query, 50))}**`, ''];

  results.forEach((memory, index) => {
    const num = page * pageSize + index + 1;
    const lockIcon = memory.isLocked ? ' 🔒' : '';
    const similarity = formatSimilarity(memory.similarity);
    const content = truncateContent(escapeMarkdown(memory.content));
    const date = formatDateShort(memory.createdAt);
    const personality = escapeMarkdown(memory.personalityName);

    lines.push(`**${num}.** ${content}${lockIcon}`);
    lines.push(`   _${personality} • ${similarity} • ${date}_`);
    lines.push('');
  });

  embed.setDescription(lines.join('\n').trim());

  // Build footer
  const footerParts: string[] = [];
  footerParts.push(isTextFallback ? 'Text search' : 'Semantic search');
  if (personalityFilter !== undefined) {
    footerParts.push('Filtered');
  }
  footerParts.push(`Page ${page + 1} of ${totalPages}${hasMore ? '+' : ''}`);

  embed.setFooter({ text: footerParts.join(' • ') });

  return embed;
}

/**
 * Compute total pages using rolling-window approach (API doesn't return total count).
 *
 * - `hasMore`: at least one more page exists, show "Page X of X+1+"
 * - otherwise: current page is the last (or only) page
 *
 * The `Math.max(1, ...)` floor ensures the zero-results empty state displays
 * "Page 1 of 1" rather than "Page 1 of 0", which would be confusing. The empty
 * state embed handles the "no results" messaging separately.
 */
function computeTotalPages(page: number, hasMore: boolean, resultCount: number): number {
  return hasMore ? page + 2 : Math.max(1, page + (resultCount > 0 ? 1 : 0));
}

/**
 * Build the embed and components for a search results view
 */
function buildSearchView(opts: {
  data: SearchResponse;
  query: string;
  page: number;
  pageSize: number;
  personalityId: string | undefined;
  searchType: 'semantic' | 'text' | undefined;
}): {
  embed: EmbedBuilder;
  components: SearchActionRow[];
} {
  const { data, query, page, pageSize, personalityId, searchType } = opts;
  const totalPages = computeTotalPages(page, data.hasMore, data.results.length);

  const embed = buildSearchEmbed({
    results: data.results,
    query,
    page,
    pageSize,
    totalPages,
    hasMore: data.hasMore,
    searchType: data.searchType ?? searchType,
    personalityFilter: personalityId,
  });

  const components: SearchActionRow[] =
    data.results.length > 0
      ? [
          buildMemorySelectMenu(data.results, page, pageSize),
          buildSharedBrowseButtons({
            currentPage: page,
            totalPages,
            filter: 'all',
            currentSort: 'date',
            query: null,
            buildCustomId: searchHelpers.build,
            buildInfoId: searchHelpers.buildInfo,
          }),
        ]
      : [];

  return { embed, components };
}

interface FetchSearchOptions {
  userId: string;
  query: string;
  personalityId?: string;
  offset: number;
  limit: number;
  /** Skip semantic search attempt (e.g., when first page fell back to text) */
  preferTextSearch?: boolean;
}

/**
 * Fetch search results from API
 */
async function fetchSearchResults(options: FetchSearchOptions): Promise<SearchResponse | null> {
  const { userId, query, personalityId, offset, limit, preferTextSearch } = options;

  const requestBody: Record<string, unknown> = {
    query,
    limit,
    offset,
  };

  if (personalityId !== undefined) {
    requestBody.personalityId = personalityId;
  }

  // Optimization: skip semantic search attempt if we know first page fell back to text
  if (preferTextSearch === true) {
    requestBody.preferTextSearch = true;
  }

  const result = await callGatewayApi<SearchResponse>('/user/memory/search', {
    userId,
    method: 'POST',
    body: requestBody,
  });

  if (!result.ok) {
    return null;
  }

  return result.data;
}

/**
 * Handle /memory search command
 */
export async function handleSearch(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = memorySearchOptions(context.interaction);
  const query = options.query();
  const personalityInput = options.personality();
  // The slash command bounds limit to 1–10; default to 5 when omitted.
  // Persisted in the session so pagination uses the same size as the
  // original search rather than reverting to the default.
  const pageSize = options.limit() ?? DEFAULT_RESULTS_PER_PAGE;

  try {
    // Resolve personality if provided
    const personalityId = await resolveOptionalPersonality(context, userId, personalityInput);
    if (personalityId === null) {
      return;
    }

    // Fetch first page
    const data = await fetchSearchResults({
      userId,
      query,
      personalityId,
      offset: 0,
      limit: pageSize,
    });

    if (data === null) {
      logger.warn({ userId, query: query.substring(0, 50) }, '[Memory] Search failed');
      await context.editReply({ content: '❌ Failed to search memories. Please try again later.' });
      return;
    }

    const { searchType } = data;

    // Build initial view
    const { embed, components } = buildSearchView({
      data,
      query,
      page: 0,
      pageSize,
      personalityId,
      searchType,
    });

    const response = await context.editReply({ embeds: [embed], components });

    // Persist session for pagination + detail view "back" button.
    // searchType is captured from the first response so subsequent pages
    // can skip the semantic attempt if the first page already fell back
    // to text — avoids an extra embedding round-trip per pagination click.
    await saveMemoryListSession({
      userId,
      messageId: response.id,
      channelId: response.channelId,
      data: {
        kind: 'search',
        personalityId,
        currentPage: 0,
        searchQuery: query,
        pageSize,
        searchType,
      },
    });

    logger.info(
      {
        userId,
        queryLength: query.length,
        personalityId,
        pageSize,
        resultCount: data.results.length,
        hasMore: data.hasMore,
        searchType: searchType ?? 'semantic',
      },
      '[Memory] Search displayed'
    );
  } catch (error) {
    logger.error({ err: error, userId }, '[Memory Search] Unexpected error');
    await context.editReply({ content: '❌ An unexpected error occurred. Please try again.' });
  }
}

/**
 * Handle pagination button clicks for /memory search.
 * Parses the new page from the custom ID, looks up query/personality from
 * the session, re-fetches, and updates the message.
 */
export async function handleSearchPagination(interaction: ButtonInteraction): Promise<void> {
  const parsed = searchHelpers.parse(interaction.customId);
  if (parsed === null) {
    return;
  }

  const messageId = interaction.message.id;
  const session = await findMemoryListSessionByMessage(messageId);
  if (session?.data.kind !== 'search') {
    await interaction.reply({
      content: '⏰ This interaction has expired. Please run `/memory search` again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Discriminated union narrowing: searchQuery is required on the search
  // variant, so it's guaranteed to be a string here. searchType is optional
  // and only set when the first page returned 'text' (or backwards-compat undefined).
  const { personalityId, searchQuery, pageSize, searchType } = session.data;

  await interaction.deferUpdate();

  const userId = interaction.user.id;
  const newPage = parsed.page;

  const data = await fetchSearchResults({
    userId,
    query: searchQuery,
    personalityId,
    offset: newPage * pageSize,
    limit: pageSize,
    preferTextSearch: searchType === 'text',
  });
  if (data === null) {
    await interaction.followUp({
      content: '❌ Failed to load page. Please try again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { embed, components } = buildSearchView({
    data,
    query: searchQuery,
    page: newPage,
    pageSize,
    personalityId,
    searchType: data.searchType,
  });

  await interaction.editReply({ embeds: [embed], components });

  await updateMemoryListSessionPage({
    userId,
    messageId,
    kind: 'search',
    newPage,
  });
}

/**
 * Handle select menu interaction — user picked a memory from search results.
 */
export async function handleSearchSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const messageId = interaction.message.id;
  const session = await findMemoryListSessionByMessage(messageId);

  // Type-narrow to the search variant — searchQuery only exists when kind === 'search'.
  // If the session is missing or somehow a browse session, fall back to defaults.
  const searchSession = session?.data.kind === 'search' ? session.data : null;
  const listContext: ListContext = {
    source: 'search',
    page: searchSession?.currentPage ?? 0,
    personalityId: searchSession?.personalityId,
    query: searchSession?.searchQuery,
  };

  await handleMemorySelect(interaction, listContext);
}

/**
 * Refresh the search view — called from the detail action router when the
 * user clicks "back" or after a successful delete.
 */
export async function refreshSearchList(interaction: ButtonInteraction): Promise<void> {
  const messageId = interaction.message.id;
  const session = await findMemoryListSessionByMessage(messageId);
  if (session?.data.kind !== 'search') {
    return;
  }

  // Discriminated union narrowing: searchQuery is required on the search variant.
  // searchType is captured from the first page's response and threaded through
  // so we don't waste an embedding round-trip if the first page fell back to text.
  const { personalityId, searchQuery, pageSize, searchType } = session.data;

  const userId = interaction.user.id;
  let pageToFetch = session.data.currentPage;

  let data = await fetchSearchResults({
    userId,
    query: searchQuery,
    personalityId,
    offset: pageToFetch * pageSize,
    limit: pageSize,
    preferTextSearch: searchType === 'text',
  });
  if (data === null) {
    return;
  }

  // Handle empty page after delete: go back one page if current page is now empty
  if (data.results.length === 0 && pageToFetch > 0) {
    pageToFetch--;
    const retryData = await fetchSearchResults({
      userId,
      query: searchQuery,
      personalityId,
      offset: pageToFetch * pageSize,
      limit: pageSize,
      preferTextSearch: searchType === 'text',
    });
    if (retryData === null) {
      return;
    }
    data = retryData;
    await updateMemoryListSessionPage({
      userId,
      messageId,
      kind: 'search',
      newPage: pageToFetch,
    });
  }

  const { embed, components } = buildSearchView({
    data,
    query: searchQuery,
    page: pageToFetch,
    pageSize,
    personalityId,
    searchType: data.searchType,
  });

  await interaction.editReply({ embeds: [embed], components });
}

/**
 * Handle detail action buttons with search-list refresh callback.
 */
export async function handleSearchDetailAction(interaction: ButtonInteraction): Promise<boolean> {
  return handleMemoryDetailAction(interaction, () => refreshSearchList(interaction));
}
