/**
 * Memory Detail API Client
 * API functions for single memory operations
 */

import { createLogger } from '@tzurot/common-types';
import { callGatewayApi, type GatewayUser } from '../../utils/userGatewayClient.js';

/**
 * Memory item structure from API
 */
export interface MemoryItem {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  personalityId: string;
  personalityName: string;
  isLocked: boolean;
}

const logger = createLogger('memory-detail-api');

interface SingleMemoryResponse {
  memory: MemoryItem;
}

/**
 * Fetch a single memory by ID
 */
export async function fetchMemory(user: GatewayUser, memoryId: string): Promise<MemoryItem | null> {
  const result = await callGatewayApi<SingleMemoryResponse>(
    `/user/memory/${encodeURIComponent(memoryId)}`,
    {
      user,
      method: 'GET',
    }
  );

  if (!result.ok) {
    logger.warn(
      { userId: user.discordId, memoryId, error: result.error },
      '[Memory] Failed to fetch memory'
    );
    return null;
  }

  return result.data.memory;
}

/**
 * Update memory content
 */
export async function updateMemory(
  user: GatewayUser,
  memoryId: string,
  content: string
): Promise<MemoryItem | null> {
  const result = await callGatewayApi<SingleMemoryResponse>(
    `/user/memory/${encodeURIComponent(memoryId)}`,
    {
      user,
      method: 'PATCH',
      body: { content },
    }
  );

  if (!result.ok) {
    logger.warn(
      { userId: user.discordId, memoryId, error: result.error },
      '[Memory] Failed to update memory'
    );
    return null;
  }

  return result.data.memory;
}

/**
 * Toggle memory lock status
 */
export async function toggleMemoryLock(
  user: GatewayUser,
  memoryId: string
): Promise<MemoryItem | null> {
  const result = await callGatewayApi<SingleMemoryResponse>(
    `/user/memory/${encodeURIComponent(memoryId)}/lock`,
    {
      user,
      method: 'POST',
    }
  );

  if (!result.ok) {
    logger.warn(
      { userId: user.discordId, memoryId, error: result.error },
      '[Memory] Failed to toggle lock'
    );
    return null;
  }

  return result.data.memory;
}

/**
 * Delete a memory
 */
export async function deleteMemory(user: GatewayUser, memoryId: string): Promise<boolean> {
  const result = await callGatewayApi<{ success: boolean }>(
    `/user/memory/${encodeURIComponent(memoryId)}`,
    {
      user,
      method: 'DELETE',
    }
  );

  if (!result.ok) {
    logger.warn(
      { userId: user.discordId, memoryId, error: result.error },
      '[Memory] Failed to delete memory'
    );
    return false;
  }

  return result.data.success;
}
