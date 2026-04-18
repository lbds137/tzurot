/**
 * Database Sync Service
 *
 * Bidirectional last-write-wins synchronization between dev and prod Postgres
 * databases using the "Ouroboros Insert" pattern (see PR addressing beta.100
 * db-sync blocker).
 *
 * The critical constraint: users↔personas and users↔llm_configs form circular
 * NOT NULL foreign-key pairs (every user must have a default persona AND
 * a default llm config; personas.owner_id and llm_configs.owner_id are
 * also NOT NULL FKs back to users). You cannot insert either side first
 * without violating the other's FK.
 *
 * The solution (validated via council + PGLite probe + int test):
 *
 *   1. Migration 20260418010642 made the four circular FKs DEFERRABLE
 *      INITIALLY IMMEDIATE so runtime enforcement is unchanged but sync
 *      can defer checks to COMMIT time.
 *   2. This service collects all pending writes per direction (dev-bound,
 *      prod-bound) without executing them during the table scan loop.
 *   3. Writes are flushed inside per-direction transactions that start
 *      with `SET CONSTRAINTS ALL DEFERRED`. Real FK values go in from
 *      the start; Postgres validates all deferred FKs at COMMIT when
 *      every referenced row exists.
 *
 * Previously this used a "two-pass" pattern (pass 1 insert with
 * default_persona_id=NULL; pass 2 UPDATE to backfill). That broke when
 * migration 20260416215546 made default_persona_id NOT NULL in Phase 5b
 * of the Identity Epic — NOT NULL is a column property, not a deferrable
 * constraint, so pass 1's NULL INSERT failed immediately with 23502.
 * The Ouroboros Insert approach is structurally simpler (single pass,
 * no ForeignKeyReconciler pass-2 machinery) and future-proofs against
 * the next circular NOT NULL hardening.
 *
 * Cross-database transactions are still out of scope (would require 2PC).
 * Two independent transactions means interrupted sync is idempotent —
 * running again picks up where it left off.
 */

import { type PrismaClient } from '@tzurot/common-types';
import { createLogger } from '@tzurot/common-types';
import { SYNC_CONFIG, SYNC_TABLE_ORDER, type TableSyncConfig } from './sync/config/syncTables.js';
import { checkSchemaVersions, validateSyncConfig } from './sync/utils/syncValidation.js';
import { loadTombstoneIds, deleteMessagesWithTombstones } from './sync/utils/tombstoneUtils.js';
import {
  prepareLlmConfigSingletonFlags,
  finalizeLlmConfigSingletonFlags,
} from './sync/utils/llmConfigSingletons.js';
import {
  fetchAllRows,
  buildRowMap,
  compareTimestamps,
  upsertRow,
  type SyncExecutor,
} from './sync/SyncUpsertBuilder.js';

const logger = createLogger('db-sync');

/**
 * Prisma interactive-transaction timeout in milliseconds. Defaults to 5s,
 * which is not enough for a real dev↔prod sync across all tables. 10 min
 * gives comfortable headroom for large row counts without being so long
 * that a stuck transaction hides a real failure.
 */
const SYNC_TX_TIMEOUT_MS = 600_000;
const SYNC_TX_MAX_WAIT_MS = 10_000;

interface SyncResult {
  schemaVersion: string;
  stats: Record<string, { devToProd: number; prodToDev: number; conflicts: number }>;
  warnings: string[];
  info: string[];
  changes?: unknown;
}

interface SyncOptions {
  dryRun: boolean;
}

/**
 * A pending row write collected during the scan phase and flushed inside
 * a deferred-constraints transaction during the flush phase.
 */
interface PendingWrite {
  tableName: string;
  row: unknown;
  pkField: string | readonly string[];
  uuidColumns: readonly string[];
  timestampColumns: readonly string[];
  excludeColumns: readonly string[];
}

export class DatabaseSyncService {
  constructor(
    private devClient: PrismaClient,
    private prodClient: PrismaClient
  ) {}

