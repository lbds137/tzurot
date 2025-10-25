/**
 * Database Sync Service
 * Performs bidirectional synchronization between dev and prod databases
 * using last-write-wins strategy based on timestamps
 */

import { PrismaClient } from '@prisma/client';
import { createLogger } from '@tzurot/common-types';

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
 * Tables to sync with their primary key field(s), timestamp fields, and UUID columns
 */
const SYNC_CONFIG = {
  users: {
    pk: 'id',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    uuidColumns: ['id', 'globalPersonaId'],
  },
  personas: {
    pk: 'id',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    uuidColumns: ['id', 'systemPromptId', 'llmConfigId'],
  },
  user_default_personas: {
    pk: 'userId',
    updatedAt: 'updatedAt',
    uuidColumns: ['userId', 'personaId'],
  },
  system_prompts: {
    pk: 'id',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    uuidColumns: ['id'],
  },
  llm_configs: {
    pk: 'id',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    uuidColumns: ['id'],
  },
  personalities: {
    pk: 'id',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    uuidColumns: ['id', 'systemPromptId', 'llmConfigId', 'personaId'],
  },
  personality_default_configs: {
    pk: 'personalityId',
    updatedAt: 'updatedAt',
    uuidColumns: ['personalityId', 'systemPromptId', 'llmConfigId', 'personaId'],
  },
  personality_owners: {
    pk: ['personalityId', 'userId'], // Composite key
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    uuidColumns: ['personalityId', 'userId'],
  },
  user_personality_configs: {
    pk: 'id',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    uuidColumns: ['id', 'userId', 'personalityId', 'systemPromptId', 'llmConfigId'],
  },
  conversation_history: {
    pk: 'id',
    createdAt: 'createdAt',
    // No updatedAt - append-only
    uuidColumns: ['id', 'userId', 'personalityId'],
  },
  activated_channels: {
    pk: 'id',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    uuidColumns: ['id', 'personalityId'],
  },
  // Skip pending_memories - transient queue data
} as const;

export class DatabaseSyncService {
  private devClient: PrismaClient;
  private prodClient: PrismaClient;

  constructor(devDatabaseUrl: string, prodDatabaseUrl: string) {
    this.devClient = new PrismaClient({
      datasources: {
        db: { url: devDatabaseUrl },
      },
    });

    this.prodClient = new PrismaClient({
      datasources: {
        db: { url: prodDatabaseUrl },
      },
    });
  }

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
      const schemaVersion = await this.checkSchemaVersions();
      logger.info({ schemaVersion }, '[Sync] Schema versions verified');

      const stats: Record<string, { devToProd: number; prodToDev: number; conflicts: number }> = {};
      const warnings: string[] = [];

      // Sync each table
      for (const [tableName, config] of Object.entries(SYNC_CONFIG)) {
        logger.info({ table: tableName }, '[Sync] Syncing table');

        const tableStats = await this.syncTable(
          tableName,
          config,
          options.dryRun
        );

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
   * Verify both databases are on the same schema version
   */
  private async checkSchemaVersions(): Promise<string> {
    const devMigrations = await this.devClient.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1
    `;

    const prodMigrations = await this.prodClient.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1
    `;

    const devVersion = devMigrations[0]?.migration_name;
    const prodVersion = prodMigrations[0]?.migration_name;

    if (!devVersion || !prodVersion) {
      throw new Error('Could not determine schema versions from migrations table');
    }

    if (devVersion !== prodVersion) {
      throw new Error(
        `Schema version mismatch!\n` +
        `Dev: ${devVersion}\n` +
        `Prod: ${prodVersion}\n\n` +
        `Both databases must be on the same schema version before syncing.`
      );
    }

    return devVersion;
  }

  /**
   * Sync a single table using last-write-wins strategy
   */
  private async syncTable(
    tableName: string,
    config: typeof SYNC_CONFIG[keyof typeof SYNC_CONFIG],
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

      if (!devRow && prodRow) {
        // Row only in prod - copy to dev
        if (!dryRun) {
          await this.upsertRow(this.devClient, tableName, prodRow, config.pk, config.uuidColumns);
        }
        prodToDev++;
      } else if (devRow && !prodRow) {
        // Row only in dev - copy to prod
        if (!dryRun) {
          await this.upsertRow(this.prodClient, tableName, devRow, config.pk, config.uuidColumns);
        }
        devToProd++;
      } else if (devRow && prodRow) {
        // Row in both - check timestamps
        const comparison = this.compareTimestamps(devRow, prodRow, config);

        if (comparison === 'dev-newer') {
          if (!dryRun) {
            await this.upsertRow(this.prodClient, tableName, devRow, config.pk, config.uuidColumns);
          }
          devToProd++;
          conflicts++;
        } else if (comparison === 'prod-newer') {
          if (!dryRun) {
            await this.upsertRow(this.devClient, tableName, prodRow, config.pk, config.uuidColumns);
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
    // Use raw SQL to bypass Prisma's model validation
    const rows = await client.$queryRawUnsafe(`SELECT * FROM "${tableName}"`);
    return Array.isArray(rows) ? rows : [];
  }

  /**
   * Build a map of rows keyed by primary key(s)
   */
  private buildRowMap(
    rows: unknown[],
    pkField: string | readonly string[]
  ): Map<string, unknown> {
    const map = new Map();

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
    config: typeof SYNC_CONFIG[keyof typeof SYNC_CONFIG]
  ): 'dev-newer' | 'prod-newer' | 'same' {
    const devObj = devRow as Record<string, unknown>;
    const prodObj = prodRow as Record<string, unknown>;

    // Use updatedAt if available, otherwise createdAt
    const timestampField = 'updatedAt' in config ? config.updatedAt : config.createdAt;

    if (!timestampField) {
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
    uuidColumns: readonly string[] = []
  ): Promise<void> {
    if (typeof row !== 'object' || row === null) {
      throw new Error('Row is not an object');
    }

    const rowObj = row as Record<string, unknown>;

    // Build column names and values
    const columns = Object.keys(rowObj);
    const values = Object.values(rowObj);

    // Build parameterized query with UUID casting where needed
    const placeholders = columns.map((col, i) => {
      const placeholder = `$${i + 1}`;
      // Cast to UUID if this column is a UUID type
      return uuidColumns.includes(col) ? `${placeholder}::uuid` : placeholder;
    }).join(', ');
    const columnList = columns.map(c => `"${c}"`).join(', ');

    // Build UPDATE SET clause for conflict resolution
    const updateSet = columns
      .map(c => `"${c}" = EXCLUDED."${c}"`)
      .join(', ');

    // Determine conflict columns (primary key only)
    const pkColumns = typeof pkField === 'string'
      ? [pkField]
      : Array.from(pkField);
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
