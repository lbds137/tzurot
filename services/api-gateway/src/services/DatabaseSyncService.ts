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
 *   1. Migration 20260418010642 made the original four circular FKs
 *      (users↔personas, users↔llm_configs) DEFERRABLE INITIALLY IMMEDIATE.
 *      Migration 20260504065151 added users.default_tts_config_id_fkey to
 *      that set when the TTS feature shipped. Runtime enforcement is
 *      unchanged for all five — sync can defer checks to COMMIT time only
 *      inside the explicit SET CONSTRAINTS block below.
 *   2. This service collects all pending writes per direction (dev-bound,
 *      prod-bound) without executing them during the table scan loop.
 *   3. Writes are flushed inside per-direction transactions that start
 *      by naming the deferred FKs in a `SET CONSTRAINTS ... DEFERRED`
 *      statement (explicit names rather than `ALL DEFERRED` so future
 *      migrations adding unrelated deferrable constraints don't get
 *      silently softened inside the sync). Real FK values go in from the
 *      start; Postgres validates the named FKs at COMMIT when every
 *      referenced row exists.
 *
 * Previously this used a "two-pass" pattern (pass 1 insert with
 * default_persona_id=NULL; pass 2 UPDATE to backfill). That broke when
 * migration 20260416215546 made default_persona_id NOT NULL — NOT NULL
 * is a column property, not a deferrable
 * constraint, so pass 1's NULL INSERT failed immediately with 23502.
 * The Ouroboros Insert approach is structurally simpler (single pass,
 * no ForeignKeyReconciler pass-2 machinery) and future-proofs against
 * the next circular NOT NULL hardening.
 *
 * Cross-database transactions are still out of scope (would require 2PC).
 * Two independent transactions means interrupted sync is idempotent —
 * running again picks up where it left off.
 */

import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { SYNC_CONFIG, SYNC_TABLE_ORDER, type TableSyncConfig } from './sync/config/syncTables.js';
import { checkSchemaVersions, validateSyncConfig } from './sync/utils/syncValidation.js';
import { loadTombstoneIds, deleteMessagesWithTombstones } from './sync/utils/tombstoneUtils.js';
import {
  loadSyncTombstones,
  flushPendingDeletes,
  pruneSyncTombstones,
  tombstoneKey,
  type PendingDelete,
} from './sync/utils/syncTombstoneUtils.js';
import {
  fetchAllRows,
  resolveVectorSyncColumns,
  VECTOR_SYNC_TABLES,
  buildRowMap,
  compareTimestamps,
  upsertRow,
} from './sync/SyncUpsertBuilder.js';

const logger = createLogger('db-sync');

/**
 * Constraints the flush transaction wants deferred. Must stay in sync with
 * the DEFERRABLE-marking migrations (20260418010642 for the original 4,
 * 20260504065151 for users_default_tts_config_id_fkey, 20260710183055 for
 * the memory_facts supersession self-FK — its pointers are not
 * creation-ordered, so rows upsert in arbitrary order and Postgres validates
 * the chain at COMMIT). Each flush target defers only the subset it reports
 * as deferrable (see resolveDeferrableConstraints).
 */
const SYNC_DEFERRED_CONSTRAINTS = [
  'users_default_persona_id_fkey',
  'users_default_llm_config_id_fkey',
  'users_default_tts_config_id_fkey',
  'personas_owner_id_fkey',
  'llm_configs_owner_id_fkey',
  'memory_facts_superseded_by_id_fkey',
] as const;

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
  stats: Record<
    string,
    { devToProd: number; prodToDev: number; conflicts: number; deleted: number }
  >;
  warnings: string[];
  info: string[];
  changes?: unknown;
}

