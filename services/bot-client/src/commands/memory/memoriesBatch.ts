/**
 * Memory Batch Flow ("Select several") — /memory browse + /memory search
 *
 * Multi-select batch actions over either memory list: pick several memories
 * in one menu, confirm Delete or Lock for all of them in one view, then get
 * a per-item outcome listing stacked on the refreshed list. Mirrors the
 * facts flow (factsBatch.ts); the shared machinery lives in
 * utils/browse/multiSelectBatch.ts. This module is the render side — entry
 * swap, confirm view, and the per-kind page/embed helpers; the confirm
 * execution lives in memoriesBatchConfirm.ts.
 *
 * Component contract (joined to the memory-detail token family, which both
 * lists already share via `memory-detail::select`):
 * - `memory-detail::batch-select` — the "Select several" toggle button (swaps
 *   the page into multi-select mode) AND the multi-select menu itself; the
 *   router dispatches by interaction kind.
 * - `memory-detail::batch-confirm::<delete|lock>` — the verb buttons; the
 *   verb rides the memoryId slot of the action id.
 * - `memory-detail::batch-cancel` — back to the normal list render.
 * - the selected memory ids ride the confirm embed's FOOTER, one per line.
 *
 * Batch lock is lock-only: `setMemoryLock(userClient, id, true, userId)` —
 * the per-item lock/unlock toggle stays a detail-view affordance.
 */