  /**
   * Perform bidirectional database synchronization.
   *
   * Phase 1 (scan): read all rows from both DBs, compare via last-write-wins
   * per row, accumulate pending writes into dev-bound and prod-bound buckets.
   * No writes occur in this phase.
   *
   * Phase 2 (flush): per target direction, open a transaction, issue
   * `SET CONSTRAINTS ALL DEFERRED`, apply all pending writes, COMMIT.
   * Postgres validates all deferred FKs at COMMIT; either every write
   * commits or none do (per transaction).
   *
   * Not transactional across both databases (cross-DB transactions would
   * require 2-phase commit). Interrupted runs are safe to re-run — the
   * comparison is idempotent and the flush either succeeds fully or
   * rolls back fully.
   */
  async sync(options: SyncOptions): Promise<SyncResult> {
    try {
      logger.info({ dryRun: options.dryRun }, '[Sync] Starting database sync');

      await this.devClient.$connect();
      await this.prodClient.$connect();

      const schemaVersion = await checkSchemaVersions(this.devClient, this.prodClient);
      logger.info({ schemaVersion }, '[Sync] Schema versions verified');

      const configValidation = await validateSyncConfig(this.devClient, SYNC_CONFIG);

      const stats: Record<string, { devToProd: number; prodToDev: number; conflicts: number }> = {};
      const warnings: string[] = [...configValidation.warnings];
      const info: string[] = [...configValidation.info];

      const tombstoneIds = await loadTombstoneIds(this.devClient, this.prodClient);

      // Scan phase — collect pending writes without executing them.
      const devBoundWrites: PendingWrite[] = [];
      const prodBoundWrites: PendingWrite[] = [];

      logger.info('[Sync] Phase 1: Scanning tables and accumulating pending writes');
      for (const tableName of SYNC_TABLE_ORDER) {
        const config = SYNC_CONFIG[tableName];
        logger.info({ table: tableName }, '[Sync] Scanning table');

        if (tableName === 'llm_configs' && !options.dryRun) {
          await prepareLlmConfigSingletonFlags(this.devClient, this.prodClient);
        }

        if (tableName === 'conversation_history') {
          const { devDeleted, prodDeleted } = await deleteMessagesWithTombstones(
            this.devClient,
            this.prodClient,
            tombstoneIds,
            options.dryRun
          );
          if (devDeleted > 0 || prodDeleted > 0) {
            warnings.push(
              `conversation_history: ${devDeleted + prodDeleted} messages deleted (had tombstones)`
            );
          }
        }

        const tableStats = await this.scanTable(
          tableName,
          config,
          tombstoneIds,
          devBoundWrites,
          prodBoundWrites
        );
        stats[tableName] = tableStats;

        if (tableStats.conflicts > 0) {
          warnings.push(
            `${tableName}: ${tableStats.conflicts} conflicts resolved using last-write-wins`
          );
        }
      }

      // Flush phase — one transaction per direction, with SET CONSTRAINTS
      // ALL DEFERRED so circular NOT NULL FKs can insert atomically.
      if (!options.dryRun) {
        await this.flushWrites(this.devClient, devBoundWrites, 'dev');
        await this.flushWrites(this.prodClient, prodBoundWrites, 'prod');

        // Singleton-flag finalization runs OUTSIDE the sync transactions —
        // it needs to see the post-commit state of llm_configs to decide
        // which row wins the is_default / is_free_default flag in each env.
        await finalizeLlmConfigSingletonFlags(this.devClient, this.prodClient);
      }

      logger.info({ stats }, '[Sync] Sync complete');

      return { schemaVersion, stats, warnings, info };
    } finally {
      await this.devClient.$disconnect();
      await this.prodClient.$disconnect();
    }
  }

