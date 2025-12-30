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
import { prepareLlmConfigSingletonFlags } from './sync/utils/llmConfigSingletons.js';
import { ForeignKeyReconciler } from './sync/ForeignKeyReconciler.js';

const logger = createLogger('db-sync');

interface SyncResult {
  schemaVersion: string;
  stats: Record<string, { devToProd: number; prodToDev: number; conflicts: number }>;
  warnings: string[];
  changes?: unknown;
}

interface SyncOptions {
  dryRun: boolean;
}

/**
 * Options for upserting a row during sync
 *
 * @example
 * // Basic upsert with UUID columns
 * await upsertRow({
 *   client: devClient,
 *   tableName: 'users',
 *   row: userData,
 *   pkField: 'id',
 *   uuidColumns: ['id'],
 * });
 *
 * @example
 * // Handling circular FK with deferredFkColumns
 * // Pass 1: Insert user, defer self-referencing FK
 * await upsertRow({
 *   client: devClient,
 *   tableName: 'users',
 *   row: userData,
 *   pkField: 'id',
 *   uuidColumns: ['id', 'referred_by'],
 *   deferredFkColumns: ['referred_by'], // Circular FK to users.id, set NULL in pass 1
 * });
 * // Pass 2: Update deferred FK after all users exist
 */
interface UpsertRowOptions {
  /** Prisma client to use */
  client: PrismaClient;
  /** Table name */
  tableName: string;
  /** Row data to upsert */
  row: unknown;
  /** Primary key field(s) */
  pkField: string | readonly string[];
  /** Columns that are UUID type (need ::uuid cast) */
  uuidColumns?: readonly string[];
  /** Columns that are timestamp type (need ::timestamptz cast) */
  timestampColumns?: readonly string[];
  /**
   * FK columns to defer to pass 2 (set to NULL in pass 1).
   * Use for circular foreign keys that reference rows not yet inserted.
   */
  deferredFkColumns?: readonly string[];
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
   * if interrupted, running sync again will complete any partial sync. Each individual
   * upsert is atomic within its database.
   */
  async sync(options: SyncOptions): Promise<SyncResult> {
    try {
      logger.info({ dryRun: options.dryRun }, '[Sync] Starting database sync');

      // Connect to both databases
      await this.devClient.$connect();
      await this.prodClient.$connect();

      // Check schema versions match
      const schemaVersion = await checkSchemaVersions(this.devClient, this.prodClient);
      logger.info({ schemaVersion }, '[Sync] Schema versions verified');

      // Validate SYNC_CONFIG matches actual schema
      const configWarnings = await validateSyncConfig(this.devClient, SYNC_CONFIG);

      const stats: Record<string, { devToProd: number; prodToDev: number; conflicts: number }> = {};
      const warnings: string[] = [...configWarnings];

      // Track tables with deferred FK columns for second pass
      const tablesWithDeferredFks: {
        tableName: string;
        config: (typeof SYNC_CONFIG)[keyof typeof SYNC_CONFIG];
      }[] = [];

      // Load tombstone IDs once for conversation_history sync
      const tombstoneIds = await loadTombstoneIds(this.devClient, this.prodClient);

      // PASS 1: Sync each table in FK-dependency order (with deferred FKs set to NULL)
      logger.info('[Sync] Pass 1: Syncing tables with deferred FK columns');
      for (const tableName of SYNC_TABLE_ORDER) {
        const config = SYNC_CONFIG[tableName];
        logger.info({ table: tableName }, '[Sync] Syncing table');

        // Special handling for llm_configs: resolve singleton flags before syncing
        if (tableName === 'llm_configs' && !options.dryRun) {
          await prepareLlmConfigSingletonFlags(this.devClient, this.prodClient);
        }

        // Special handling for conversation_history: respect tombstones
        // First delete any messages that have tombstones, then sync normally
        // (tombstones are synced BEFORE conversation_history in SYNC_TABLE_ORDER)
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

        // Track tables with deferred FK columns for pass 2
        if (config.deferredFkColumns && config.deferredFkColumns.length > 0) {
          tablesWithDeferredFks.push({ tableName, config });
        }
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
            this.fetchAllRows.bind(this),
            this.buildRowMap.bind(this),
            this.compareTimestamps.bind(this)
          );
        }
      }

      logger.info({ stats }, '[Sync] Sync complete');

