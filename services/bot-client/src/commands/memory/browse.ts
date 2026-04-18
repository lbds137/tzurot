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

import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { EmbedBuilder, escapeMarkdown, MessageFlags } from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  memoryBrowseOptions,
  formatDateShort,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi, toGatewayUser, type GatewayUser } from '../../utils/userGatewayClient.js';
import {
  createBrowseCustomIdHelpers,
  buildBrowseButtons as buildSharedBrowseButtons,
  buildBrowseSelectMenu,
  calculatePaginationState,
  joinFooter,
  pluralize,
  formatSortVerbatim,
  formatPageIndicator,
  type BrowseActionRow,
} from '../../utils/browse/index.js';
import { resolveOptionalPersonality } from './resolveHelpers.js';
import { buildMemoryActionId, handleMemorySelect } from './detail.js';
import { handleMemoryDetailAction } from './detailActionRouter.js';
import type { MemoryItem } from './detailApi.js';
import { truncateContent } from './formatters.js';
import {
  saveMemoryListSession,
  findMemoryListSessionByMessage,
  updateMemoryListSessionPage,
  fetchPageWithEmptyFallback,
  MEMORY_BROWSE_ENTITY_TYPE,
} from './browseSession.js';

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
 * Check if a customId belongs to a memory browse pagination BUTTON.
 *
 * This guard is called exclusively from `handleButton`, which only sees
 * `ButtonInteraction` — Discord.js dispatches `StringSelectMenuInteraction`
 * separately to `handleSelectMenu`, so a browse-select customId would never
 * reach this code path in practice. The function intentionally does NOT
 * match select customIds: the select menu routing lives inside
 * `handleSelectMenu` and uses `browseHelpers.isBrowseSelect` directly.
 * Keeping this narrow means the name and behavior match.
 */
export function isMemoryBrowsePagination(customId: string): boolean {
  return browseHelpers.isBrowse(customId);
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
  personalityId: string | undefined;
}

/**
 * Build the memory list embed
 */
function buildBrowseEmbed(options: BuildBrowseViewOptions): EmbedBuilder {
  const { memories, total, page, totalPages, personalityId } = options;
  const embed = new EmbedBuilder().setTitle('🧠 Memory Browser').setColor(DISCORD_COLORS.BLURPLE);

  if (memories.length === 0) {
    embed.setDescription(
      personalityId !== undefined
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
  embed.setFooter({
    text: joinFooter(
      pluralize(total, { singular: 'memory', plural: 'memories' }),
      personalityId !== undefined && 'Filtered',
      formatSortVerbatim('Newest first'),
      formatPageIndicator(page + 1, totalPages)
    ),
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
  // Empty case is handled by the factory's null return — no explicit
  // length check needed, the function below short-circuits on null.
  const selectRow = buildBrowseSelectMenu<MemoryItem>({
    items: memories,
    customId: buildMemoryActionId('select'),
    placeholder: 'Select a memory to manage...',
    startIndex: page * MEMORIES_PER_PAGE,
    formatItem: memory => ({
      label: `${memory.isLocked ? '🔒 ' : ''}${memory.content}`,
      value: memory.id,
      description: `${memory.personalityName} • ${formatDateShort(memory.createdAt)}`,
    }),
  });
  if (selectRow === null) {
    return [];
  }

  return [
    selectRow,
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
  user: GatewayUser,
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
      user,
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
  const user = toGatewayUser(context.user);
  const options = memoryBrowseOptions(context.interaction);
  const personalityInput = options.personality();

  try {
    // Resolve personality if provided. Contract: null means the helper
    // already sent an error reply via editReply, so we must return early
    // without sending another reply (Discord would reject the double-reply).
    const personalityId = await resolveOptionalPersonality(context, user, personalityInput);
    if (personalityId === null) {
      return;
    }

    // Fetch first page
    const data = await fetchMemories(user, personalityId, 0, MEMORIES_PER_PAGE);

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
      personalityId,
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

  // No explicit `interaction.user.id === session.userId` check here — the
  // memory command uses `deferralMode: 'ephemeral'` (see memory/index.ts),
  // so only the command invoker can see the message, and therefore only
  // they can click the pagination buttons. A non-invoker physically
  // cannot produce this interaction. If this command ever switches to a
  // public deferral mode, a user check MUST be added here to prevent
  // overwriting someone else's memory search results via editReply.
  //
  // Acknowledge immediately so all downstream async work (session lookup,
  // API fetch) happens inside the 15-minute followup window rather than
  // the 3-second interaction window. Matches the pattern in
  // character/browse.ts. After deferUpdate, error paths must use followUp
  // instead of reply (the interaction is already acknowledged).
  await interaction.deferUpdate();

  const messageId = interaction.message.id;
  const session = await findMemoryListSessionByMessage(messageId);
  if (session?.data.kind !== 'browse') {
    // Session expired or never existed — surface an expired message via followUp
    await interaction.followUp({
      content: '⏰ This interaction has expired. Please run `/memory browse` again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const userId = interaction.user.id;
  const { personalityId } = session.data;
  const newPage = parsed.page;

  const data = await fetchMemories(
    toGatewayUser(interaction.user),
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
    personalityId,
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
 *
 * Thin wrapper around handleMemorySelect. Kept as a distinct export so
 * interactionHandlers can log the browse-vs-search origin and so the
 * routing stays explicit. No session lookup needed — back navigation
 * from the detail view uses refreshBrowseList which re-reads the
 * session via messageId anyway.
 *
 * Calling handleMemorySelect directly (without awaiting any other async
 * work first) preserves 3-second rule compliance: deferUpdate inside
 * handleMemorySelect is the first await in the call chain.
 */
export async function handleBrowseSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  await handleMemorySelect(interaction);
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
  const user = toGatewayUser(interaction.user);
  const { personalityId } = session.data;

  const result = await fetchPageWithEmptyFallback({
    currentPage: session.data.currentPage,
    fetchPage: page =>
      fetchMemories(user, personalityId, page * MEMORIES_PER_PAGE, MEMORIES_PER_PAGE),
    isEmpty: d => d.memories.length === 0,
  });
  if (result === null) {
    return;
  }

  if (result.steppedBack) {
    await updateMemoryListSessionPage({
      userId,
      messageId,
      kind: 'browse',
      newPage: result.page,
    });
  }

  const { totalPages } = calculatePaginationState(
    result.data.total,
    MEMORIES_PER_PAGE,
    result.page
  );
  const embed = buildBrowseEmbed({
    memories: result.data.memories,
    total: result.data.total,
    page: result.page,
    totalPages,
    personalityId,
  });
  const components = buildBrowseComponents(result.data.memories, result.page, totalPages);

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
