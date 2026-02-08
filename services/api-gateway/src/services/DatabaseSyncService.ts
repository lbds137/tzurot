/**
 * Database Sync Service
 * Performs bidirectional synchronization between dev and prod databases
 * using last-write-wins strategy based on timestamps
 */

import { type PrismaClient } from '@tzurot/common-types';
import { createLogger } from '@tzurot/common-types';
import { SYNC_CONFIG, SYNC_TABLE_ORDER } from './sync/config/syncTables.js';
import { checkSchemaVersions, validateSyncConfig } from './sync/utils/syncValidation.js';
import { loadTombstoneIds, deleteMessagesWithTombstones } from './sync/utils/tombstoneUtils.js';
import {
  prepareLlmConfigSingletonFlags,
  finalizeLlmConfigSingletonFlags,
} from './sync/utils/llmConfigSingletons.js';
import { ForeignKeyReconciler } from './sync/ForeignKeyReconciler.js';
import {
  fetchAllRows,
  buildRowMap,
  compareTimestamps,
  upsertRow,
  type UpsertRowOptions,
} from './sync/SyncUpsertBuilder.js';

const logger = createLogger('db-sync');

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

export class DatabaseSyncService {
  constructor(
    private devClient: PrismaClient,
    private prodClient: PrismaClient
  ) {}

  /**
   * Perform bidirectional database synchronization
   *
   * Uses a two-pass approach to handle circular FK dependencies:
   * 1. First pass: Sync all tables, but defer circular FK columns (set to NULL)
   * 2. Second pass: Update deferred FK columns now that referenced rows exist
   *
   * Note: This operation is NOT transactional across both databases (cross-database
   * transactions would require 2-phase commit). However, the operation is IDEMPOTENT -
   * if interrupted, running sync again will complete any partial sync.
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity -- inherently complex sync logic
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

      const tablesWithDeferredFks: {
        tableName: string;
        config: (typeof SYNC_CONFIG)[keyof typeof SYNC_CONFIG];
      }[] = [];

      const tombstoneIds = await loadTombstoneIds(this.devClient, this.prodClient);

      // PASS 1: Sync each table in FK-dependency order
      logger.info('[Sync] Pass 1: Syncing tables with deferred FK columns');
      for (const tableName of SYNC_TABLE_ORDER) {
        const config = SYNC_CONFIG[tableName];
        logger.info({ table: tableName }, '[Sync] Syncing table');

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

        const tableStats = await this.syncTable(tableName, config, options.dryRun, tombstoneIds);
        stats[tableName] = tableStats;

        if (tableStats.conflicts > 0) {
          warnings.push(
            `${tableName}: ${tableStats.conflicts} conflicts resolved using last-write-wins`
          );
        }

        if (config.deferredFkColumns && config.deferredFkColumns.length > 0) {
          tablesWithDeferredFks.push({ tableName, config });
        }
      }

      if (!options.dryRun) {
        await finalizeLlmConfigSingletonFlags(this.devClient, this.prodClient);
      }

      // PASS 2: Update deferred FK columns now that all referenced rows exist
      if (tablesWithDeferredFks.length > 0 && !options.dryRun) {
        logger.info(
          { tables: tablesWithDeferredFks.map(t => t.tableName) },
          '[Sync] Pass 2: Updating deferred FK columns'
        );

        const reconciler = new ForeignKeyReconciler(this.devClient, this.prodClient);
        for (const { tableName, config } of tablesWithDeferredFks) {
          await reconciler.reconcile(
            tableName,
            config,
            fetchAllRows,
            buildRowMap,
            compareTimestamps
          );
        }
      }

      logger.info({ stats }, '[Sync] Sync complete');

      return { schemaVersion, stats, warnings, info };
    } finally {
      await this.devClient.$disconnect();
      await this.prodClient.$disconnect();
    }
  }

  /**
   * Sync a single table using last-write-wins strategy
   */
  private async syncTable(
    tableName: string,
    config: (typeof SYNC_CONFIG)[keyof typeof SYNC_CONFIG],
    dryRun: boolean,
    tombstoneIds?: Set<string>
  ): Promise<{ devToProd: number; prodToDev: number; conflicts: number }> {
    const devRows = await fetchAllRows(this.devClient, tableName);
    const prodRows = await fetchAllRows(this.prodClient, tableName);

    const devMap = buildRowMap(devRows, config.pk);
    const prodMap = buildRowMap(prodRows, config.pk);

    const allKeys = new Set([...devMap.keys(), ...prodMap.keys()]);
    const shouldSkipTombstones = tableName === 'conversation_history' && tombstoneIds !== undefined;

    const upsertOptions = {
      tableName,
      pkField: config.pk,
      uuidColumns: config.uuidColumns,
      timestampColumns: config.timestampColumns ?? [],
      deferredFkColumns: config.deferredFkColumns ?? [],
      excludeColumns: config.excludeColumns ?? [],
    };

    let devToProd = 0;
    let prodToDev = 0;
    let conflicts = 0;

    for (const key of allKeys) {
      if (shouldSkipTombstones && tombstoneIds?.has(key) === true) {
        continue;
      }

      const result = await this.syncRow(
        devMap.get(key),
        prodMap.get(key),
        config,
        dryRun,
        upsertOptions
      );

      devToProd += result.devToProd;
      prodToDev += result.prodToDev;
      conflicts += result.conflicts;
    }

    return { devToProd, prodToDev, conflicts };
  }

  /**
   * Sync a single row between dev and prod databases
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity -- conditional sync logic
  private async syncRow(
    devRow: unknown,
    prodRow: unknown,
    config: (typeof SYNC_CONFIG)[keyof typeof SYNC_CONFIG],
    dryRun: boolean,
    upsertOptions: Omit<UpsertRowOptions, 'client' | 'row'>
  ): Promise<{ devToProd: number; prodToDev: number; conflicts: number }> {
    if (devRow === undefined && prodRow !== undefined) {
      if (!dryRun) {
        await upsertRow({ client: this.devClient, row: prodRow, ...upsertOptions });
      }
      return { devToProd: 0, prodToDev: 1, conflicts: 0 };
    }

    if (devRow !== undefined && prodRow === undefined) {
      if (!dryRun) {
        await upsertRow({ client: this.prodClient, row: devRow, ...upsertOptions });
      }
      return { devToProd: 1, prodToDev: 0, conflicts: 0 };
    }

    if (devRow !== undefined && prodRow !== undefined) {
      const comparison = compareTimestamps(devRow, prodRow, config);

      if (comparison === 'dev-newer') {
        if (!dryRun) {
          await upsertRow({ client: this.prodClient, row: devRow, ...upsertOptions });
        }
        return { devToProd: 1, prodToDev: 0, conflicts: 1 };
      }

      if (comparison === 'prod-newer') {
        if (!dryRun) {
          await upsertRow({ client: this.devClient, row: prodRow, ...upsertOptions });
        }
        return { devToProd: 0, prodToDev: 1, conflicts: 1 };
      }
    }

    return { devToProd: 0, prodToDev: 0, conflicts: 0 };
  }
}
