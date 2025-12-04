/**
 * Database Sync Service
 * Performs bidirectional synchronization between dev and prod databases
 * using last-write-wins strategy based on timestamps
 */

import { type PrismaClient } from '@tzurot/common-types';
import { createLogger } from '@tzurot/common-types';
import { SYNC_CONFIG, SYNC_TABLE_ORDER } from './sync/config/syncTables.js';
import { checkSchemaVersions, validateSyncConfig } from './sync/utils/syncValidation.js';

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

      // PASS 1: Sync each table in FK-dependency order (with deferred FKs set to NULL)
      logger.info('[Sync] Pass 1: Syncing tables with deferred FK columns');
      for (const tableName of SYNC_TABLE_ORDER) {
        const config = SYNC_CONFIG[tableName];
        logger.info({ table: tableName }, '[Sync] Syncing table');

        // Special handling for llm_configs: resolve singleton flags before syncing
        if (tableName === 'llm_configs' && !options.dryRun) {
          await this.prepareLlmConfigSingletonFlags();
        }

        const tableStats = await this.syncTable(tableName, config, options.dryRun);

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

        for (const { tableName, config } of tablesWithDeferredFks) {
          await this.updateDeferredFkColumns(tableName, config);
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
   */
  private async syncTable(
    tableName: string,
    config: (typeof SYNC_CONFIG)[keyof typeof SYNC_CONFIG],
    dryRun: boolean
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

    for (const key of allKeys) {
      const devRow = devMap.get(key);
      const prodRow = prodMap.get(key);

      if (devRow === undefined && prodRow !== undefined) {
        // Row only in prod - copy to dev
        if (!dryRun) {
          await this.upsertRow(
            this.devClient,
            tableName,
            prodRow,
            config.pk,
            config.uuidColumns,
            config.timestampColumns ?? [],
            deferredFkColumns
          );
        }
        prodToDev++;
      } else if (devRow !== undefined && prodRow === undefined) {
        // Row only in dev - copy to prod
        if (!dryRun) {
          await this.upsertRow(
            this.prodClient,
            tableName,
            devRow,
            config.pk,
            config.uuidColumns,
            config.timestampColumns ?? [],
            deferredFkColumns
          );
        }
        devToProd++;
      } else if (devRow !== undefined && prodRow !== undefined) {
        // Row in both - check timestamps
        const comparison = this.compareTimestamps(devRow, prodRow, config);

        if (comparison === 'dev-newer') {
          if (!dryRun) {
            await this.upsertRow(
              this.prodClient,
              tableName,
              devRow,
              config.pk,
              config.uuidColumns,
              config.timestampColumns ?? [],
              deferredFkColumns
            );
          }
          devToProd++;
          conflicts++;
        } else if (comparison === 'prod-newer') {
          if (!dryRun) {
            await this.upsertRow(
              this.devClient,
              tableName,
              prodRow,
              config.pk,
              config.uuidColumns,
              config.timestampColumns ?? [],
              deferredFkColumns
            );
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
   * Prepare llm_configs singleton flags before syncing
   *
   * The llm_configs table has partial unique indexes that only allow one row
   * with is_default=true and one row with is_free_default=true. Before syncing,
   * we need to resolve conflicts by using the most recently updated value.
   */
  private async prepareLlmConfigSingletonFlags(): Promise<void> {
    interface LlmConfigFlags {
      id: string;
      is_default: boolean;
      is_free_default: boolean;
      updated_at: Date;
    }

    // Fetch llm_configs with singleton flags from both databases
    const devConfigs = await this.devClient.$queryRawUnsafe<LlmConfigFlags[]>(`
      SELECT id, is_default, is_free_default, updated_at
      FROM llm_configs
      WHERE is_default = true OR is_free_default = true
    `);

    const prodConfigs = await this.prodClient.$queryRawUnsafe<LlmConfigFlags[]>(`
      SELECT id, is_default, is_free_default, updated_at
      FROM llm_configs
      WHERE is_default = true OR is_free_default = true
    `);

    // Handle is_default singleton
    await this.resolveSingletonFlag(devConfigs, prodConfigs, 'is_default');

    // Handle is_free_default singleton
    await this.resolveSingletonFlag(devConfigs, prodConfigs, 'is_free_default');
  }

  /**
   * Resolve a singleton boolean flag between dev and prod
   * Clears the flag on the "losing" config (older updated_at)
   */
  private async resolveSingletonFlag(
    devConfigs: { id: string; is_default: boolean; is_free_default: boolean; updated_at: Date }[],
    prodConfigs: { id: string; is_default: boolean; is_free_default: boolean; updated_at: Date }[],
    flagName: 'is_default' | 'is_free_default'
  ): Promise<void> {
    const devWithFlag = devConfigs.find(c => c[flagName]);
    const prodWithFlag = prodConfigs.find(c => c[flagName]);

    // No conflict if only one database has the flag set
    if (!devWithFlag || !prodWithFlag) {
      return;
    }

    // Same config has the flag in both - no conflict
    if (devWithFlag.id === prodWithFlag.id) {
      return;
    }

    // Different configs have the flag - resolve using updated_at
    const devTime = new Date(devWithFlag.updated_at).getTime();
    const prodTime = new Date(prodWithFlag.updated_at).getTime();

    logger.info(
      {
        flagName,
        devConfigId: devWithFlag.id,
        devUpdatedAt: devWithFlag.updated_at,
        prodConfigId: prodWithFlag.id,
        prodUpdatedAt: prodWithFlag.updated_at,
        winner: devTime >= prodTime ? 'dev' : 'prod',
      },
      '[Sync] Resolving llm_configs singleton flag conflict'
    );

    if (devTime >= prodTime) {
      // Dev wins - clear the flag in prod (so dev's config can be synced)
      await this.prodClient.$executeRawUnsafe(
        `UPDATE llm_configs SET ${flagName} = false, updated_at = NOW() WHERE id = $1::uuid`,
        prodWithFlag.id
      );
    } else {
      // Prod wins - clear the flag in dev (so prod's config can be synced)
      await this.devClient.$executeRawUnsafe(
        `UPDATE llm_configs SET ${flagName} = false, updated_at = NOW() WHERE id = $1::uuid`,
        devWithFlag.id
      );
    }
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
   *
   * @param deferredFkColumns - FK columns to set to NULL during pass 1 (will be updated in pass 2)
   */
  private async upsertRow(
    client: PrismaClient,
    tableName: string,
    row: unknown,
    pkField: string | readonly string[],
    uuidColumns: readonly string[] = [],
    timestampColumns: readonly string[] = [],
    deferredFkColumns: readonly string[] = []
  ): Promise<void> {
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

  /**
   * Update deferred FK columns after all tables have been synced (pass 2)
   *
   * This handles circular FK dependencies by updating FK columns that were
   * set to NULL during pass 1, now that the referenced rows exist.
   */
  private async updateDeferredFkColumns(
    tableName: string,
    config: (typeof SYNC_CONFIG)[keyof typeof SYNC_CONFIG]
  ): Promise<void> {
    const deferredFkColumns = config.deferredFkColumns ?? [];
    if (deferredFkColumns.length === 0) {
      return;
    }

    logger.info(
      { table: tableName, columns: deferredFkColumns },
      '[Sync] Updating deferred FK columns'
    );

    // Fetch all rows from both databases
    const devRows = await this.fetchAllRows(this.devClient, tableName);
    const prodRows = await this.fetchAllRows(this.prodClient, tableName);

    // Build maps by primary key
    const devMap = this.buildRowMap(devRows, config.pk);
    const prodMap = this.buildRowMap(prodRows, config.pk);

    // Get primary key column(s)
    const pkColumns = typeof config.pk === 'string' ? [config.pk] : Array.from(config.pk);

    // Update deferred FK columns in both directions using last-write-wins
    for (const [key, devRow] of devMap) {
      const prodRow = prodMap.get(key);
      if (prodRow === undefined) {
        continue; // Row doesn't exist in prod yet
      }

      const devObj = devRow as Record<string, unknown>;
      const prodObj = prodRow as Record<string, unknown>;

      // Determine which version is newer
      const comparison = this.compareTimestamps(devRow, prodRow, config);

      // Update deferred FK columns based on which side is newer
      for (const fkColumn of deferredFkColumns) {
        const devValue = devObj[fkColumn];
        const prodValue = prodObj[fkColumn];

        // Skip if both have the same value
        if (devValue === prodValue) {
          continue;
        }

        // Get PK values for WHERE clause
        const pkValues = pkColumns.map(col => devObj[col]);

        if (comparison === 'dev-newer' || comparison === 'same') {
          // Update prod with dev's FK value
          if (devValue !== null && devValue !== undefined) {
            await this.updateFkColumn(
              this.prodClient,
              tableName,
              fkColumn,
              devValue as string,
              pkColumns,
              pkValues
            );
          }
        }

        if (comparison === 'prod-newer' || comparison === 'same') {
          // Update dev with prod's FK value
          if (prodValue !== null && prodValue !== undefined) {
            await this.updateFkColumn(
              this.devClient,
              tableName,
              fkColumn,
              prodValue as string,
              pkColumns,
              pkValues
            );
          }
        }
      }
    }

    // Also handle rows that only exist in prod (copy their FK values to dev)
    for (const [key, prodRow] of prodMap) {
      if (devMap.has(key)) {
        continue; // Already handled above
      }

      const prodObj = prodRow as Record<string, unknown>;
      const pkValues = pkColumns.map(col => prodObj[col]);

      for (const fkColumn of deferredFkColumns) {
        const prodValue = prodObj[fkColumn];
        if (prodValue !== null && prodValue !== undefined) {
          await this.updateFkColumn(
            this.devClient,
            tableName,
            fkColumn,
            prodValue as string,
            pkColumns,
            pkValues
          );
        }
      }
    }

    // Handle rows that only exist in dev (copy their FK values to prod)
    for (const [key, devRow] of devMap) {
      if (prodMap.has(key)) {
        continue; // Already handled above
      }

      const devObj = devRow as Record<string, unknown>;
      const pkValues = pkColumns.map(col => devObj[col]);

      for (const fkColumn of deferredFkColumns) {
        const devValue = devObj[fkColumn];
        if (devValue !== null && devValue !== undefined) {
          await this.updateFkColumn(
            this.prodClient,
            tableName,
            fkColumn,
            devValue as string,
            pkColumns,
            pkValues
          );
        }
      }
    }
  }

  /**
   * Update a single FK column for a specific row
   */
  private async updateFkColumn(
    client: PrismaClient,
    tableName: string,
    fkColumn: string,
    value: string,
    pkColumns: string[],
    pkValues: unknown[]
  ): Promise<void> {
    // Build WHERE clause for primary key
    const whereClause = pkColumns.map((col, i) => `"${col}" = $${i + 2}::uuid`).join(' AND ');

    const query = `
      UPDATE "${tableName}"
      SET "${fkColumn}" = $1::uuid
      WHERE ${whereClause}
    `;

    await client.$executeRawUnsafe(query, value, ...pkValues);
  }
}
