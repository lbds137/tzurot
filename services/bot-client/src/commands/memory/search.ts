/**
 * Memory Search Handler
 * Handles /memory search command - semantic search of memories
 */

import type { ChatInputCommandInteraction, ButtonInteraction } from 'discord.js';
import { escapeMarkdown, EmbedBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { replyWithError, handleCommandError } from '../../utils/commandHelpers.js';
import { resolvePersonalityId } from './autocomplete.js';
import {
  buildPaginationButtons,
  parsePaginationId,
  type PaginationConfig,
} from '../../utils/paginationBuilder.js';
import {
  buildMemorySelectMenu,
  handleMemorySelect,
  parseMemoryActionId,
  handleEditButton,
  handleLockButton,
  handleDeleteButton,
  handleDeleteConfirm,
  type MemoryItem,
  type ListContext,
} from './detail.js';

const logger = createLogger('memory-search');

/** Pagination configuration for search - exported for componentPrefixes aggregation */
export const SEARCH_PAGINATION_CONFIG: PaginationConfig = {
  prefix: 'memory-search',
  hideSortToggle: true, // Search results are sorted by relevance, not name/date
};

/** Items per page */
const RESULTS_PER_PAGE = 5;

/** Collector timeout in milliseconds (5 minutes) */
const COLLECTOR_TIMEOUT_MS = 5 * 60 * 1000;

interface SearchResult extends MemoryItem {
  similarity: number | null; // null for text search results
}

interface SearchResponse {
  results: SearchResult[];
  count: number;
  total?: number; // Total matching results (for pagination)
  hasMore: boolean;
  searchType?: 'semantic' | 'text'; // undefined for backwards compatibility
}

interface BuildSearchEmbedOptions {
  results: SearchResult[];
  query: string;
  page: number;
  totalPages: number;
  hasMore: boolean;
  searchType?: 'semantic' | 'text';
  personalityFilter?: string;
}

/** Maximum content length before truncation */
const MAX_CONTENT_DISPLAY = 200;

/**
 * Format a date string for compact display
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  });
}

/**
 * Truncate content for display
 */
function truncateContent(content: string, maxLength: number = MAX_CONTENT_DISPLAY): string {
  if (content.length <= maxLength) {
    return content;
  }
  return content.substring(0, maxLength - 3) + '...';
}

/**
 * Format similarity score for display (or 'text match' for fallback)
 */
function formatSimilarity(similarity: number | null): string {
  if (similarity === null) {
    return 'text match';
  }
  const percentage = Math.round(similarity * 100);
  return `${percentage}%`;
}

/**
 * Build the search results embed
 */
function buildSearchEmbed(options: BuildSearchEmbedOptions): EmbedBuilder {
  const { results, query, page, totalPages, hasMore, searchType, personalityFilter } = options;
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
    const num = page * RESULTS_PER_PAGE + index + 1;
    const lockIcon = memory.isLocked ? ' 🔒' : '';
    const similarity = formatSimilarity(memory.similarity);
    const content = truncateContent(escapeMarkdown(memory.content));
    const date = formatDate(memory.createdAt);
    const personality = escapeMarkdown(memory.personalityName);

    lines.push(`**${num}.** ${content}${lockIcon}`);
    lines.push(`   _${personality} • ${similarity} • ${date}_`);
    lines.push('');
  });

  embed.setDescription(lines.join('\n').trim());

  // Build footer
  const footerParts: string[] = [];
  if (isTextFallback) {
    footerParts.push('Text search');
  } else {
    footerParts.push('Semantic search');
  }
  if (personalityFilter !== undefined) {
    footerParts.push('Filtered');
  }
  footerParts.push(`Page ${page + 1} of ${totalPages}${hasMore ? '+' : ''}`);

  embed.setFooter({ text: footerParts.join(' • ') });

  return embed;
}

interface SearchCollectorContext {
  userId: string;
  query: string;
  personalityId: string | undefined;
  initialSearchType?: 'semantic' | 'text';
}

/**
 * Handle button interactions for search pagination
 */
