/**
 * Generalized deletion-tombstone utilities for db-sync.
 *
 * `sync_tombstones` rows are written by the sync_tombstone_capture() AFTER
 * DELETE trigger (migration 20260710230428) on every synced table — covering
 * Prisma deletes, manual SQL, and cascade deletes alike. The sync consults
 * the union of both sides' tombstones so a row hard-deleted in one
 * environment is DELETE-propagated to the other instead of resurrected
 * (the "delete presets twice" failure this system exists to kill).
 *
 * The bespoke conversation_history tombstone path (tombstoneUtils.ts) stays
 * separate — adjudicated, not just deferred: its tombstones are written at
 * SOFT-delete time (app-level intent a DB trigger can't see), and the bulk
 * retention path (1000-row createMany batches, unbounded total) would suffer
 * per-row trigger amplification for zero benefit. Consolidation would DRY
 * only the storage table while keeping both write disciplines.
 */

import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { SYNC_TABLE_ORDER, SYNC_CONFIG } from '../config/syncTables.js';
import { assertValidTableName } from './syncValidation.js';

const logger = createLogger('db-sync-tombstones');

/** Batch size for paginated tombstone loading (mirrors tombstoneUtils). */
const TOMBSTONE_BATCH_SIZE = 1000;

/** Tombstones older than this are pruned once both sides have synced. */
export const TOMBSTONE_RETENTION_DAYS = 30;

/** One propagated deletion: the row named by (tableName, rowKey) must be
 * removed from the side that still holds it. */
export interface PendingDelete {
  tableName: string;
  /** The '|'-joined SYNC_CONFIG pk value(s) — getPrimaryKey's encoding. */
  rowKey: string;
}

/** Map key for a tombstone: tableName never contains '|', so the first
 * separator is unambiguous even for composite rowKeys. */
export function tombstoneKey(tableName: string, rowKey: string): string {
  return `${tableName}|${rowKey}`;
}

async function loadFromDb(client: PrismaClient, dbName: string): Promise<Map<string, Date>> {
  const result = new Map<string, Date>();
  let cursor: { tableName: string; rowPk: string } | undefined;

  while (true) {
    const batch = await client.syncTombstone.findMany({
      take: TOMBSTONE_BATCH_SIZE,
      skip: cursor !== undefined ? 1 : 0,
      cursor: cursor !== undefined ? { tableName_rowPk: cursor } : undefined,
      orderBy: [{ tableName: 'asc' }, { rowPk: 'asc' }],
    });
    if (batch.length === 0) {
      break;
    }
    for (const row of batch) {
      result.set(tombstoneKey(row.tableName, row.rowPk), row.deletedAt);
    }
    const last = batch[batch.length - 1];
    cursor = { tableName: last.tableName, rowPk: last.rowPk };
    if (batch.length < TOMBSTONE_BATCH_SIZE) {
      break;
    }
  }
  logger.debug({ dbName, count: result.size }, 'Loaded sync tombstones');
  return result;
}

/**
 * Union of both sides' tombstones, latest deleted_at winning per key — the
 * same both-sides-merge shape as the bespoke loadTombstoneIds.
 */
export async function loadSyncTombstones(
  devClient: PrismaClient,
  prodClient: PrismaClient
): Promise<Map<string, Date>> {
  const [dev, prod] = await Promise.all([
    loadFromDb(devClient, 'dev'),
    loadFromDb(prodClient, 'prod'),
  ]);
  const merged = new Map<string, Date>(dev);
  for (const [key, deletedAt] of prod) {
    const existing = merged.get(key);
    if (existing === undefined || deletedAt > existing) {
      merged.set(key, deletedAt);
    }
  }
  return merged;
}

/**
 * Execute propagated deletions on one target, grouped per table in REVERSE
 * SYNC_TABLE_ORDER (children before parents — target-side CASCADE mops up
 * anything the source cascade also tombstoned, as harmless 0-row no-ops).
 * Each table's delete runs standalone (its own implicit transaction) so one
 * failure is isolated: fail-soft — the error lands in `warnings` and the
 * remaining tables still process. Known accepted edge: a propagated persona
 * delete hits users.default_persona_id ON DELETE RESTRICT only when the two
 * sides' user rows diverge; the warning surfaces it and the row survives
 * until reconciled.
 *
 * @returns per-table deleted counts
 */
