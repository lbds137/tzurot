/**
 * Memory Browse Handler
 *
 * Router-pattern implementation (no inline collectors) for /memory browse.
 * State lives in a dashboard session keyed by messageId so concurrent browses
 * from the same user don't collide, and the "back" button from detail view
 * can return to the right page.
 *
 * Custom ID flow:
 * - Pagination buttons: `memory-browse::browse::{page}::all::` (via browseHelpers.build)
 * - Info button (disabled): `memory-browse::browse::info`
 * - Detail action buttons: `memory-detail::{action}::{memoryId}` (unchanged, handled by detail.ts)
 *
 * Personality filter is stored in the dashboard session, NOT the custom ID,
 * because UUIDs can't fit in the filter enum slot.
 */

import type {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from 'discord.js';
import { EmbedBuilder, escapeMarkdown, MessageFlags } from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  memoryBrowseOptions,
  formatDateShort,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import {
  createBrowseCustomIdHelpers,
  buildBrowseButtons as buildSharedBrowseButtons,
  calculatePaginationState,
} from '../../utils/browse/index.js';
import { resolveOptionalPersonality } from './resolveHelpers.js';
import { buildMemorySelectMenu, handleMemorySelect } from './detail.js';
import { handleMemoryDetailAction } from './detailActionRouter.js';
import type { MemoryItem, ListContext } from './detailApi.js';
import { truncateContent } from './formatters.js';
import {
  saveMemoryListSession,
  findMemoryListSessionByMessage,
  updateMemoryListSessionPage,
  MEMORY_BROWSE_ENTITY_TYPE,
} from './browseSession.js';

/** Union type for action rows containing buttons or select menus */
type BrowseActionRow = ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>;

const logger = createLogger('memory-browse');

/** Items per page */
const MEMORIES_PER_PAGE = 10;

/** Browse customId helpers — filter is always 'all' since personality lives in session */
export const browseHelpers = createBrowseCustomIdHelpers<'all'>({
  prefix: MEMORY_BROWSE_ENTITY_TYPE,
  validFilters: ['all'],
  includeSort: false,
});

/** Prefix exported for componentPrefixes registration in index.ts */
export const MEMORY_BROWSE_PREFIX = MEMORY_BROWSE_ENTITY_TYPE;

/**
 * Check if a customId belongs to a memory browse pagination interaction.
 * Used by the command's button/select router to claim the interaction.
 */
export function isMemoryBrowsePagination(customId: string): boolean {
  return browseHelpers.isBrowse(customId) || browseHelpers.isBrowseSelect(customId);
}

interface BrowseResponse {
  memories: MemoryItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

interface BuildBrowseViewOptions {
  memories: MemoryItem[];
  total: number;
  page: number;
  totalPages: number;
  personalityFilter: string | undefined;
}

/**
 * Build the memory list embed
 */
function buildBrowseEmbed(options: BuildBrowseViewOptions): EmbedBuilder {
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
 * Build pagination buttons + select menu components for a page of memories.
 * Returns an empty array if there are no memories (empty state).
 */
function buildBrowseComponents(
  memories: MemoryItem[],
  page: number,
  totalPages: number
): BrowseActionRow[] {
  if (memories.length === 0) {
    return [];
  }

  return [
    buildMemorySelectMenu(memories, page, MEMORIES_PER_PAGE),
    buildSharedBrowseButtons({
      currentPage: page,
      totalPages,
      filter: 'all',
      currentSort: 'date',
      query: null,
      buildCustomId: browseHelpers.build,
      buildInfoId: browseHelpers.buildInfo,
    }),
  ];
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

/**
 * Handle /memory browse command
 */
export async function handleBrowse(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = memoryBrowseOptions(context.interaction);
  const personalityInput = options.personality();

  try {
    // Resolve personality if provided. Contract: null means the helper
    // already sent an error reply via editReply, so we must return early
    // without sending another reply (Discord would reject the double-reply).
    const personalityId = await resolveOptionalPersonality(context, userId, personalityInput);
    if (personalityId === null) {
      return;
    }

    // Fetch first page
    const data = await fetchMemories(userId, personalityId, 0, MEMORIES_PER_PAGE);

    if (data === null) {
      logger.warn({ userId }, '[Memory] Browse failed');
      await context.editReply({ content: '❌ Failed to load memories. Please try again later.' });
      return;
    }

    const { memories, total } = data;
    const { totalPages } = calculatePaginationState(total, MEMORIES_PER_PAGE, 0);

    // Build initial embed + components
    const embed = buildBrowseEmbed({
      memories,
      total,
      page: 0,
      totalPages,
      personalityFilter: personalityId,
    });
    const components = buildBrowseComponents(memories, 0, totalPages);

    // Send the message first so we have a messageId to key the session on
    const response = await context.editReply({ embeds: [embed], components });

    // Persist session so pagination and detail "back" buttons can recover state
    await saveMemoryListSession({
      userId,
      messageId: response.id,
      channelId: response.channelId,
      data: {
        kind: 'browse',
        personalityId,
        currentPage: 0,
      },
    });

    logger.info(
      { userId, total, personalityId, hasMore: data.hasMore },
      '[Memory] Browse displayed'
    );
  } catch (error) {
    logger.error({ err: error, userId }, '[Memory] Browse error');
    await context.editReply({
      content: '❌ An unexpected error occurred. Please try again later.',
    });
  }
}

/**
 * Handle pagination button clicks for /memory browse.
 * Parses the custom ID for the new page, looks up the session for personality
 * filter, re-fetches the page, and updates the message.
 */
export async function handleBrowsePagination(interaction: ButtonInteraction): Promise<void> {
  const parsed = browseHelpers.parse(interaction.customId);
  if (parsed === null) {
    return;
  }

  const messageId = interaction.message.id;
  const session = await findMemoryListSessionByMessage(messageId);
  if (session?.data.kind !== 'browse') {
    // Session expired or never existed — surface an expired message
    await interaction.reply({
      content: '⏰ This interaction has expired. Please run `/memory browse` again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();

  const userId = interaction.user.id;
  const { personalityId } = session.data;
  const newPage = parsed.page;

  const data = await fetchMemories(
    userId,
    personalityId,
    newPage * MEMORIES_PER_PAGE,
    MEMORIES_PER_PAGE
  );
  if (data === null) {
    await interaction.followUp({
      content: '❌ Failed to load page. Please try again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { totalPages, safePage } = calculatePaginationState(data.total, MEMORIES_PER_PAGE, newPage);
  const embed = buildBrowseEmbed({
    memories: data.memories,
    total: data.total,
    page: safePage,
    totalPages,
    personalityFilter: personalityId,
  });
  const components = buildBrowseComponents(data.memories, safePage, totalPages);

  await interaction.editReply({ embeds: [embed], components });

  // Update session so detail view's "back" button knows the current page
  await updateMemoryListSessionPage({
    userId,
    messageId,
    kind: 'browse',
    newPage: safePage,
  });
}

/**
 * Handle select menu interaction — user picked a memory to view details.
 * Delegates to detail.ts handleMemorySelect with list context from the session.
 */
export async function handleBrowseSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const messageId = interaction.message.id;
  const session = await findMemoryListSessionByMessage(messageId);

  // Build list context from session, or fall back to defaults if expired.
  // Degraded (not broken): the select itself still works since the memory
  // ID is in the interaction values, but the detail view's "back" button
  // will return to page 0 instead of the original page. This is an
  // acceptable tradeoff — a working fallback beats an error screen.
  const listContext: ListContext = {
    source: 'list',
    page: session?.data.currentPage ?? 0,
    personalityId: session?.data.personalityId,
  };

  await handleMemorySelect(interaction, listContext);
}

/**
 * Refresh the browse list view — called from the detail action router when
 * the user clicks "back" or after a successful delete. Re-fetches memories
 * using the session's stored state and updates the message.
 */
export async function refreshBrowseList(interaction: ButtonInteraction): Promise<void> {
  const messageId = interaction.message.id;
  const session = await findMemoryListSessionByMessage(messageId);
  if (session?.data.kind !== 'browse') {
    return;
  }

  const userId = interaction.user.id;
  const { personalityId } = session.data;
  let pageToFetch = session.data.currentPage;

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
    const retryData = await fetchMemories(
      userId,
      personalityId,
      pageToFetch * MEMORIES_PER_PAGE,
      MEMORIES_PER_PAGE
    );
    if (retryData === null) {
      return;
    }
    data = retryData;
    await updateMemoryListSessionPage({
      userId,
      messageId,
      kind: 'browse',
      newPage: pageToFetch,
    });
  }

  const { totalPages } = calculatePaginationState(data.total, MEMORIES_PER_PAGE, pageToFetch);
  const embed = buildBrowseEmbed({
    memories: data.memories,
    total: data.total,
    page: pageToFetch,
    totalPages,
    personalityFilter: personalityId,
  });
  const components = buildBrowseComponents(data.memories, pageToFetch, totalPages);

  await interaction.editReply({ embeds: [embed], components });
}

/**
 * Handle detail action buttons with browse-list refresh callback.
 * Called by the unified detail router in interactionHandlers.ts once it has
 * verified the session kind is 'browse'.
 */
export async function handleBrowseDetailAction(interaction: ButtonInteraction): Promise<boolean> {
  return handleMemoryDetailAction(interaction, () => refreshBrowseList(interaction));
}
