/**
 * Database Sync Service
 * Performs bidirectional synchronization between dev and prod databases
 * using last-write-wins strategy based on timestamps
 */

import { type PrismaClient } from '@tzurot/common-types';
import { createLogger } from '@tzurot/common-types';
import { SYNC_CONFIG } from './sync/config/syncTables.js';
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

      // Sync each table
      for (const [tableName, config] of Object.entries(SYNC_CONFIG)) {
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
            config.timestampColumns ?? []
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
            config.timestampColumns ?? []
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
              config.timestampColumns ?? []
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
              config.timestampColumns ?? []
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
   */
  private async upsertRow(
    client: PrismaClient,
    tableName: string,
    row: unknown,
    pkField: string | readonly string[],
    uuidColumns: readonly string[] = [],
    timestampColumns: readonly string[] = []
  ): Promise<void> {
    if (typeof row !== 'object' || row === null) {
      throw new Error('Row is not an object');
    }

    const rowObj = row as Record<string, unknown>;

    // Build column names and values
    const columns = Object.keys(rowObj);
    const values = Object.values(rowObj).map((val, i) => {
      const col = columns[i];
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
    const updateSet = columns.map(c => `"${c}" = EXCLUDED."${c}"`).join(', ');

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