import {
  escapeMarkdown,
  type ButtonInteraction,
  type EmbedBuilder,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { type MemoryItem, type MemoryListResponse } from '@tzurot/common-types/schemas/api/memory';
import type { UserClient } from '@tzurot/clients';
import { clientsFor } from '../../utils/gatewayClients.js';
import { buildBrowseSelectMenu } from '../../utils/browse/selectMenuBuilder.js';
import {
  buildBatchModeRows,
  buildBatchConfirmView,
  clampBatchConfirmDescription,
  encodeBatchFooterIds,
  formatFallbackIdLabel,
  readSelectOptionLabels,
  PAGE_FETCH_FAILED_COPY,
} from '../../utils/browse/multiSelectBatch.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { followUpSpec, ackUpdate } from '../../ux/render/reply.js';
import { findMemoryListSessionByMessage, type MemoryListSession } from './browseSession.js';
import { buildMemoryActionId } from './detail.js';
import {
  MEMORIES_PER_PAGE,
  buildBrowseEmbed,
  fetchMemories,
  formatMemorySelectOption,
} from './browse.js';
import {
  buildSearchEmbed,
  computeTotalPages,
  fetchSearchResults,
  type SearchResponse,
} from './search.js';

/** Either list's page payload — narrowed by the presence of `memories`. */
type MemoryPageData = MemoryListResponse | SearchResponse;

/** Page size for the session's kind (browse is fixed at 10; search persists its own). */
function pageSizeFor(session: MemoryListSession): number {
  return session.kind === 'browse' ? MEMORIES_PER_PAGE : session.pageSize;
}

/** The items of a fetched page, regardless of which list produced it. */
export function itemsOf(data: MemoryPageData): MemoryItem[] {
  return 'memories' in data ? data.memories : data.results;
}

/** Fallback display label when a memory's real label can't be resolved. */
export function fallbackMemoryLabel(id: string): string {
  return formatFallbackIdLabel(id, 'Memory');
}

/**
 * Per-kind page fetch for a session — the batch entry and the confirm
 * handler's label resolution both fetch through here. Every session kind has
 * a branch; a new kind must add one before it can run a batch flow.
 */
export async function fetchPageForSession(
  userClient: UserClient,
  session: MemoryListSession,
  page: number
): Promise<MemoryPageData | null> {
  if (session.kind === 'browse') {
    return fetchMemories(
      userClient,
      session.personalityId,
      page * MEMORIES_PER_PAGE,
      MEMORIES_PER_PAGE
    );
  }
  return fetchSearchResults({
    userClient,
    query: session.searchQuery,
    personalityId: session.personalityId,
    offset: page * session.pageSize,
    limit: session.pageSize,
    preferTextSearch: session.searchType === 'text',
  });
}

/** The list embed for a fetched page, rendered by the page's own kind. */
function buildListEmbed(
  session: MemoryListSession,
  data: MemoryPageData,
  page: number
): EmbedBuilder {
  if (session.kind === 'browse') {
    const d = data as MemoryListResponse;
    return buildBrowseEmbed({
      memories: d.memories,
      total: d.total,
      page,
      personalityId: session.personalityId,
    });
  }
  const d = data as SearchResponse;
  return buildSearchEmbed({
    results: d.results,
    query: session.searchQuery,
    page,
    pageSize: session.pageSize,
    totalPages: computeTotalPages(page, d.hasMore, d.results.length),
    hasMore: d.hasMore,
    searchType: d.searchType ?? session.searchType,
    personalityId: session.personalityId,
  });
}

/** Swap-render components: the multi-select page plus a Cancel affordance. */
export function buildMemoryBatchSelectComponents(
  session: MemoryListSession,
  items: MemoryItem[],
  page: number
): ReturnType<typeof buildBatchModeRows> {
  // The factory caps maxValues at the item count and clamps to [1, 25]
  // itself, so the full page size can be passed verbatim.
  const selectRow = buildBrowseSelectMenu<MemoryItem>({
    items,
    customId: buildMemoryActionId('batch-select'),
    placeholder: 'Select several memories to manage...',
    startIndex: page * pageSizeFor(session),
    maxValues: pageSizeFor(session),
    formatItem: formatMemorySelectOption,
  });
  return buildBatchModeRows({
    selectRow,
    cancelCustomId: buildMemoryActionId('batch-cancel'),
  });
}

/**
 * "Select several" entry — swap the current page into multi-select mode.
 * Ack-first; the page state lives in the messageId-keyed list session like
 * pagination, and the fetch dispatches on the session's kind.
 */
export async function handleMemoryBatchSelectEntry(interaction: ButtonInteraction): Promise<void> {
  await ackUpdate(interaction);

  const session = await findMemoryListSessionByMessage(interaction.message.id);
  if (session === null) {
    await followUpSpec(interaction, CATALOG.progress.sessionExpired());
    return;
  }

  const { userClient } = clientsFor(interaction);
  const data = await fetchPageForSession(userClient, session.data, session.data.currentPage);
  if (data === null) {
    await followUpSpec(interaction, CATALOG.error.transient(PAGE_FETCH_FAILED_COPY));
    return;
  }

  await interaction.editReply({
    embeds: [buildListEmbed(session.data, data, session.data.currentPage)],
    components: buildMemoryBatchSelectComponents(
      session.data,
      itemsOf(data),
      session.data.currentPage
    ),
  });
}

/**
 * Multi-select finished — show the confirm view listing EVERY selected
 * memory (labels + 🔐 badges read off the still-attached menu), with Lock /
 * Delete verb buttons and Cancel. The selected ids ride the embed footer so
 * the confirm handler can recover them.
 */
export async function handleMemoryBatchPick(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  await ackUpdate(interaction);

  const ids = interaction.values.filter(value => value.length > 0);
  if (ids.length === 0) {
    await followUpSpec(interaction, CATALOG.error.validation('No memories were selected.'));
    return;
  }

  const labels = readSelectOptionLabels(interaction.message);
  const listing = ids
    .map(id => {
      const label = labels.get(id) ?? fallbackMemoryLabel(id);
      return `• ${escapeMarkdown(label)}`;
    })
    .join('\n');
  const warning =
    `**This affects ${ids.length} ${ids.length === 1 ? 'memory' : 'memories'} immediately.** ` +
    'Delete is permanent — a deleted memory cannot be recovered.';

  const { embed, components } = buildBatchConfirmView({
    title: '⚠️ Manage Several Memories',
    // The listing is clamped, never the warning — end-truncation must not
    // drop the safety copy.
    description: clampBatchConfirmDescription(listing, warning),
    footerText: encodeBatchFooterIds(ids),
    // The factory row is Cancel → Delete (Danger), Danger last; the
    // Secondary Lock verb rides its own row ABOVE the confirm row.
    secondaryVerb: {
      customId: buildMemoryActionId('batch-confirm', 'lock'),
      label: `Lock (${ids.length})`,
      emoji: '🔐',
    },
    confirm: {
      customId: buildMemoryActionId('batch-confirm', 'delete'),
      label: `Delete (${ids.length})`,
      emoji: '🗑️',
    },
    cancelCustomId: buildMemoryActionId('batch-cancel'),
  });

  await interaction.editReply({ embeds: [embed], components });
}
