/**
 * Memory Browse Handler
 * Handles /memory browse command - paginated browsing of memories
 */

import type { ChatInputCommandInteraction, ButtonInteraction } from 'discord.js';
import { EmbedBuilder, escapeMarkdown, MessageFlags } from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  memoryBrowseOptions,
  formatDateShort,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { resolvePersonalityId } from './autocomplete.js';
import {
  buildPaginationButtons,
  parsePaginationId,
  calculatePagination,
  type PaginationConfig,
} from '../../utils/paginationBuilder.js';
import {
  buildMemorySelectMenu,
  handleMemorySelect,
  parseMemoryActionId,
  handleLockButton,
  handleDeleteButton,
  handleDeleteConfirm,
  handleViewFullButton,
} from './detail.js';
import {
  handleEditButton,
  handleEditTruncatedButton,
  handleCancelEditButton,
} from './detailModals.js';
import type { MemoryItem, ListContext } from './detailApi.js';
import { truncateContent, COLLECTOR_TIMEOUT_MS } from './formatters.js';
import {
  registerActiveCollector,
  deregisterActiveCollector,
} from '../../utils/activeCollectorRegistry.js';

const logger = createLogger('memory-browse');

/** Pagination configuration for memory browse - exported for componentPrefixes aggregation */
export const BROWSE_PAGINATION_CONFIG: PaginationConfig = {
  prefix: 'memory-browse',
  hideSortToggle: true, // Memories don't have a "name" to sort by
};

/** Items per page */
const MEMORIES_PER_PAGE = 10;