export async function flushPendingDeletes(
  client: PrismaClient,
  deletes: PendingDelete[],
  label: 'dev' | 'prod',
  warnings: string[]
): Promise<{ counts: Record<string, number>; anyFailed: boolean }> {
  const counts: Record<string, number> = {};
  let anyFailed = false;
  if (deletes.length === 0) {
    return { counts, anyFailed };
  }

  const byTable = new Map<string, string[]>();
  for (const del of deletes) {
    const keys = byTable.get(del.tableName) ?? [];
    keys.push(del.rowKey);
    byTable.set(del.tableName, keys);
  }

  const reverseOrder = [...SYNC_TABLE_ORDER].reverse();
  for (const tableName of reverseOrder) {
    const rowKeys = byTable.get(tableName);
    if (rowKeys === undefined) {
      continue;
    }
    // Chunked with per-chunk accounting: each chunk's DELETE commits on its
    // own, so a later chunk's failure must not erase the count of rows the
    // earlier chunks already removed (stats honesty over tidiness).
    // Note: these DELETEs fire this side's own sync_tombstone_capture
    // trigger, refreshing the local tombstone's deleted_at — harmless and
    // idempotent (the row genuinely is deleted here at this instant).
    let deletedSoFar = 0;
    try {
      for (let offset = 0; offset < rowKeys.length; offset += TOMBSTONE_BATCH_SIZE) {
        deletedSoFar += await deleteRowsChunk(
          client,
          tableName,
          rowKeys.slice(offset, offset + TOMBSTONE_BATCH_SIZE)
        );
      }
      counts[tableName] = deletedSoFar;
      logger.info({ label, tableName, deleted: deletedSoFar }, 'Propagated tombstoned deletions');
    } catch (error) {
      anyFailed = true;
      if (deletedSoFar > 0) {
        counts[tableName] = deletedSoFar;
      }
      const message = `${tableName}: delete propagation failed on ${label} after ${deletedSoFar} of ${rowKeys.length} rows — remainder survives until reconciled`;
      logger.warn({ err: error, label, tableName, rows: rowKeys.length }, message);
      warnings.push(message);
    }
  }
  return { counts, anyFailed };
}

/**
 * Delete ONE chunk of rows by their '|'-encoded pk values using the table's
 * SYNC_CONFIG pk definition. Parameterized throughout; table/column names
 * come from SYNC_CONFIG (validated), never from data. Chunking and failure
 * accounting live in the caller.
 */
async function deleteRowsChunk(
  client: PrismaClient,
  tableName: string,
  chunk: string[]
): Promise<number> {
  assertValidTableName(tableName);
  const config = SYNC_CONFIG[tableName];
  const pkColumns = typeof config.pk === 'string' ? [config.pk] : [...config.pk];

  const params: string[] = [];
  const tuples = chunk.map(key => {
    const parts = key.split('|');
    if (parts.length !== pkColumns.length) {
      throw new Error(
        `rowKey "${key}" has ${parts.length} parts but ${tableName} pk has ${pkColumns.length} columns`
      );
    }
    const placeholders = parts.map((part, colIdx) => {
      params.push(part);
      const idx = params.length;
      return config.uuidColumns.includes(pkColumns[colIdx]) ? `$${idx}::uuid` : `$${idx}`;
    });
    return `(${placeholders.join(', ')})`;
  });
  const columnList = pkColumns.map(c => `"${c}"`).join(', ');
  return client.$executeRawUnsafe(
    `DELETE FROM "${tableName}" WHERE (${columnList}) IN (${tuples.join(', ')})`,
    ...params
  );
}

/**
 * Prune tombstones past the retention window on both sides. Runs only after
 * a non-dry sync whose delete propagation had ZERO failures — the fail-soft
 * delete path means "both sides converged" is only guaranteed on a clean
 * pass. Pruning after a failed propagation would age out the very tombstone
 * protecting the unpropagated deletion, silently resurrecting the row later
 * (the exact bug this system exists to kill). One lingering failure pausing
 * ALL pruning is the safe trade at this scale: tombstones are tiny, and the
 * per-run warning keeps the failure visible until reconciled.
 */
export async function pruneSyncTombstones(
  devClient: PrismaClient,
  prodClient: PrismaClient
): Promise<number> {
  const cutoff = new Date(Date.now() - TOMBSTONE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const [dev, prod] = await Promise.all([
    devClient.syncTombstone.deleteMany({ where: { deletedAt: { lt: cutoff } } }),
    prodClient.syncTombstone.deleteMany({ where: { deletedAt: { lt: cutoff } } }),
  ]);
  const pruned = dev.count + prod.count;
  if (pruned > 0) {
    logger.info({ pruned }, 'Pruned expired sync tombstones');
  }
  return pruned;
}