async function handleSearchButton(
  buttonInteraction: ButtonInteraction,
  context: SearchCollectorContext & { currentSearchType?: 'semantic' | 'text' }
): Promise<{ newPage: number; results: SearchResult[]; searchType?: 'semantic' | 'text' } | null> {
  const { userId, query, personalityId, currentSearchType } = context;

  const parsed = parsePaginationId(buttonInteraction.customId, SEARCH_PAGINATION_CONFIG.prefix);
  if (parsed === null) {
    return null;
  }

  await buttonInteraction.deferUpdate();

  const newPage = parsed.page ?? 0;
  const newData = await fetchSearchResults({
    userId,
    query,
    personalityId,
    offset: newPage * RESULTS_PER_PAGE,
    limit: RESULTS_PER_PAGE,
    preferTextSearch: currentSearchType === 'text',
  });

  if (newData === null) {
    await buttonInteraction.followUp({
      content: '❌ Failed to load results. Please try again.',
      ephemeral: true,
    });
    return null;
  }

  const updatedSearchType = newData.searchType ?? currentSearchType;
  const newTotalPages = newData.hasMore
    ? newPage + 2
    : Math.max(1, newPage + (newData.results.length > 0 ? 1 : 0));

  const newEmbed = buildSearchEmbed({
    results: newData.results,
    query,
    page: newPage,
    totalPages: newTotalPages,
    hasMore: newData.hasMore,
    searchType: updatedSearchType,
    personalityFilter: personalityId,
  });

  const newComponents = [
    buildMemorySelectMenu(newData.results, newPage, RESULTS_PER_PAGE),
    buildPaginationButtons(
      SEARCH_PAGINATION_CONFIG,
      newPage,
      newTotalPages,
      'date',
      newData.hasMore
    ),
  ];

  await buttonInteraction.editReply({ embeds: [newEmbed], components: newComponents });

  return { newPage, results: newData.results, searchType: updatedSearchType };
}

/**
 * Handle detail action buttons within the search collector
 */
async function handleSearchDetailAction(
  buttonInteraction: ButtonInteraction,
  refreshSearch: () => Promise<void>
): Promise<boolean> {
  const parsed = parseMemoryActionId(buttonInteraction.customId);
  if (parsed === null) {
    return false;
  }

  const { action, memoryId } = parsed;

  switch (action) {
    case 'edit':
      if (memoryId !== undefined) {
        await handleEditButton(buttonInteraction, memoryId);
      }
      return true;
    case 'lock':
      if (memoryId !== undefined) {
        await handleLockButton(buttonInteraction, memoryId);
      }
      return true;
    case 'delete':
      if (memoryId !== undefined) {
        await handleDeleteButton(buttonInteraction, memoryId);
      }
      return true;
    case 'confirm-delete':
      if (memoryId !== undefined) {
        const success = await handleDeleteConfirm(buttonInteraction, memoryId);
        if (success) {
          // Refresh the search results after deletion
          await refreshSearch();
        }
      }
      return true;
    case 'back':
      // Return to search results
      await buttonInteraction.deferUpdate();
      await refreshSearch();
      return true;
    default:
      return false;
  }
}

/**
 * Set up collector for search pagination and select menu
 */
