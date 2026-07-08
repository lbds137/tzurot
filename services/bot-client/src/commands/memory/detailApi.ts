/**
 * Memory Detail API Client
 * API functions for single memory operations.
 *
 * CONTRACT: `null` (or `false` for delete) means DEFINITIVELY absent — a
 * genuine 404. Every other failure THROWS (`InfraError` for transport/5xx,
 * `GatewayClientError` for a non-404 4xx) so callers can classify honestly
 * via `classifyGatewayFailure`. The previous collapse-everything-to-null
 * shape destroyed the transport kind: a timeout on a lock toggle read as
 * "not found" and the user got a definitive-failure message on an
 * outcome-uncertain write.
 *
 * The trailing optional `userId?: string` parameter on each helper is for
 * structured-logging context only — it never affects request shape or
 * routing. Production call sites in `detail.ts` / `detailModals.ts` all
 * pass it; the optionality exists so tests stubbing `UserClient` directly
 * don't have to thread a userId through.
 */

import { type MemoryItem } from '@tzurot/common-types/schemas/api/memory';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { nullOn404, type GatewayResult, type UserClient } from '@tzurot/clients';

const logger = createLogger('memory-detail-api');

/** Log non-404 failures before nullOn404 throws (observability parity). */
function warnNonMiss(
  result: GatewayResult<unknown>,
  context: Record<string, unknown>,
  message: string
): void {
  if (!result.ok && result.status !== 404) {
    logger.warn({ ...context, kind: result.kind, status: result.status }, message);
  }
}

/**
 * Fetch a single memory by ID. `null` = genuine 404; infra failures throw.
 */
export async function fetchMemory(
  userClient: UserClient,
  memoryId: string,
  userId?: string
): Promise<MemoryItem | null> {
  const result = await userClient.getMemory(memoryId);
  warnNonMiss(result, { userId, memoryId }, 'Failed to fetch memory');
  return nullOn404(result)?.memory ?? null;
}

/**
 * Update memory content. `null` = genuine 404; infra failures throw.
 */
export async function updateMemory(
  userClient: UserClient,
  memoryId: string,
  content: string,
  userId?: string
): Promise<MemoryItem | null> {
  const result = await userClient.updateMemory(memoryId, { content });
  warnNonMiss(result, { userId, memoryId }, 'Failed to update memory');
  return nullOn404(result)?.memory ?? null;
}

/**
 * Set memory lock state explicitly. Idempotent on retry — caller supplies
 * the desired final state so a network-retried request can't accidentally
 * unlock something the previous attempt locked. `null` = genuine 404;
 * infra failures throw.
 */
export async function setMemoryLock(
  userClient: UserClient,
  memoryId: string,
  locked: boolean,
  userId?: string
): Promise<MemoryItem | null> {
  const result = await userClient.setMemoryLock(memoryId, { locked });
  warnNonMiss(result, { userId, memoryId, locked }, 'Failed to set memory lock');
  return nullOn404(result)?.memory ?? null;
}

/**
 * Delete a memory. `false` = genuine 404 (already gone); infra failures throw.
 */
export async function deleteMemory(
  userClient: UserClient,
  memoryId: string,
  userId?: string
): Promise<boolean> {
  const result = await userClient.deleteMemory(memoryId);
  warnNonMiss(result, { userId, memoryId }, 'Failed to delete memory');
  const data = nullOn404(result);
  return data === null ? false : data.success;
}
