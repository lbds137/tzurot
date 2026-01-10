/**
 * Memory Search Handler
 * Handles /memory search command - semantic search of memories
 */

import type { ChatInputCommandInteraction, ButtonInteraction } from 'discord.js';
import { escapeMarkdown, EmbedBuilder, ComponentType } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { replyWithError, handleCommandError } from '../../utils/commandHelpers.js';
import { resolvePersonalityId } from './autocomplete.js';
import {
  buildPaginationButtons,
  parsePaginationId,
  calculatePagination,
  type PaginationConfig,
} from '../../utils/paginationBuilder.js';

const logger = createLogger('memory-search');

/** Pagination configuration for search */
const PAGINATION_CONFIG: PaginationConfig = {
  prefix: 'msearch',
};

/** Items per page */
const RESULTS_PER_PAGE = 5;

/** Collector timeout in milliseconds (5 minutes) */
const COLLECTOR_TIMEOUT_MS = 5 * 60 * 1000;

interface SearchResult {
  id: string;
  content: string;
  similarity: number | null; // null for text search results
  createdAt: string;
  personalityId: string;
  personalityName: string;
  isLocked: boolean;
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
 * Set up pagination collector for search results
 */
function setupSearchCollector(
  interaction: ChatInputCommandInteraction,
  response: Awaited<ReturnType<ChatInputCommandInteraction['editReply']>>,
  context: SearchCollectorContext
): void {
  const { userId, query, personalityId, initialSearchType } = context;

  const collector = response.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: COLLECTOR_TIMEOUT_MS,
    filter: i => i.user.id === userId,
  });

  let currentSearchType = initialSearchType;

  collector.on('collect', (buttonInteraction: ButtonInteraction) => {
    void (async () => {
      const parsed = parsePaginationId(buttonInteraction.customId, 'msearch');
      if (parsed === null) {
        return;
      }

      await buttonInteraction.deferUpdate();

      const newPage = parsed.page ?? 0;

      const newData = await fetchSearchResults(
        userId,
        query,
        personalityId,
        newPage * RESULTS_PER_PAGE,
        RESULTS_PER_PAGE
      );

      if (newData === null) {
        return;
      }

      if (newData.searchType !== undefined) {
        currentSearchType = newData.searchType;
      }

      const newEstimatedTotal = newData.hasMore
        ? (newPage + 2) * RESULTS_PER_PAGE
        : newPage * RESULTS_PER_PAGE + newData.results.length;
      const { totalPages: newTotalPages } = calculatePagination(
        newEstimatedTotal,
        RESULTS_PER_PAGE,
        newPage
      );

      const newEmbed = buildSearchEmbed({
        results: newData.results,
        query,
        page: newPage,
        totalPages: newTotalPages,
        hasMore: newData.hasMore,
        searchType: currentSearchType,
        personalityFilter: personalityId,
      });

      const newComponents = [
        buildPaginationButtons(PAGINATION_CONFIG, newPage, newTotalPages, 'date'),
      ];

      await buttonInteraction.editReply({ embeds: [newEmbed], components: newComponents });
    })();
  });

  collector.on('end', () => {
    interaction.editReply({ components: [] }).catch(() => {
      // Ignore errors if message was deleted
    });
  });
}

/**
 * Fetch search results from API
 */
async function fetchSearchResults(
  userId: string,
  query: string,
  personalityId: string | undefined,
  offset: number,
  limit: number
): Promise<SearchResponse | null> {
  const requestBody: Record<string, unknown> = {
    query,
    limit,
    offset,
  };

  if (personalityId !== undefined) {
    requestBody.personalityId = personalityId;
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
    const data = await fetchSearchResults(userId, query, personalityId, 0, RESULTS_PER_PAGE);

    if (data === null) {
      logger.warn({ userId, query: query.substring(0, 50) }, '[Memory] Search failed');
      await replyWithError(interaction, 'Failed to search memories. Please try again later.');
      return;
    }

    const { results, hasMore, searchType } = data;

    // For search, we estimate total pages based on hasMore
    // Since we don't have exact total, we use a practical approach
    const estimatedTotal = hasMore ? results.length * 10 : results.length; // Rough estimate
    const { totalPages } = calculatePagination(estimatedTotal, RESULTS_PER_PAGE, 0);

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

    // Build components (only if there are results and possibly more)
    const components =
      results.length > 0 ? [buildPaginationButtons(PAGINATION_CONFIG, 0, totalPages, 'date')] : [];

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
