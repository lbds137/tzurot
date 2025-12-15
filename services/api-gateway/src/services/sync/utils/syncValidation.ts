/**
 * Sync Validation Utilities
 *
 * Validates database sync configuration and schema versions.
 */

import { type PrismaClient } from '@tzurot/common-types';
import { createLogger } from '@tzurot/common-types';
import type { SyncTableName, TableSyncConfig } from '../config/syncTables.js';

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

/**
 * Validate that SYNC_CONFIG matches actual database schema
 * @returns Array of validation warnings (empty if all validations pass)
 */
export async function validateSyncConfig(
  devClient: PrismaClient,
  syncConfig: Record<SyncTableName, TableSyncConfig>
): Promise<string[]> {
  const warnings: string[] = [];

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
      warnings.push(
        `💡 Table '${tableName}' exists in database but is not in SYNC_CONFIG (will not be synced)`
      );
    }
  }

  if (warnings.length > 0) {
    logger.warn({ warnings }, '[Sync] SYNC_CONFIG validation warnings detected');
  } else {
    logger.info('[Sync] SYNC_CONFIG validation passed - all UUID columns match schema');
  }

  return warnings;
}
