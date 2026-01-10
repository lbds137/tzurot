/**
 * Memory Search Handler
 * Handles /memory search command - semantic search of memories
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { escapeMarkdown } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { replyWithError, handleCommandError, createInfoEmbed } from '../../utils/commandHelpers.js';
import { resolvePersonalityId } from './autocomplete.js';

const logger = createLogger('memory-search');

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
  hasMore: boolean;
  searchType?: 'semantic' | 'text'; // undefined for backwards compatibility
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
 * Handle /memory search
 */
export async function handleSearch(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const query = interaction.options.getString('query', true);
  const personalityInput = interaction.options.getString('personality');
  const limit = interaction.options.getInteger('limit') ?? 5;

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

    // Build request body
    const requestBody: Record<string, unknown> = {
      query,
      limit: Math.min(Math.max(1, limit), 10), // Clamp to 1-10 for display
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
      const errorMessage =
        result.status === 503
          ? 'Memory search is not currently available. Please try again later.'
          : 'Failed to search memories. Please try again later.';
      logger.warn(
        { userId, query: query.substring(0, 50), status: result.status },
        '[Memory] Search failed'
      );
      await replyWithError(interaction, errorMessage);
      return;
    }

    const { results, hasMore, searchType } = result.data;
    const isTextFallback = searchType === 'text';

    // Build embed
    const embed = createInfoEmbed(
      'Memory Search Results',
      `Found ${results.length} result${results.length !== 1 ? 's' : ''}${hasMore ? '+' : ''} for: **${escapeMarkdown(truncateContent(query, 50))}**`
    );

    if (results.length === 0) {
      embed.setDescription(
        `No memories found matching: **${escapeMarkdown(truncateContent(query, 50))}**\n\nTry a different search query or check if you have memories with this personality.`
      );
    } else {
      // Add each result as a field
      results.forEach((memory, index) => {
        const lockIcon = memory.isLocked ? ' :locked:' : '';
        const header = `${index + 1}. ${escapeMarkdown(memory.personalityName)}${lockIcon} (${formatSimilarity(memory.similarity)})`;
        const content = `${truncateContent(escapeMarkdown(memory.content))}\n*${formatDate(memory.createdAt)}*`;

        embed.addFields({
          name: header,
          value: content,
          inline: false,
        });
      });

      // Build footer text
      const footerParts: string[] = [];
      if (isTextFallback) {
        footerParts.push('Results from text search (no semantic matches found)');
      }
      if (hasMore) {
        footerParts.push('More results available. Use a more specific query to refine results.');
      }
      if (footerParts.length > 0) {
        embed.setFooter({ text: footerParts.join(' • ') });
      }
    }

    await interaction.editReply({ embeds: [embed] });

    logger.info(
      {
        userId,
        queryLength: query.length,
        personalityId,
        resultCount: results.length,
        hasMore,
        searchType: searchType ?? 'semantic',
      },
      '[Memory] Search completed'
    );
  } catch (error) {
    await handleCommandError(interaction, error, { userId, command: 'Memory Search' });
  }
}