      return {
        schemaVersion,
        stats,
        warnings,
      };
    } finally {
      await this.devClient.$disconnect();
      await this.prodClient.$disconnect();
    }
  }

  /**
   * Sync a single table using last-write-wins strategy
   *
   * @param tombstoneIds - Set of message IDs that have been hard-deleted.
   *                       For conversation_history, rows with these IDs are skipped.
   */
  private async syncTable(
    tableName: string,
    config: (typeof SYNC_CONFIG)[keyof typeof SYNC_CONFIG],
    dryRun: boolean,
    tombstoneIds?: Set<string>
  ): Promise<{ devToProd: number; prodToDev: number; conflicts: number }> {
    // Fetch all rows from both databases
    const devRows = await this.fetchAllRows(this.devClient, tableName);
    const prodRows = await this.fetchAllRows(this.prodClient, tableName);

    let devToProd = 0;
    let prodToDev = 0;
    let conflicts = 0;

    // Build maps by primary key for efficient lookup
    const devMap = this.buildRowMap(devRows, config.pk);
    const prodMap = this.buildRowMap(prodRows, config.pk);

    // Get deferred FK columns (will be set to NULL in pass 1, updated in pass 2)
    const deferredFkColumns = config.deferredFkColumns ?? [];

    // Find rows that need syncing
    const allKeys = new Set([...devMap.keys(), ...prodMap.keys()]);

    // For conversation_history, skip rows that have tombstones (already deleted)
    const shouldSkipTombstones = tableName === 'conversation_history' && tombstoneIds !== undefined;

    for (const key of allKeys) {
      // Skip messages that have been hard-deleted (tombstoned)
      if (shouldSkipTombstones && tombstoneIds?.has(key) === true) {
        continue;
      }

      const devRow = devMap.get(key);
      const prodRow = prodMap.get(key);

      if (devRow === undefined && prodRow !== undefined) {
        // Row only in prod - copy to dev
        if (!dryRun) {
          await this.upsertRow({
            client: this.devClient,
            tableName,
            row: prodRow,
            pkField: config.pk,
            uuidColumns: config.uuidColumns,
            timestampColumns: config.timestampColumns ?? [],
            deferredFkColumns,
          });
        }
        prodToDev++;
      } else if (devRow !== undefined && prodRow === undefined) {
        // Row only in dev - copy to prod
        if (!dryRun) {
          await this.upsertRow({
            client: this.prodClient,
            tableName,
            row: devRow,
            pkField: config.pk,
            uuidColumns: config.uuidColumns,
            timestampColumns: config.timestampColumns ?? [],
            deferredFkColumns,
          });
        }
        devToProd++;
      } else if (devRow !== undefined && prodRow !== undefined) {
        // Row in both - check timestamps
        const comparison = this.compareTimestamps(devRow, prodRow, config);

        if (comparison === 'dev-newer') {
          if (!dryRun) {
            await this.upsertRow({
              client: this.prodClient,
              tableName,
              row: devRow,
              pkField: config.pk,
              uuidColumns: config.uuidColumns,
              timestampColumns: config.timestampColumns ?? [],
              deferredFkColumns,
            });
          }
          devToProd++;
          conflicts++;
        } else if (comparison === 'prod-newer') {
          if (!dryRun) {
            await this.upsertRow({
              client: this.devClient,
              tableName,
              row: prodRow,
              pkField: config.pk,
              uuidColumns: config.uuidColumns,
              timestampColumns: config.timestampColumns ?? [],
              deferredFkColumns,
            });
          }
          prodToDev++;
          conflicts++;
        }
        // If 'same', no action needed
      }
    }

    return { devToProd, prodToDev, conflicts };
  }

  /**
   * Fetch all rows from a table using raw SQL
   */
  private async fetchAllRows(client: PrismaClient, tableName: string): Promise<unknown[]> {
    // Special handling for memories table - cast vector to text for Prisma deserialization
    if (tableName === 'memories') {
      const rows = await client.$queryRawUnsafe(`
        SELECT
          id, persona_id, personality_id, source_system, content,
          embedding::text as embedding,
          session_id, canon_scope, summary_type, channel_id, guild_id,
          message_ids, senders, created_at, legacy_shapes_user_id
        FROM "memories"
      `);
      return Array.isArray(rows) ? (rows as unknown[]) : [];
    }

    // Default: fetch all columns
    const rows = await client.$queryRawUnsafe(`SELECT * FROM "${tableName}"`);
    return Array.isArray(rows) ? (rows as unknown[]) : [];
  }

  /**
   * Build a map of rows keyed by primary key(s)
   */
  private buildRowMap(rows: unknown[], pkField: string | readonly string[]): Map<string, unknown> {
    const map = new Map<string, unknown>();

    for (const row of rows) {
      const key = this.getPrimaryKey(row, pkField);
      map.set(key, row);
    }

    return map;
  }

  /**
   * Get primary key value(s) as a string
   */
  private getPrimaryKey(row: unknown, pkField: string | readonly string[]): string {
    if (typeof row !== 'object' || row === null) {
      throw new Error('Row is not an object');
    }

    const rowObj = row as Record<string, unknown>;

    if (typeof pkField === 'string') {
      // Single key
      return String(rowObj[pkField]);
    } else {
      // Composite key
      return pkField.map(f => String(rowObj[f])).join('|');
    }
  }

  /**
   * Compare timestamps to determine which row is newer
   */
  private compareTimestamps(
    devRow: unknown,
    prodRow: unknown,
    config: (typeof SYNC_CONFIG)[keyof typeof SYNC_CONFIG]
  ): 'dev-newer' | 'prod-newer' | 'same' {
    const devObj = devRow as Record<string, unknown>;
    const prodObj = prodRow as Record<string, unknown>;

    // Use updatedAt if available, otherwise createdAt
    const timestampField = 'updatedAt' in config ? config.updatedAt : config.createdAt;

    if (timestampField === undefined) {
      // No timestamp field - consider them the same (shouldn't happen with our schema)
      return 'same';
    }

    const devTime = devObj[timestampField];
    const prodTime = prodObj[timestampField];

    if (!(devTime instanceof Date) || !(prodTime instanceof Date)) {
      logger.warn({ devTime, prodTime }, '[Sync] Non-date timestamps detected');
      return 'same';
    }

    const devTimestamp = devTime.getTime();
    const prodTimestamp = prodTime.getTime();

    if (devTimestamp > prodTimestamp) {
      return 'dev-newer';
    } else if (prodTimestamp > devTimestamp) {
      return 'prod-newer';
    } else {
      return 'same';
    }
  }

  /**
   * Upsert a row into a table using raw SQL
   */
  private async upsertRow(options: UpsertRowOptions): Promise<void> {
    const {
      client,
      tableName,
      row,
      pkField,
      uuidColumns = [],
      timestampColumns = [],
      deferredFkColumns = [],
    } = options;

    if (typeof row !== 'object' || row === null) {
      throw new Error('Row is not an object');
    }

    const rowObj = row as Record<string, unknown>;

    // Build column names and values
    const columns = Object.keys(rowObj);
    const values = Object.values(rowObj).map((val, i) => {
      const col = columns[i];
      // Set deferred FK columns to NULL (will be updated in pass 2)
      if (deferredFkColumns.includes(col)) {
        return null;
      }
      // Convert Date objects to ISO strings for timestamp columns
      if (timestampColumns.includes(col) && val instanceof Date) {
        return val.toISOString();
      }
      return val;
    });

    // Build parameterized query with type casting where needed
    const placeholders = columns
      .map((col, i) => {
        const placeholder = `$${i + 1}`;
        // Cast to vector for embedding column in memories table
        if (tableName === 'memories' && col === 'embedding') {
          return `${placeholder}::vector`;
        }
        // Cast to UUID if this column is a UUID type
        if (uuidColumns.includes(col)) {
          return `${placeholder}::uuid`;
        }
        // Cast to timestamptz if this column is a timestamp type
        if (timestampColumns.includes(col)) {
          return `${placeholder}::timestamptz`;
        }
        return placeholder;
      })
      .join(', ');
    const columnList = columns.map(c => `"${c}"`).join(', ');

    // Build UPDATE SET clause for conflict resolution
    // Exclude deferred FK columns from UPDATE (they'll be updated in pass 2)
    const updateColumns = columns.filter(c => !deferredFkColumns.includes(c));
    const updateSet = updateColumns.map(c => `"${c}" = EXCLUDED."${c}"`).join(', ');

    // Determine conflict columns (primary key only)
    const pkColumns = typeof pkField === 'string' ? [pkField] : Array.from(pkField);
    const conflictColumns = pkColumns.map(c => `"${c}"`).join(', ');

    const query = `
      INSERT INTO "${tableName}" (${columnList})
      VALUES (${placeholders})
      ON CONFLICT (${conflictColumns})
      DO UPDATE SET ${updateSet}
    `;

    await client.$executeRawUnsafe(query, ...values);
  }
}
