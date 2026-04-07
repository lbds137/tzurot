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

/** Data stored in a memory browse/search session */
export interface MemoryListSession {
  kind: MemoryListKind;
  /** Optional personality filter (undefined = all personalities) */
  personalityId?: string;
  /** Current page number (0-indexed) */
  currentPage: number;
  /** For search sessions only: the user's query */
  searchQuery?: string;
}

/** Session entity types — separate to allow different cleanup/lookup patterns if needed */
export const MEMORY_BROWSE_ENTITY_TYPE = 'memory-browse';
export const MEMORY_SEARCH_ENTITY_TYPE = 'memory-search';

/**
 * Persist a memory browse session for a specific message.
 * Uses messageId as the entityId so concurrent browses from the same user
 * don't collide (each message gets its own session).
 */
export async function saveMemoryListSession(opts: {
  userId: string;
  messageId: string;
  channelId: string;
  entityType: typeof MEMORY_BROWSE_ENTITY_TYPE | typeof MEMORY_SEARCH_ENTITY_TYPE;
  data: MemoryListSession;
}): Promise<void> {
  const sessionManager = getSessionManager();
  await sessionManager.set<MemoryListSession>({
    userId: opts.userId,
    entityType: opts.entityType,
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
 */
export async function updateMemoryListSessionPage(opts: {
  userId: string;
  messageId: string;
  entityType: typeof MEMORY_BROWSE_ENTITY_TYPE | typeof MEMORY_SEARCH_ENTITY_TYPE;
  newPage: number;
}): Promise<boolean> {
  const sessionManager = getSessionManager();
  const existing = await sessionManager.get<MemoryListSession>(
    opts.userId,
    opts.entityType,
    opts.messageId
  );
  if (existing === null) {
    return false;
  }
  await sessionManager.update<MemoryListSession>(opts.userId, opts.entityType, opts.messageId, {
    ...existing.data,
    currentPage: opts.newPage,
  });
  return true;
}
