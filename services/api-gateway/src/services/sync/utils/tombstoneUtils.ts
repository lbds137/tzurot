/**
 * Tombstone Utilities for Database Sync
 *
 * Handles loading tombstone IDs and deleting messages with tombstones
 * to prevent db-sync from restoring hard-deleted conversation history.
 */

import { type PrismaClient } from '@tzurot/common-types';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('db-sync-tombstones');

/** Batch size for paginated tombstone loading to prevent OOM */
const TOMBSTONE_BATCH_SIZE = 1000;

/**
 * Load tombstone IDs from a single database using cursor-based pagination
 */
async function loadTombstonesFromDb(client: PrismaClient, dbName: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;

  while (true) {
    const batch = await client.conversationHistoryTombstone.findMany({
      select: { id: true },
      take: TOMBSTONE_BATCH_SIZE,
      skip: cursor !== undefined ? 1 : 0,
      cursor: cursor !== undefined ? { id: cursor } : undefined,
      orderBy: { id: 'asc' },
    });

    if (batch.length === 0) {
      break;
    }

    for (const row of batch) {
      ids.push(row.id);
    }

    cursor = batch[batch.length - 1].id;

    // If we got less than batch size, we're done
    if (batch.length < TOMBSTONE_BATCH_SIZE) {
      break;
    }
  }

  logger.debug({ dbName, count: ids.length }, '[Sync] Loaded tombstones from database');
  return ids;
}

/**
 * Load all tombstone IDs from both databases using cursor-based pagination
 * Used to prevent syncing deleted conversation history
 */
export async function loadTombstoneIds(
  devClient: PrismaClient,
  prodClient: PrismaClient
): Promise<Set<string>> {
  // Load tombstones from both databases with pagination
  const [devTombstones, prodTombstones] = await Promise.all([
    loadTombstonesFromDb(devClient, 'dev'),
    loadTombstonesFromDb(prodClient, 'prod'),
  ]);

  const tombstoneIds = new Set<string>();
  for (const id of devTombstones) {
    tombstoneIds.add(id);
  }
  for (const id of prodTombstones) {
    tombstoneIds.add(id);
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
