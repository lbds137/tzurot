/**
 * Memory Detail API Client
 * API functions for single memory operations.
 *
 * The trailing optional `userId?: string` parameter on each helper is for
 * structured-logging context only — it never affects request shape or
 * routing. Production call sites in `detail.ts` / `detailModals.ts` all
 * pass it; the optionality exists so tests stubbing `UserClient` directly
 * don't have to thread a userId through.
 */

import { type MemoryItem } from '@tzurot/common-types/schemas/api/memory';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type UserClient } from '@tzurot/clients';

const logger = createLogger('memory-detail-api');

/**
 * Fetch a single memory by ID
 */
export async function fetchMemory(
  userClient: UserClient,
  memoryId: string,
  userId?: string
): Promise<MemoryItem | null> {
  const result = await userClient.getMemory(memoryId);

  if (!result.ok) {
    logger.warn({ userId, memoryId, error: result.error }, 'Failed to fetch memory');
    return null;
  }

  return result.data.memory;
}

/**
 * Update memory content
 */
export async function updateMemory(
  userClient: UserClient,
  memoryId: string,
  content: string,
  userId?: string
): Promise<MemoryItem | null> {
  const result = await userClient.updateMemory(memoryId, { content });

  if (!result.ok) {
    logger.warn({ userId, memoryId, error: result.error }, 'Failed to update memory');
    return null;
  }

  return result.data.memory;
}

/**
 * Set memory lock state explicitly. Idempotent on retry — caller supplies
 * the desired final state so a network-retried request can't accidentally
 * unlock something the previous attempt locked.
 */
export async function setMemoryLock(
  userClient: UserClient,
  memoryId: string,
  locked: boolean,
  userId?: string
): Promise<MemoryItem | null> {
  const result = await userClient.setMemoryLock(memoryId, { locked });

  if (!result.ok) {
    logger.warn({ userId, memoryId, locked, error: result.error }, 'Failed to set memory lock');
    return null;
  }

  return result.data.memory;
}

/**
 * Delete a memory
 */
export async function deleteMemory(
  userClient: UserClient,
  memoryId: string,
  userId?: string
): Promise<boolean> {
  const result = await userClient.deleteMemory(memoryId);

  if (!result.ok) {
    logger.warn({ userId, memoryId, error: result.error }, 'Failed to delete memory');
    return false;
  }

  return result.data.success;
}
