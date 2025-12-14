/**
 * Tombstone Utilities for Database Sync
 *
 * Handles loading tombstone IDs and deleting messages with tombstones
 * to prevent db-sync from restoring hard-deleted conversation history.
 */

import { type PrismaClient } from '@tzurot/common-types';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('db-sync-tombstones');

/**
 * Load all tombstone IDs from both databases
 * Used to prevent syncing deleted conversation history
 */
export async function loadTombstoneIds(
  devClient: PrismaClient,
  prodClient: PrismaClient
): Promise<Set<string>> {
  // Use typed Prisma methods instead of $queryRawUnsafe for safety
  const [devTombstones, prodTombstones] = await Promise.all([
    devClient.conversationHistoryTombstone.findMany({ select: { id: true } }),
    prodClient.conversationHistoryTombstone.findMany({ select: { id: true } }),
  ]);

  const tombstoneIds = new Set<string>();
  for (const row of devTombstones) {
    tombstoneIds.add(row.id);
  }
  for (const row of prodTombstones) {
    tombstoneIds.add(row.id);
  }

  logger.debug(
    { count: tombstoneIds.size },
    '[Sync] Loaded tombstone IDs for conversation history sync'
  );

  return tombstoneIds;
}

/**
 * Delete conversation history messages that have tombstones
 * This propagates hard-deletes across databases
 */
export async function deleteMessagesWithTombstones(
  devClient: PrismaClient,
  prodClient: PrismaClient,
  tombstoneIds: Set<string>,
  dryRun: boolean
): Promise<{ devDeleted: number; prodDeleted: number }> {
  if (tombstoneIds.size === 0) {
    return { devDeleted: 0, prodDeleted: 0 };
  }

  const tombstoneArray = Array.from(tombstoneIds);
  let devDeleted = 0;
  let prodDeleted = 0;

  if (!dryRun) {
    // Use typed Prisma methods instead of $executeRawUnsafe for safety
    const [devResult, prodResult] = await Promise.all([
      devClient.conversationHistory.deleteMany({
        where: { id: { in: tombstoneArray } },
      }),
      prodClient.conversationHistory.deleteMany({
        where: { id: { in: tombstoneArray } },
      }),
    ]);

    devDeleted = devResult.count;
    prodDeleted = prodResult.count;

    if (devDeleted > 0 || prodDeleted > 0) {
      logger.info(
        { devDeleted, prodDeleted },
        '[Sync] Deleted conversation history messages with tombstones'
      );
    }
  }

  return { devDeleted, prodDeleted };
}
