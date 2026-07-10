/**
 * Sync Validation Utilities
 *
 * Validates database sync configuration and schema versions.
 */

import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
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
  prodClient: PrismaClient,
  allowSkew = false
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
    if (!allowSkew) {
      throw new Error(
        `Schema version mismatch!\n` +
          `Dev: ${devVersion}\n` +
          `Prod: ${prodVersion}\n\n` +
          `Both databases must be on the same schema version before syncing.\n` +
          `If this is a known migration-soak window, re-run with allow-schema-skew.`
      );
    }
    // Conscious override for migration-soak windows: proceed, loudly. The
    // vector-table column intersection (resolveVectorSyncColumns) handles
    // those tables' skew; any OTHER structurally-diverged table will fail its own
    // fetch/upsert with a clear SQL error rather than corrupting silently.
    logger.warn(
      { devVersion, prodVersion },
      'Schema versions differ — proceeding under allow-schema-skew (migration-soak window)'
    );
    return `${devVersion} <> ${prodVersion} (skew allowed)`;
  }

  return devVersion;
}

interface ValidationResult {
  warnings: string[];
  info: string[];
}

/** Both directions of uuid-column agreement between schema and SYNC_CONFIG. */
function checkUuidColumnParity(
  tableName: string,
  config: TableSyncConfig,
  actualColumns: Set<string>,
  warnings: string[]
): void {
  const configColumns = config.uuidColumns as readonly string[];
  for (const actualColumn of actualColumns) {
    if (!configColumns.includes(actualColumn)) {
      warnings.push(
        `Table '${tableName}' has UUID column '${actualColumn}' in schema but not in SYNC_CONFIG.uuidColumns`
      );
    }
  }
  for (const configColumn of config.uuidColumns) {
    if (!actualColumns.has(configColumn)) {
      warnings.push(
        `Table '${tableName}' has '${configColumn}' in SYNC_CONFIG.uuidColumns but it's not a UUID column in schema (or doesn't exist)`
      );
    }
  }
}

/**
 * Validate that SYNC_CONFIG matches actual database schema
 * @returns Object with warnings (problems) and info (expected exclusions)
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Validates sync config against live DB schema: UUID columns, foreign keys, and exclusion lists with per-table reporting
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

  // Table EXISTENCE comes from information_schema.tables — a table with no
  // uuid columns at all (sync_tombstones: varchar + timestamp) is still a
  // real table; inferring existence from the uuid-column map alone would
  // false-flag it as missing.
  const actualTables = await devClient.$queryRaw<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `;
  const existingTables = new Set(actualTables.map(row => row.table_name));

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
    if (!existingTables.has(tableName)) {
      warnings.push(`SYNC_CONFIG has table '${tableName}' but it doesn't exist in database schema`);
      continue;
    }
    checkUuidColumnParity(tableName, config, schemaMap.get(tableName) ?? new Set(), warnings);
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
        info.push(`Table '${tableName}' excluded: ${exclusionReason}`);
      } else {
        warnings.push(
          `Table '${tableName}' exists in database but is not in SYNC_CONFIG or EXCLUDED_TABLES`
        );
      }
    }
  }

  // Phantom EXCLUDED_TABLES: an entry whose table no longer exists in the schema.
  // It produces neither a warning (the exclusion suppresses the uncategorized-table
  // check above) nor an info line (info only fires for excluded tables that DO exist),
  // so a stale exclusion rots silently. Detect it against the FULL table list — not the
  // UUID-only schemaMap, which would false-flag a real excluded table that happens to
  // have no UUID column.
  const allTables = await devClient.$queryRaw<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
  `;
  const schemaTableNames = new Set(allTables.map(r => r.table_name));
  for (const tableName of Object.keys(EXCLUDED_TABLES)) {
    // Skip Prisma internal tables, mirroring the uncategorized-table loop above —
    // they're never synced, so an `_prisma_*` exclusion (were one ever added) is a
    // no-op, not a phantom to flag.
    if (tableName.startsWith('_prisma')) {
      continue;
    }
    if (!schemaTableNames.has(tableName)) {
      warnings.push(`Table '${tableName}' is in EXCLUDED_TABLES but doesn't exist in the schema`);
    }
  }

  if (warnings.length > 0) {
    logger.warn({ warnings }, 'SYNC_CONFIG validation warnings detected');
  }
  if (info.length > 0) {
    logger.info({ excludedCount: info.length }, 'Excluded tables acknowledged');
  }
  if (warnings.length === 0 && info.length === 0) {
    logger.info('SYNC_CONFIG validation passed - all UUID columns match schema');
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
