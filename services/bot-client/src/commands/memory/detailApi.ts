/**
 * Memory Detail API Client
 * API functions for single memory operations
 */

import { createLogger } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import type { MemoryItem } from './detail.js';

const logger = createLogger('memory-detail-api');

interface SingleMemoryResponse {
  memory: MemoryItem;
}

/**
 * Fetch a single memory by ID
 */
export async function fetchMemory(userId: string, memoryId: string): Promise<MemoryItem | null> {
  const result = await callGatewayApi<SingleMemoryResponse>(`/user/memory/${memoryId}`, {
    userId,
    method: 'GET',
  });

  if (!result.ok) {
    logger.warn({ userId, memoryId, error: result.error }, '[Memory] Failed to fetch memory');
    return null;
  }

  return result.data.memory;
}

/**
 * Update memory content
 */
export async function updateMemory(
  userId: string,
  memoryId: string,
  content: string
): Promise<MemoryItem | null> {
  const result = await callGatewayApi<SingleMemoryResponse>(`/user/memory/${memoryId}`, {
    userId,
    method: 'PATCH',
    body: { content },
  });

  if (!result.ok) {
    logger.warn({ userId, memoryId, error: result.error }, '[Memory] Failed to update memory');
    return null;
  }

  return result.data.memory;
}

/**
 * Toggle memory lock status
 */
export async function toggleMemoryLock(
  userId: string,
  memoryId: string
): Promise<MemoryItem | null> {
  const result = await callGatewayApi<SingleMemoryResponse>(`/user/memory/${memoryId}/lock`, {
    userId,
    method: 'POST',
  });

  if (!result.ok) {
    logger.warn({ userId, memoryId, error: result.error }, '[Memory] Failed to toggle lock');
    return null;
  }

  return result.data.memory;
}

/**
 * Delete a memory
 */
export async function deleteMemory(userId: string, memoryId: string): Promise<boolean> {
  const result = await callGatewayApi<{ success: boolean }>(`/user/memory/${memoryId}`, {
    userId,
    method: 'DELETE',
  });

  if (!result.ok) {
    logger.warn({ userId, memoryId, error: result.error }, '[Memory] Failed to delete memory');
    return false;
  }

  return result.data.success;
}