  /**
   * Flush pending writes to a target database inside a single transaction
   * with deferred constraints. On any failure inside the callback the
   * transaction rolls back — the target database remains at its pre-sync
   * state.
   */
  private async flushWrites(
    client: PrismaClient,
    writes: PendingWrite[],
    label: 'dev' | 'prod'
  ): Promise<void> {
    if (writes.length === 0) {
      return;
    }
    logger.info({ label, count: writes.length }, '[Sync] Phase 2: Flushing writes');
    await client.$transaction(
      async tx => {
        // `SET CONSTRAINTS ALL DEFERRED` requires every affected FK to
        // have been declared DEFERRABLE. Migration 20260418010642 did
        // this for the four circular FKs. Other FKs in the schema stay
        // non-deferrable and continue to enforce immediately, which is
        // what we want for guardrails against genuinely broken data.
        await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
        for (const w of writes) {
          await upsertRow({
            client: tx as unknown as SyncExecutor,
            tableName: w.tableName,
            row: w.row,
            pkField: w.pkField,
            uuidColumns: w.uuidColumns,
            timestampColumns: w.timestampColumns,
            excludeColumns: w.excludeColumns,
          });
        }
      },
      { timeout: SYNC_TX_TIMEOUT_MS, maxWait: SYNC_TX_MAX_WAIT_MS }
    );
  }

  /**
   * Scan a single table and accumulate pending writes into the two
   * direction buckets. Reads from both DBs, compares row-by-row using
   * last-write-wins on timestamps, and records each action without
   * executing it.
   */
  private async scanTable(
    tableName: string,
    config: TableSyncConfig,
    tombstoneIds: Set<string> | undefined,
    devBoundWrites: PendingWrite[],
    prodBoundWrites: PendingWrite[]
  ): Promise<{ devToProd: number; prodToDev: number; conflicts: number }> {
    const devRows = await fetchAllRows(this.devClient, tableName);
    const prodRows = await fetchAllRows(this.prodClient, tableName);

    const devMap = buildRowMap(devRows, config.pk);
    const prodMap = buildRowMap(prodRows, config.pk);

    const allKeys = new Set([...devMap.keys(), ...prodMap.keys()]);
    const shouldSkipTombstones = tableName === 'conversation_history' && tombstoneIds !== undefined;

    const writeBase: Omit<PendingWrite, 'row'> = {
      tableName,
      pkField: config.pk,
      uuidColumns: config.uuidColumns,
      timestampColumns: config.timestampColumns,
      excludeColumns: config.excludeColumns ?? [],
    };

    const totals = { devToProd: 0, prodToDev: 0, conflicts: 0 };

    for (const key of allKeys) {
      if (shouldSkipTombstones && tombstoneIds?.has(key) === true) {
        continue;
      }
      classifyAndQueueRow({
        devRow: devMap.get(key),
        prodRow: prodMap.get(key),
        config,
        writeBase,
        devBoundWrites,
        prodBoundWrites,
        totals,
      });
    }

    return totals;
  }
}

/**
 * Decide which direction a single pk-key's row-pair flows (or neither)
 * and push into the matching bucket. Extracted from `scanTable` to keep
 * that method under sonarjs's cognitive-complexity cap; the five-branch
 * dispatch plus the totals-mutation reads more clearly as a helper.
 */
function classifyAndQueueRow(args: {
  devRow: unknown;
  prodRow: unknown;
  config: TableSyncConfig;
  writeBase: Omit<PendingWrite, 'row'>;
  devBoundWrites: PendingWrite[];
  prodBoundWrites: PendingWrite[];
  totals: { devToProd: number; prodToDev: number; conflicts: number };
}): void {
  const { devRow, prodRow, config, writeBase, devBoundWrites, prodBoundWrites, totals } = args;

  if (devRow === undefined && prodRow !== undefined) {
    devBoundWrites.push({ ...writeBase, row: prodRow });
    totals.prodToDev += 1;
    return;
  }
  if (devRow !== undefined && prodRow === undefined) {
    prodBoundWrites.push({ ...writeBase, row: devRow });
    totals.devToProd += 1;
    return;
  }
  if (devRow === undefined || prodRow === undefined) {
    return;
  }

  const comparison = compareTimestamps(devRow, prodRow, config);
  if (comparison === 'dev-newer') {
    prodBoundWrites.push({ ...writeBase, row: devRow });
    totals.devToProd += 1;
    totals.conflicts += 1;
  } else if (comparison === 'prod-newer') {
    devBoundWrites.push({ ...writeBase, row: prodRow });
    totals.prodToDev += 1;
    totals.conflicts += 1;
  }
}
