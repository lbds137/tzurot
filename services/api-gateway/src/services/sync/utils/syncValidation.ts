/**
 * Sync Validation Utilities
 *
 * Validates database sync configuration and schema versions.
 */

import { type PrismaClient } from '@tzurot/common-types';
import { createLogger } from '@tzurot/common-types';
import {
  SYNC_CONFIG,
  EXCLUDED_TABLES,
  type SyncTableName,
  type TableSyncConfig,
} from '../config/syncTables.js';

const logger = createLogger('db-sync');

/**
 * Check that dev and prod databases are on the same schema version
 * @throws Error if schema versions don't match or can't be determined
 * @returns The matching schema version
 */
export async function checkSchemaVersions(
  devClient: PrismaClient,
  prodClient: PrismaClient
): Promise<string> {
  const devMigrations = await devClient.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1
  `;

  const prodMigrations = await prodClient.$queryRaw<{ migration_name: string }[]>`
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

export interface ValidationResult {
  warnings: string[];
  info: string[];
}

/**
 * Validate that SYNC_CONFIG matches actual database schema
 * @returns Object with warnings (problems) and info (expected exclusions)
 */
export async function validateSyncConfig(
  devClient: PrismaClient,
  syncConfig: Record<SyncTableName, TableSyncConfig>
): Promise<ValidationResult> {
  const warnings: string[] = [];
  const info: string[] = [];

  // Get actual UUID columns from database schema
  const actualUuidColumns = await devClient.$queryRaw<
    { table_name: string; column_name: string }[]
  >`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type = 'uuid'
    ORDER BY table_name, column_name
  `;

  // Build map of table -> UUID columns
  const schemaMap = new Map<string, Set<string>>();
  for (const row of actualUuidColumns) {
    let columnSet = schemaMap.get(row.table_name);
    if (columnSet === undefined) {
      columnSet = new Set();
      schemaMap.set(row.table_name, columnSet);
    }
    columnSet.add(row.column_name);
  }

  // Check each table in SYNC_CONFIG
  for (const [tableName, config] of Object.entries(syncConfig)) {
    const actualColumns = schemaMap.get(tableName);

    if (!actualColumns) {
      warnings.push(
        `⚠️  SYNC_CONFIG has table '${tableName}' but it doesn't exist in database schema`
      );
      continue;
    }

    // Check for missing UUID columns in SYNC_CONFIG
    const configColumns = config.uuidColumns as readonly string[];
    for (const actualColumn of actualColumns) {
      if (!configColumns.includes(actualColumn)) {
        warnings.push(
          `⚠️  Table '${tableName}' has UUID column '${actualColumn}' in schema but not in SYNC_CONFIG.uuidColumns`
        );
      }
    }

    // Check for extra UUID columns in SYNC_CONFIG
    for (const configColumn of config.uuidColumns) {
      if (!actualColumns.has(configColumn)) {
        warnings.push(
          `⚠️  Table '${tableName}' has '${configColumn}' in SYNC_CONFIG.uuidColumns but it's not a UUID column in schema (or doesn't exist)`
        );
      }
    }
  }

  // Check for tables in schema but not in SYNC_CONFIG
  const syncedTables = new Set(Object.keys(syncConfig));
  for (const tableName of schemaMap.keys()) {
    // Skip Prisma internal tables
    if (tableName.startsWith('_prisma')) {
      continue;
    }

    if (!syncedTables.has(tableName)) {
      // Check if it's an explicitly excluded table
      const exclusionReason = EXCLUDED_TABLES[tableName];
      if (exclusionReason !== undefined) {
        info.push(`ℹ️  Table '${tableName}' excluded: ${exclusionReason}`);
      } else {
        warnings.push(
          `⚠️  Table '${tableName}' exists in database but is not in SYNC_CONFIG or EXCLUDED_TABLES`
        );
      }
    }
  }

  if (warnings.length > 0) {
    logger.warn({ warnings }, '[Sync] SYNC_CONFIG validation warnings detected');
  }
  if (info.length > 0) {
    logger.info({ excludedCount: info.length }, '[Sync] Excluded tables acknowledged');
  }
  if (warnings.length === 0 && info.length === 0) {
    logger.info('[Sync] SYNC_CONFIG validation passed - all UUID columns match schema');
  }

  return { warnings, info };
}

/**
 * Whitelist of allowed table names for raw SQL operations.
 * Derived from SYNC_CONFIG keys for runtime validation.
 */
const ALLOWED_TABLES = new Set<string>(Object.keys(SYNC_CONFIG));

/**
 * Validate that a table name is in the allowed whitelist.
 * Provides runtime defense-in-depth for SQL interpolation safety.
 *
 * @param tableName - Table name to validate
 * @throws Error if table name is not in the allowed whitelist
 */
export function assertValidTableName(tableName: string): asserts tableName is SyncTableName {
  if (!ALLOWED_TABLES.has(tableName)) {
    throw new Error(
      `Invalid table name: "${tableName}". ` +
        `Only tables in SYNC_CONFIG are allowed: ${Array.from(ALLOWED_TABLES).join(', ')}`
    );
  }
}

/**
 * Build a set of allowed column names for a specific table.
 * Combines all column types from the table's sync config.
 *
 * @param tableName - Table name (must be valid)
 * @returns Set of allowed column names for the table
 */
export function getAllowedColumnsForTable(tableName: SyncTableName): Set<string> {
  const config = SYNC_CONFIG[tableName];
  const columns = new Set<string>();

  // Add primary key columns
  const pkFields = typeof config.pk === 'string' ? [config.pk] : config.pk;
  for (const pk of pkFields) {
    columns.add(pk);
  }

  // Add UUID columns
  for (const col of config.uuidColumns) {
    columns.add(col);
  }

  // Add timestamp columns
  for (const col of config.timestampColumns) {
    columns.add(col);
  }

  // Add deferred FK columns
  if (config.deferredFkColumns) {
    for (const col of config.deferredFkColumns) {
      columns.add(col);
    }
  }

  // Add createdAt and updatedAt if defined
  if (config.createdAt !== undefined) {
    columns.add(config.createdAt);
  }
  if (config.updatedAt !== undefined) {
    columns.add(config.updatedAt);
  }

  return columns;
}

/**
 * Validate that a column name is allowed for SQL interpolation.
 * Must be alphanumeric with underscores only (no special chars).
 *
 * @param columnName - Column name to validate
 * @throws Error if column name contains invalid characters
 */
export function assertValidColumnName(columnName: string): void {
  // Column names must be alphanumeric with underscores only
  // This prevents SQL injection via column names
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(columnName)) {
    throw new Error(
      `Invalid column name: "${columnName}". ` +
        `Column names must match pattern [a-zA-Z_][a-zA-Z0-9_]*`
    );
  }
}