interface BrowseResponse {
  memories: MemoryItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

interface BuildBrowseEmbedOptions {
  memories: MemoryItem[];
  total: number;
  page: number;
  totalPages: number;
  personalityFilter?: string;
}

/**
 * Build the memory list embed
 */
function buildBrowseEmbed(options: BuildBrowseEmbedOptions): EmbedBuilder {
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
    const date = formatDateShort(memory.createdAt);
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
): Promise<BrowseResponse | null> {
  const queryParams = new URLSearchParams();
  queryParams.set('limit', limit.toString());
  queryParams.set('offset', offset.toString());
  queryParams.set('sort', 'createdAt');
  queryParams.set('order', 'desc');

  if (personalityId !== undefined) {
    queryParams.set('personalityId', personalityId);
  }

  const result = await callGatewayApi<BrowseResponse>(
    `/user/memory/list?${queryParams.toString()}`,
    {
      userId,
      method: 'GET',
    }
  );

  if (!result.ok) {
    return null;
  }

  return result.data;
}

interface BrowseCollectorContext {
  userId: string;
  personalityId: string | undefined;
  listContext: ListContext;
}

/**
 * Handle button interactions for pagination
 */
async function handleBrowseButton(
  buttonInteraction: ButtonInteraction,
  context: BrowseCollectorContext
): Promise<{ newPage: number; memories: MemoryItem[] } | null> {
  const { userId, personalityId } = context;

  const parsed = parsePaginationId(buttonInteraction.customId, BROWSE_PAGINATION_CONFIG.prefix);
  if (parsed === null) {
    return null;
  }

  await buttonInteraction.deferUpdate();

  const newPage = parsed.page ?? 0;
  const newData = await fetchMemories(
    userId,
    personalityId,
    newPage * MEMORIES_PER_PAGE,
    MEMORIES_PER_PAGE
  );

  if (newData === null) {
    await buttonInteraction.followUp({
      content: '❌ Failed to load page. Please try again.',
      ephemeral: true,
    });
    return null;
  }

  const { totalPages: newTotalPages } = calculatePagination(
    newData.total,
    MEMORIES_PER_PAGE,
    newPage
  );

  const newEmbed = buildBrowseEmbed({
    memories: newData.memories,
    total: newData.total,
    page: newPage,
    totalPages: newTotalPages,
    personalityFilter: personalityId,
  });

  const newComponents = [
    buildMemorySelectMenu(newData.memories, newPage, MEMORIES_PER_PAGE),
    buildPaginationButtons(BROWSE_PAGINATION_CONFIG, newPage, newTotalPages, 'date'),
  ];

  await buttonInteraction.editReply({ embeds: [newEmbed], components: newComponents });

  return { newPage, memories: newData.memories };
}

/**
 * Handle detail action buttons within the collector
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Switch over memory action types (view, delete, confirm, cancel) with per-action API calls and UI updates
async function handleDetailAction(
  buttonInteraction: ButtonInteraction,
  _context: BrowseCollectorContext,
  refreshList: () => Promise<void>
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
    case 'edit-truncated':
      if (memoryId !== undefined) {
        await handleEditTruncatedButton(buttonInteraction, memoryId);
      }
      return true;
    case 'cancel-edit':
      await handleCancelEditButton(buttonInteraction);
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
          // Refresh the list after deletion
          await refreshList();
        }
      }
      return true;
    case 'view-full':
      if (memoryId !== undefined) {
        await handleViewFullButton(buttonInteraction, memoryId);
      }
      return true;
    case 'back':
      // Return to list view
      await buttonInteraction.deferUpdate();
      await refreshList();
      return true;
    default:
      return false;
  }
}

/**
 * Set up collector for pagination and select menu interactions
 */
function setupBrowseCollector(
  interaction: ChatInputCommandInteraction,
  response: Awaited<ReturnType<ChatInputCommandInteraction['editReply']>>,
  context: BrowseCollectorContext
): void {
  const { userId, personalityId, listContext } = context;
  let currentContext = { ...listContext };

  // Register this message as having an active collector
  // This prevents the global handler from racing with us
  registerActiveCollector(response.id);

  // Function to refresh the list view at the current page
  const refreshList = async (): Promise<void> => {
    let pageToFetch = currentContext.page;

    let data = await fetchMemories(
      userId,
      personalityId,
      pageToFetch * MEMORIES_PER_PAGE,
      MEMORIES_PER_PAGE
    );

    if (data === null) {
      return;
    }

    // Handle empty page after delete: go back one page if current page is now empty
    if (data.memories.length === 0 && pageToFetch > 0) {
      pageToFetch--;
      currentContext = { ...currentContext, page: pageToFetch };
      const retryData = await fetchMemories(
        userId,
        personalityId,
        pageToFetch * MEMORIES_PER_PAGE,
        MEMORIES_PER_PAGE
      );
      if (retryData === null) {
        return; // Both fetches failed, don't update the UI
      }
      data = retryData;
    }

    const { totalPages } = calculatePagination(data.total, MEMORIES_PER_PAGE, pageToFetch);
    const embed = buildBrowseEmbed({
      memories: data.memories,
      total: data.total,
      page: pageToFetch,
      totalPages,
      personalityFilter: personalityId,
    });

    const components =
      data.memories.length > 0
        ? [
            buildMemorySelectMenu(data.memories, pageToFetch, MEMORIES_PER_PAGE),
            buildPaginationButtons(BROWSE_PAGINATION_CONFIG, pageToFetch, totalPages, 'date'),
          ]
        : [];

    await interaction.editReply({ embeds: [embed], components });
  };

  // Collect both Button and StringSelectMenu interactions
  const collector = response.createMessageComponentCollector({
    time: COLLECTOR_TIMEOUT_MS,
    filter: i => i.user.id === userId,
  });

  collector.on('collect', i => {
    void (async () => {
      try {
        if (i.isButton()) {
          // First check if it's a detail action
          const handled = await handleDetailAction(i, context, refreshList);
          if (!handled) {
            // Otherwise handle as pagination
            const result = await handleBrowseButton(i, context);
            if (result !== null) {
              currentContext = { ...currentContext, page: result.newPage };
            }
          }
        } else if (i.isStringSelectMenu()) {
          await handleMemorySelect(i, currentContext);
        }
      } catch (error) {
        logger.error({ err: error, customId: i.customId }, '[Memory] Collector interaction failed');
        // Try to notify user if possible
        try {
          if (!i.replied && !i.deferred) {
            await i.reply({
              content: '❌ Something went wrong. Please try again.',
              flags: MessageFlags.Ephemeral,
            });
          }
        } catch {
          // Interaction may be invalid, nothing we can do
        }
      }
    })();
  });

  collector.on('end', () => {
    // Deregister so global handler knows this collector is no longer active
    deregisterActiveCollector(response.id);

    interaction.editReply({ components: [] }).catch(() => {
      // Ignore errors if message was deleted
    });
  });
}

/**
 * Handle /memory browse command
 */
export async function handleBrowse(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = memoryBrowseOptions(context.interaction);
  const personalityInput = options.personality();

  try {
    // Resolve personality if provided
    let personalityId: string | undefined;
    if (personalityInput !== null && personalityInput.length > 0) {
      const resolved = await resolvePersonalityId(userId, personalityInput);
      if (resolved === null) {
        await context.editReply({
          content: `❌ Personality "${personalityInput}" not found. Use autocomplete to select a valid personality.`,
        });
        return;
      }
      personalityId = resolved;
    }

    // Fetch first page
    const data = await fetchMemories(userId, personalityId, 0, MEMORIES_PER_PAGE);

    if (data === null) {
      logger.warn({ userId }, '[Memory] Browse failed');
      await context.editReply({ content: '❌ Failed to load memories. Please try again later.' });
      return;
    }

    const { memories, total } = data;
    const { totalPages } = calculatePagination(total, MEMORIES_PER_PAGE, 0);

    // Build initial embed
    const embed = buildBrowseEmbed({
      memories,
      total,
      page: 0,
      totalPages,
      personalityFilter: personalityId,
    });

    // Build components (only if there are memories)
    const components =
      memories.length > 0
        ? [
            buildMemorySelectMenu(memories, 0, MEMORIES_PER_PAGE),
            buildPaginationButtons(BROWSE_PAGINATION_CONFIG, 0, totalPages, 'date'),
          ]
        : [];

    // Context for returning to list from detail view
    const listContext: ListContext = {
      source: 'list',
      page: 0,
      personalityId,
    };

    const response = await context.editReply({ embeds: [embed], components });

    logger.info(
      { userId, total, personalityId, hasMore: data.hasMore },
      '[Memory] Browse displayed'
    );

    // Set up collector for pagination and select menu
    // Pass the raw interaction since collectors need it for ongoing edits
    if (components.length > 0) {
      setupBrowseCollector(context.interaction, response, {
        userId,
        personalityId,
        listContext,
      });
    }
  } catch (error) {
    logger.error({ err: error, userId }, '[Memory] Browse error');
    await context.editReply({
      content: '❌ An unexpected error occurred. Please try again later.',
    });
  }
}
