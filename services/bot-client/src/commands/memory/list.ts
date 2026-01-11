/**
 * Memory List Handler
 * Handles /memory list command - paginated browsing of memories
 */

import type { ChatInputCommandInteraction, ButtonInteraction } from 'discord.js';
import { EmbedBuilder, escapeMarkdown, ComponentType } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { replyWithError } from '../../utils/commandHelpers.js';
import { resolvePersonalityId } from './autocomplete.js';
import {
  buildPaginationButtons,
  parsePaginationId,
  calculatePagination,
  type PaginationConfig,
} from '../../utils/paginationBuilder.js';

const logger = createLogger('memory-list');

/** Pagination configuration for memory list - exported for componentPrefixes aggregation */
export const LIST_PAGINATION_CONFIG: PaginationConfig = {
  prefix: 'memory-list',
  hideSortToggle: true, // Memories don't have a "name" to sort by
};

/** Items per page */
const MEMORIES_PER_PAGE = 10;

/** Collector timeout in milliseconds (5 minutes) */
const COLLECTOR_TIMEOUT_MS = 5 * 60 * 1000;

/** Maximum content length before truncation */
const MAX_CONTENT_DISPLAY = 150;

interface MemoryListItem {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  personalityId: string;
  personalityName: string;
  isLocked: boolean;
}

interface ListResponse {
  memories: MemoryListItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

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
  // Remove newlines for compact display
  const singleLine = content.replace(/\n+/g, ' ').trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  return singleLine.substring(0, maxLength - 3) + '...';
}

interface BuildListEmbedOptions {
  memories: MemoryListItem[];
  total: number;
  page: number;
  totalPages: number;
  personalityFilter?: string;
}

/**
 * Build the memory list embed
 */
function buildListEmbed(options: BuildListEmbedOptions): EmbedBuilder {
  const { memories, total, page, totalPages, personalityFilter } = options;
  const embed = new EmbedBuilder().setTitle('🧠 Memory Browser').setColor(DISCORD_COLORS.BLURPLE);

  if (memories.length === 0) {
    embed.setDescription(
      personalityFilter !== undefined
        ? `No memories found for this personality.\n\nTry browsing all memories or check your search filters.`
        : `You don't have any memories yet.\n\nMemories are created automatically when you chat with personalities.`
    );
    return embed;
  }

  // Build memory list
  const lines: string[] = [];
  memories.forEach((memory, index) => {
    const lockIcon = memory.isLocked ? ' 🔒' : '';
    const num = page * MEMORIES_PER_PAGE + index + 1;
    const content = truncateContent(escapeMarkdown(memory.content));
    const date = formatDate(memory.createdAt);
    const personality = escapeMarkdown(memory.personalityName);

    lines.push(`**${num}.** ${content}${lockIcon}`);
    lines.push(`   _${personality} • ${date}_`);
    lines.push('');
  });

  embed.setDescription(lines.join('\n').trim());

  // Build footer
  const filterLabel = personalityFilter !== undefined ? ' • Filtered' : '';
  embed.setFooter({
    text: `${total} memories${filterLabel} • Newest first • Page ${page + 1} of ${totalPages}`,
  });

  return embed;
}

/**
 * Fetch memories from API
 */
async function fetchMemories(
  userId: string,
  personalityId: string | undefined,
  offset: number,
  limit: number
): Promise<ListResponse | null> {
  const queryParams = new URLSearchParams();
  queryParams.set('limit', limit.toString());
  queryParams.set('offset', offset.toString());
  queryParams.set('sort', 'createdAt');
  queryParams.set('order', 'desc');

  if (personalityId !== undefined) {
    queryParams.set('personalityId', personalityId);
  }

  const result = await callGatewayApi<ListResponse>(`/user/memory/list?${queryParams.toString()}`, {
    userId,
    method: 'GET',
  });

  if (!result.ok) {
    return null;
  }

  return result.data;
}

/**
 * Handle /memory list command
 */
export async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
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
    const data = await fetchMemories(userId, personalityId, 0, MEMORIES_PER_PAGE);

    if (data === null) {
      logger.warn({ userId }, '[Memory] List failed');
      await replyWithError(interaction, 'Failed to load memories. Please try again later.');
      return;
    }

    const { memories, total } = data;
    const { totalPages } = calculatePagination(total, MEMORIES_PER_PAGE, 0);

    // Build initial embed
    const embed = buildListEmbed({
      memories,
      total,
      page: 0,
      totalPages,
      personalityFilter: personalityId,
    });

    // Build components (only if there are memories)
    const components =
      memories.length > 0
        ? [buildPaginationButtons(LIST_PAGINATION_CONFIG, 0, totalPages, 'date')]
        : [];

    const response = await interaction.editReply({ embeds: [embed], components });

    logger.info({ userId, total, personalityId, hasMore: data.hasMore }, '[Memory] List displayed');

    // Set up collector for pagination
    if (components.length > 0) {
      const collector = response.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: COLLECTOR_TIMEOUT_MS,
        filter: i => i.user.id === userId,
      });

      collector.on('collect', (buttonInteraction: ButtonInteraction) => {
        void (async () => {
          const parsed = parsePaginationId(
            buttonInteraction.customId,
            LIST_PAGINATION_CONFIG.prefix
          );
          if (parsed === null) {
            return;
          }

          await buttonInteraction.deferUpdate();

          const newPage = parsed.page ?? 0;

          // Fetch the requested page
          const newData = await fetchMemories(
            userId,
            personalityId,
            newPage * MEMORIES_PER_PAGE,
            MEMORIES_PER_PAGE
          );

          if (newData === null) {
            // Provide user feedback on error
            await buttonInteraction.followUp({
              content: '❌ Failed to load page. Please try again.',
              ephemeral: true,
            });
            return;
          }

          const { totalPages: newTotalPages } = calculatePagination(
            newData.total,
            MEMORIES_PER_PAGE,
            newPage
          );

          const newEmbed = buildListEmbed({
            memories: newData.memories,
            total: newData.total,
            page: newPage,
            totalPages: newTotalPages,
            personalityFilter: personalityId,
          });

          const newComponents = [
            buildPaginationButtons(LIST_PAGINATION_CONFIG, newPage, newTotalPages, 'date'),
          ];

          await buttonInteraction.editReply({ embeds: [newEmbed], components: newComponents });
        })();
      });

      collector.on('end', () => {
        // Remove buttons when collector expires
        interaction.editReply({ components: [] }).catch(() => {
          // Ignore errors if message was deleted
        });
      });
    }
  } catch (error) {
    logger.error({ err: error, userId }, '[Memory] List error');
    await replyWithError(interaction, 'An unexpected error occurred. Please try again later.');
  }
}
