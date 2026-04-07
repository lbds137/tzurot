/**
 * Memory Browse/Search Session
 *
 * Dashboard session types + helpers for the memory list/search router-pattern
 * migration. Sessions store the browse context (filter, page) so detail view
 * "back" buttons can return to the right place, and pagination handlers can
 * recover per-user filter state across restarts.
 *
 * Sessions are keyed by messageId (via entityId) so concurrent browses from
 * the same user don't collide.
 */

import { getSessionManager } from '../../utils/dashboard/index.js';
import type { DashboardSession } from '../../utils/dashboard/types.js';

/** Discriminator for browse vs search sessions */
export type MemoryListKind = 'browse' | 'search';

/** Session entity types — kept aligned with MemoryListKind via entityTypeForKind() */
export const MEMORY_BROWSE_ENTITY_TYPE = 'memory-browse';
export const MEMORY_SEARCH_ENTITY_TYPE = 'memory-search';

export type MemoryListEntityType =
  | typeof MEMORY_BROWSE_ENTITY_TYPE
  | typeof MEMORY_SEARCH_ENTITY_TYPE;

/**
 * Discriminated union for memory list sessions.
 *
 * Browse sessions don't carry a search query; search sessions require one.
 * Using a discriminated union (rather than a flat optional field) catches
 * missing-query bugs at compile time and prevents browse handlers from
 * accidentally reading `searchQuery`.
 */
export type MemoryListSession =
  | {
      kind: 'browse';
      /** Optional personality filter (undefined = all personalities) */
      personalityId?: string;
      /** Current page number (0-indexed) */
      currentPage: number;
    }
  | {
      kind: 'search';
      /** Optional personality filter (undefined = all personalities) */
      personalityId?: string;
      /** Current page number (0-indexed) */
      currentPage: number;
      /** The user's search query — required for search sessions */
      searchQuery: string;
      /**
       * Page size chosen at search time (from the `/memory search limit`
       * option, defaulting to 5). Persisted so pagination uses the same
       * size as the original search rather than reverting to the default.
       */
      pageSize: number;
      /**
       * Search type returned by the first page. When 'text', subsequent
       * pagination requests skip the semantic attempt and go straight to
       * text search — saving an embedding round-trip per page click.
       * Undefined means the first response had no searchType field
       * (backwards compatibility) — pagination should attempt semantic.
       */
      searchType?: 'semantic' | 'text';
    };

/**
 * Map a session kind to its entity type constant. Single source of truth for
 * the kind ↔ entity-type relationship — callers should use this rather than
 * passing entity types manually to avoid divergence.
 */
export function entityTypeForKind(kind: MemoryListKind): MemoryListEntityType {
  return kind === 'browse' ? MEMORY_BROWSE_ENTITY_TYPE : MEMORY_SEARCH_ENTITY_TYPE;
}

/**
 * Persist a memory browse session for a specific message.
 * Uses messageId as the entityId so concurrent browses from the same user
 * don't collide (each message gets its own session).
 */
export async function saveMemoryListSession(opts: {
  userId: string;
  messageId: string;
  channelId: string;
  data: MemoryListSession;
}): Promise<void> {
  const sessionManager = getSessionManager();
  await sessionManager.set<MemoryListSession>({
    userId: opts.userId,
    entityType: entityTypeForKind(opts.data.kind),
    entityId: opts.messageId,
    data: opts.data,
    messageId: opts.messageId,
    channelId: opts.channelId,
  });
}

/**
 * Look up a memory list session by the Discord message ID.
 * Returns null if the session doesn't exist or has expired.
 */
export async function findMemoryListSessionByMessage(
  messageId: string
): Promise<DashboardSession<MemoryListSession> | null> {
  const sessionManager = getSessionManager();
  return sessionManager.findByMessageId<MemoryListSession>(messageId);
}

/**
 * Update an existing memory list session (e.g., to advance the page).
 * Returns false if the session doesn't exist (expired or never existed).
 *
 * Note: this is a non-atomic read-modify-write. Discord serializes UI clicks
 * per message, so concurrent pagination updates from the same message are
 * effectively impossible. Two simultaneous pagination clicks from different
 * users on the same message would be a different concern entirely.
 */
export async function updateMemoryListSessionPage(opts: {
  userId: string;
  messageId: string;
  kind: MemoryListKind;
  newPage: number;
}): Promise<boolean> {
  const sessionManager = getSessionManager();
  const entityType = entityTypeForKind(opts.kind);
  const existing = await sessionManager.get<MemoryListSession>(
    opts.userId,
    entityType,
    opts.messageId
  );
  if (existing === null) {
    return false;
  }
  await sessionManager.update<MemoryListSession>(opts.userId, entityType, opts.messageId, {
    ...existing.data,
    currentPage: opts.newPage,
  });
  return true;
}

/**
 * Result of {@link fetchPageWithEmptyFallback}.
 */
export interface EmptyPageFallbackResult<T> {
  /** The fetched page data (from either the initial or stepped-back fetch) */
  data: T;
  /** Final page number — one less than `currentPage` if we stepped back */
  page: number;
  /** True if we stepped back; caller should update the session accordingly */
  steppedBack: boolean;
}

/**
 * Fetch the current page; if it's empty (e.g., the last item on the page
 * was just deleted and we're on page > 0), step back one page and refetch.
 * Returns `null` on fetch failure (either initial or retry).
 *
 * This encapsulates the "go back one page after delete" edge case shared
 * by refreshBrowseList and refreshSearchList. The helper stays generic
 * over the page data type — callers provide fetch and emptiness callbacks
 * so browse (which returns `{ memories, total }`) and search (which
 * returns `{ results, hasMore }`) can both use it without coupling
 * their response shapes.
 *
 * The caller is responsible for updating the session when `steppedBack`
 * is true — the helper deliberately doesn't touch session state to stay
 * framework-agnostic and easy to test.
 */
export async function fetchPageWithEmptyFallback<T>(opts: {
  currentPage: number;
  fetchPage: (page: number) => Promise<T | null>;
  isEmpty: (data: T) => boolean;
}): Promise<EmptyPageFallbackResult<T> | null> {
  const { currentPage, fetchPage, isEmpty } = opts;

  const initial = await fetchPage(currentPage);
  if (initial === null) {
    return null;
  }

  if (!isEmpty(initial) || currentPage === 0) {
    return { data: initial, page: currentPage, steppedBack: false };
  }

  const prevPage = currentPage - 1;
  const retry = await fetchPage(prevPage);
  if (retry === null) {
    return null;
  }
  return { data: retry, page: prevPage, steppedBack: true };
}