interface SyncOptions {
  dryRun: boolean;
  /** Proceed despite a migration-version mismatch (soak window override). */
  allowSchemaSkew?: boolean;
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
   * `SET CONSTRAINTS <named-circular-FKs> DEFERRED`, apply all
   * pending writes, COMMIT. Postgres validates the named deferred FKs
   * at COMMIT; either every write commits or none do (per transaction).
   * Named constraints rather than `ALL DEFERRED` so future migrations
   * adding unrelated deferrable constraints don't get silently softened.
   *
   * Not transactional across both databases (cross-DB transactions would
   * require 2-phase commit). Interrupted runs are safe to re-run — the
   * comparison is idempotent and the flush either succeeds fully or
   * rolls back fully.
   */
  async sync(options: SyncOptions): Promise<SyncResult> {
    try {
      logger.info({ dryRun: options.dryRun }, 'Starting database sync');

      await this.devClient.$connect();
      await this.prodClient.$connect();

      const schemaVersion = await checkSchemaVersions(
        this.devClient,
        this.prodClient,
        options.allowSchemaSkew ?? false
      );
      logger.info({ schemaVersion }, 'Schema versions verified');

      const configValidation = await validateSyncConfig(this.devClient, SYNC_CONFIG);

      const stats: Record<
        string,
        { devToProd: number; prodToDev: number; conflicts: number; deleted: number }
      > = {};
      const warnings: string[] = [...configValidation.warnings];
      const info: string[] = [...configValidation.info];

      const tombstoneIds = await loadTombstoneIds(this.devClient, this.prodClient);
      // Generalized deletion ledger (union of both sides, latest wins): a row
      // present on only one side whose tombstone is NEWER than the row gets
      // DELETE-propagated instead of resurrected.
      const syncTombstones = await loadSyncTombstones(this.devClient, this.prodClient);

      // Scan phase — collect pending writes without executing them.
      //
      // Memory tradeoff vs. the old eager-write two-pass pattern: every
      // row that needs syncing lives in memory until the flush. For the
      // current dev-loop usage (single user, modest row counts per table)
      // peak RSS is negligible. If this service is ever driven against a
      // large prod snapshot with tens of thousands of rows, the right
      // fix is to flush per-table inside each transaction rather than
      // accumulating across all tables — but that requires rethinking
      // the cross-table FK order, since partial flushes lose the "every
      // referenced row exists at COMMIT" guarantee that the Ouroboros
      // pattern relies on. Keep it one-shot until the memory pressure
      // is observed.
      const devBoundWrites: PendingWrite[] = [];
      const prodBoundWrites: PendingWrite[] = [];
      const devBoundDeletes: PendingDelete[] = [];
      const prodBoundDeletes: PendingDelete[] = [];

      logger.info('Phase 1: Scanning tables and accumulating pending writes');
      for (const tableName of SYNC_TABLE_ORDER) {
        const config = SYNC_CONFIG[tableName];
        logger.info({ table: tableName }, 'Scanning table');

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

        const tableStats = await this.scanTable(tableName, config, tombstoneIds, {
          devBoundWrites,
          prodBoundWrites,
          devBoundDeletes,
          prodBoundDeletes,
          syncTombstones,
        });
        stats[tableName] = tableStats;

        if (tableStats.conflicts > 0) {
          warnings.push(
            `${tableName}: ${tableStats.conflicts} conflicts resolved using last-write-wins`
          );
        }
        if (tableStats.deleted > 0) {
          info.push(`${tableName}: ${tableStats.deleted} deletion(s) will propagate (tombstoned)`);
        }
      }

      // Flush phase — one transaction per direction, with the four
      // named circular-FK constraints deferred (see flushWrites for the
      // rationale on naming them explicitly) so circular NOT NULL FKs
      // can insert atomically.
      if (!options.dryRun) {
        await this.flushWrites(this.devClient, devBoundWrites, 'dev');
        await this.flushWrites(this.prodClient, prodBoundWrites, 'prod');
        // Propagated deletions run AFTER the upserts, per table in reverse
        // FK order, fail-soft per table (see flushPendingDeletes).
        const devDeletes = await flushPendingDeletes(
          this.devClient,
          devBoundDeletes,
          'dev',
          warnings
        );
        const prodDeletes = await flushPendingDeletes(
          this.prodClient,
          prodBoundDeletes,
          'prod',
          warnings
        );
        reconcileDeletedStats(stats, devDeletes.counts, prodDeletes.counts);
        // Prune ONLY after a fully-clean delete pass: a failed propagation's
        // tombstone must survive past retention or the protected row silently
        // resurrects once the tombstone ages out.
        if (!devDeletes.anyFailed && !prodDeletes.anyFailed) {
          await pruneSyncTombstones(this.devClient, this.prodClient);
        } else {
          warnings.push(
            'sync_tombstones: pruning skipped this run — delete propagation had failures; tombstones retained until a clean pass'
          );
        }
      }

      logger.info({ stats }, 'Sync complete');

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
    logger.info({ label, count: writes.length }, 'Phase 2: Flushing writes');
    // Resolve which of the wanted constraints THIS target can actually defer.
    // A DEFERRABLE-marking migration reaches dev before prod on every release
    // cycle; naming a not-yet-deferrable constraint makes SET CONSTRAINTS
    // throw 42809 and break the whole sync for the soak window. Skew-tolerant
    // instead: defer the intersection, WARN the skips (rows that genuinely
    // need the skipped deferral fail their own FK check with a clear error;
    // everything else syncs normally).
    const deferrable = await this.resolveDeferrableConstraints(client, label);
    await client.$transaction(
      async tx => {
        // Defer exactly the named circular FKs, not ALL deferrable
        // constraints in the transaction — future migrations might add
        // unrelated deferrable constraints (e.g., deferred uniqueness) and
        // we don't want to silently soften those inside the sync.
        if (deferrable.length > 0) {
          await tx.$executeRawUnsafe(
            `SET CONSTRAINTS ${deferrable.map(c => `"${c}"`).join(', ')} DEFERRED`
          );
        }
        for (const w of writes) {
          // `tx` structurally satisfies `SyncExecutor` — both the full
          // PrismaClient and Prisma's transaction client expose
          // `$executeRawUnsafe` / `$queryRawUnsafe` with compatible shapes.
          await upsertRow({
            client: tx,
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
   * Intersect the wanted deferred-constraint list with what THIS database
   * reports as deferrable. During a migration-soak window (a DEFERRABLE
   * migration applied on dev, not yet released to prod) the two sides
   * genuinely differ; the skipped names are WARNed so the degraded deferral
   * is visible, mirroring the vector-table column-intersection philosophy.
   */
  private async resolveDeferrableConstraints(
    client: PrismaClient,
    label: 'dev' | 'prod'
  ): Promise<string[]> {
    const wanted = [...SYNC_DEFERRED_CONSTRAINTS];
    const rows = await client.$queryRawUnsafe<{ constraint_name: string }[]>(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE is_deferrable = 'YES' AND constraint_name IN (${wanted.map((_, i) => `$${i + 1}`).join(', ')})`,
      ...wanted
    );
    const deferrableSet = new Set(rows.map(r => r.constraint_name));
    // Fail open on an EMPTY result: every real database has had most of these
    // deferrable since the original Ouroboros migration, so zero matches means
    // the introspection itself is suspect — use the full list rather than
    // silently dropping all deferral (mirrors resolveVectorSyncColumns).
    if (deferrableSet.size === 0) {
      logger.warn(
        { label },
        'Deferrable-constraint introspection returned nothing — falling back to the full named list'
      );
      return wanted;
    }
    const usable = wanted.filter(c => deferrableSet.has(c));
    const skipped = wanted.filter(c => !deferrableSet.has(c));
    if (skipped.length > 0) {
      logger.warn(
        { label, skipped },
        'Constraints not deferrable on this database — skipping their deferral (expected during a migration-soak window; rows that need it will fail their own FK check instead of breaking the whole sync)'
      );
    }
    return usable;
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
    buckets: {
      devBoundWrites: PendingWrite[];
      prodBoundWrites: PendingWrite[];
      devBoundDeletes: PendingDelete[];
      prodBoundDeletes: PendingDelete[];
      syncTombstones: Map<string, Date>;
    }
  ): Promise<{ devToProd: number; prodToDev: number; conflicts: number; deleted: number }> {
    const { devBoundWrites, prodBoundWrites, devBoundDeletes, prodBoundDeletes, syncTombstones } =
      buckets;
    // Vector tables (memories, memory_facts): resolve the skew-tolerant
    // column set once per run so a migration-soak window (schema ahead on
    // one side) degrades to a WARN + skipped columns instead of breaking
    // the whole sync.
    const resolvedColumns =
      tableName in VECTOR_SYNC_TABLES
        ? await resolveVectorSyncColumns(this.devClient, this.prodClient, tableName)
        : undefined;
    const devRows = await fetchAllRows(this.devClient, tableName, resolvedColumns);
    const prodRows = await fetchAllRows(this.prodClient, tableName, resolvedColumns);

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

    const totals = { devToProd: 0, prodToDev: 0, conflicts: 0, deleted: 0 };

    for (const key of allKeys) {
      if (shouldSkipTombstones && tombstoneIds?.has(key) === true) {
        continue;
      }
      classifyAndQueueRow({
        tableName,
        rowKey: key,
        devRow: devMap.get(key),
        prodRow: prodMap.get(key),
        config,
        writeBase,
        devBoundWrites,
        prodBoundWrites,
        devBoundDeletes,
        prodBoundDeletes,
        syncTombstones,
        totals,
      });
    }

    return totals;
  }
}

/**
 * Overwrite the scan-phase CANDIDATE delete counts with the ACTUAL rows the
 * flush deleted — a partial failure must not report "5 deleted" next to a
 * warning saying it stopped after 3. Only called on non-dry runs: for dryRun
 * no flush happens and the candidate count IS the answer.
 */
function reconcileDeletedStats(
  stats: Record<string, { deleted: number }>,
  devCounts: Record<string, number>,
  prodCounts: Record<string, number>
): void {
  for (const [tableName, tableStat] of Object.entries(stats)) {
    if (tableStat.deleted > 0) {
      tableStat.deleted = (devCounts[tableName] ?? 0) + (prodCounts[tableName] ?? 0);
    }
  }
}

/**
 * A one-sided row is normally copied to the missing side — UNLESS the
 * generalized deletion ledger says the row was deliberately deleted more
 * recently than it was last written. Then the side still HOLDING the row
 * gets a PendingDelete and the copy is skipped (the "delete presets twice"
 * resurrection killer). A row NEWER than its tombstone was re-created after
 * deletion and wins — it syncs normally and the tombstone goes inert. A
 * missing/non-Date timestamp fails SAFE toward preservation (copy, don't
 * delete). Comparison field mirrors compareTimestamps (updatedAt ?? createdAt).
 */
function tombstoneSaysDelete(args: {
  tableName: string;
  rowKey: string;
  row: unknown;
  config: TableSyncConfig;
  syncTombstones: Map<string, Date>;
}): boolean {
  const { tableName, rowKey, row, config, syncTombstones } = args;
  const deletedAt = syncTombstones.get(tombstoneKey(tableName, rowKey));
  if (deletedAt === undefined) {
    return false;
  }
  const field = config.updatedAt ?? config.createdAt;
  if (field === undefined) {
    return false;
  }
  const rowTime = (row as Record<string, unknown>)[field];
  if (!(rowTime instanceof Date)) {
    return false;
  }
  return deletedAt > rowTime;
}

/**
 * Decide which direction a single pk-key's row-pair flows (or neither)
 * and push into the matching bucket. Extracted from `scanTable` to keep
 * that method under sonarjs's cognitive-complexity cap; the five-branch
 * dispatch plus the totals-mutation reads more clearly as a helper.
 */
function classifyAndQueueRow(args: {
  tableName: string;
  rowKey: string;
  devRow: unknown;
  prodRow: unknown;
  config: TableSyncConfig;
  writeBase: Omit<PendingWrite, 'row'>;
  devBoundWrites: PendingWrite[];
  prodBoundWrites: PendingWrite[];
  devBoundDeletes: PendingDelete[];
  prodBoundDeletes: PendingDelete[];
  syncTombstones: Map<string, Date>;
  totals: { devToProd: number; prodToDev: number; conflicts: number; deleted: number };
}): void {
  const {
    tableName,
    rowKey,
    devRow,
    prodRow,
    config,
    writeBase,
    devBoundWrites,
    prodBoundWrites,
    devBoundDeletes,
    prodBoundDeletes,
    syncTombstones,
    totals,
  } = args;

  if (devRow === undefined && prodRow !== undefined) {
    if (tombstoneSaysDelete({ tableName, rowKey, row: prodRow, config, syncTombstones })) {
      prodBoundDeletes.push({ tableName, rowKey });
      totals.deleted += 1;
      return;
    }
    devBoundWrites.push({ ...writeBase, row: prodRow });
    totals.prodToDev += 1;
    return;
  }
  if (devRow !== undefined && prodRow === undefined) {
    if (tombstoneSaysDelete({ tableName, rowKey, row: devRow, config, syncTombstones })) {
      devBoundDeletes.push({ tableName, rowKey });
      totals.deleted += 1;
      return;
    }
    prodBoundWrites.push({ ...writeBase, row: devRow });
    totals.devToProd += 1;
    return;
  }
  // No "both undefined" guard: allKeys is built from union of both row
  // maps' keys, so at least one side is always defined per iteration.

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