function setupSearchCollector(
  interaction: ChatInputCommandInteraction,
  response: Awaited<ReturnType<ChatInputCommandInteraction['editReply']>>,
  context: SearchCollectorContext
): void {
  const { userId, query, personalityId, initialSearchType } = context;

  const collector = response.createMessageComponentCollector({
    time: COLLECTOR_TIMEOUT_MS,
    filter: i => i.user.id === userId,
  });

  let currentSearchType = initialSearchType;
  let currentPage = 0;
  let listContext: ListContext = {
    source: 'search',
    page: 0,
    personalityId,
    query,
    preferTextSearch: initialSearchType === 'text',
  };

  // Fetch helper for refresh operations
  const fetchPage = (page: number): Promise<SearchResponse | null> =>
    fetchSearchResults({
      userId,
      query,
      personalityId,
      offset: page * RESULTS_PER_PAGE,
      limit: RESULTS_PER_PAGE,
      preferTextSearch: currentSearchType === 'text',
    });

  // Function to refresh the search results at the current page
  const refreshSearch = async (): Promise<void> => {
    let pageToFetch = currentPage;
    let data = await fetchPage(pageToFetch);
    if (data === null) {
      return;
    }

    // Handle empty page after delete: go back one page if current page is now empty
    if (data.results.length === 0 && pageToFetch > 0) {
      pageToFetch--;
      currentPage = pageToFetch;
      listContext = { ...listContext, page: pageToFetch };
      const retryData = await fetchPage(pageToFetch);
      if (retryData !== null) {
        data = retryData;
      }
    }

    const totalPages = data.hasMore
      ? pageToFetch + 2
      : Math.max(1, pageToFetch + (data.results.length > 0 ? 1 : 0));

    const embed = buildSearchEmbed({
      results: data.results,
      query,
      page: pageToFetch,
      totalPages,
      hasMore: data.hasMore,
      searchType: data.searchType ?? currentSearchType,
      personalityFilter: personalityId,
    });

    const components =
      data.results.length > 0
        ? [
            buildMemorySelectMenu(data.results, pageToFetch, RESULTS_PER_PAGE),
            buildPaginationButtons(
              SEARCH_PAGINATION_CONFIG,
              pageToFetch,
              totalPages,
              'date',
              data.hasMore
            ),
          ]
        : [];

    await interaction.editReply({ embeds: [embed], components });
  };

  collector.on('collect', i => {
    void (async () => {
      if (i.isButton()) {
        // First check if it's a detail action
        const handled = await handleSearchDetailAction(i, refreshSearch);
        if (!handled) {
          // Otherwise handle as pagination
          const result = await handleSearchButton(i, {
            ...context,
            currentSearchType,
          });
          if (result !== null) {
            currentPage = result.newPage;
            currentSearchType = result.searchType;
            listContext = {
              ...listContext,
              page: currentPage,
              preferTextSearch: currentSearchType === 'text',
            };
          }
        }
      } else if (i.isStringSelectMenu()) {
        await handleMemorySelect(i, listContext);
      }
    })();
  });

  collector.on('end', () => {
    interaction.editReply({ components: [] }).catch(() => {
      // Ignore errors if message was deleted
    });
  });
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
 * Handle /memory search
 */
export async function handleSearch(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const query = interaction.options.getString('query', true);
  const personalityInput = interaction.options.getString('personality');

  try {
    // Resolve personality if provided
    let personalityId: string | undefined;
    if (personalityInput !== null && personalityInput.length > 0) {
      const resolved = await resolvePersonalityId(userId, personalityInput);
      if (resolved === null) {
        await replyWithError(
          interaction,
          `Personality "${personalityInput}" not found. Use autocomplete to select a valid personality.`
        );
        return;
      }
      personalityId = resolved;
    }

    // Fetch first page
    const data = await fetchSearchResults({
      userId,
      query,
      personalityId,
      offset: 0,
      limit: RESULTS_PER_PAGE,
    });

    if (data === null) {
      logger.warn({ userId, query: query.substring(0, 50) }, '[Memory] Search failed');
      await replyWithError(interaction, 'Failed to search memories. Please try again later.');
      return;
    }

    const { results, hasMore, searchType } = data;

    // Calculate pages: when hasMore is true, we know there's at least one more page
    // Use currentPage + 2 consistently so UX remains stable as user navigates
    const currentPage = 0;
    const totalPages = hasMore
      ? currentPage + 2
      : Math.max(1, Math.ceil(results.length / RESULTS_PER_PAGE));

    // Build initial embed
    const embed = buildSearchEmbed({
      results,
      query,
      page: 0,
      totalPages,
      hasMore,
      searchType,
      personalityFilter: personalityId,
    });

    // Build components (only if there are results)
    const components =
      results.length > 0
        ? [
            buildMemorySelectMenu(results, 0, RESULTS_PER_PAGE),
            buildPaginationButtons(SEARCH_PAGINATION_CONFIG, 0, totalPages, 'date', hasMore),
          ]
        : [];

    const response = await interaction.editReply({ embeds: [embed], components });

    logger.info(
      {
        userId,
        queryLength: query.length,
        personalityId,
        resultCount: results.length,
        hasMore,
        searchType: searchType ?? 'semantic',
      },
      '[Memory] Search displayed'
    );

    // Set up collector for pagination
    if (components.length > 0) {
      setupSearchCollector(interaction, response, {
        userId,
        query,
        personalityId,
        initialSearchType: searchType,
      });
    }
  } catch (error) {
    await handleCommandError(interaction, error, { userId, command: 'Memory Search' });
  }
}
