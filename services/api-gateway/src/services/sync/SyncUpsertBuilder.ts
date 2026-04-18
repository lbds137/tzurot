/**
 * Sync Upsert Builder
 *
 * Row-level operations for database synchronization:
 * - Fetching all rows from a table
 * - Building primary key maps for efficient lookup
 * - Upserting rows with type casting and deferred FK handling
 * - Comparing timestamps for last-write-wins conflict resolution
 *
 * Extracted from DatabaseSyncService to reduce file size.
 */

import { type PrismaClient, createLogger } from '@tzurot/common-types';
import { assertValidTableName, assertValidColumnName } from './utils/syncValidation.js';
import type { SYNC_CONFIG } from './config/syncTables.js';

const logger = createLogger('db-sync');

/**
 * Minimal structural shape of a Prisma raw-query executor. Accepts either
 * a full `PrismaClient` or a transaction-scoped client from
 * `$transaction(cb)` — both satisfy this interface. We intentionally use
 * an explicit interface rather than `Pick<PrismaClient, ...>` because
 * Prisma's transaction-client type (`Prisma.TransactionClient`) omits
 * methods like `$transaction` / `$connect` from its type, and
 * `Pick<PrismaClient, 'X' | 'Y'>` cannot be assigned from an object
 * missing other fields even if those fields aren't referenced. The
 * structural interface avoids that and eliminates the double-cast
 * callers would otherwise need. (See PR #826 R1.)
 */
export interface SyncExecutor {
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
}

/**
 * Options for upserting a row during sync
 */
export interface UpsertRowOptions {
  /** Prisma client or transaction client to use */
  client: SyncExecutor;
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
   * Columns to completely exclude from sync.
   * These columns are not copied, allowing different values per environment.
   */
  excludeColumns?: readonly string[];
  // NOTE: `deferredFkColumns` was removed in the Ouroboros Insert refactor.
  // The previous two-pass approach (insert NULL, backfill in pass 2) is
  // replaced by single-pass insert with SET CONSTRAINTS ALL DEFERRED at
  // the transaction level. Real FK values go in from the start; Postgres
  // validates them at COMMIT when all circular rows exist. See the
  // DatabaseSyncService docstring for the full rationale.
}

/**
 * Fetch all rows from a table using raw SQL
 */
export async function fetchAllRows(client: PrismaClient, tableName: string): Promise<unknown[]> {
  // Defense-in-depth: validate table name before SQL interpolation
  assertValidTableName(tableName);

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
 * Get primary key value(s) as a string
 */
function getPrimaryKey(row: unknown, pkField: string | readonly string[]): string {
  if (typeof row !== 'object' || row === null) {
    throw new Error('Row is not an object');
  }

  const rowObj = row as Record<string, unknown>;

  if (typeof pkField === 'string') {
    return String(rowObj[pkField]);
  } else {
    return pkField.map(f => String(rowObj[f])).join('|');
  }
}

/**
 * Build a map of rows keyed by primary key(s)
 */
export function buildRowMap(
  rows: unknown[],
  pkField: string | readonly string[]
): Map<string, unknown> {
  const map = new Map<string, unknown>();

  for (const row of rows) {
    const key = getPrimaryKey(row, pkField);
    map.set(key, row);
  }

  return map;
}

/**
 * Compare timestamps to determine which row is newer
 */
export function compareTimestamps(
  devRow: unknown,
  prodRow: unknown,
  config: (typeof SYNC_CONFIG)[keyof typeof SYNC_CONFIG]
): 'dev-newer' | 'prod-newer' | 'same' {
  const devObj = devRow as Record<string, unknown>;
  const prodObj = prodRow as Record<string, unknown>;

  // Use updatedAt if available, otherwise createdAt
  const timestampField = 'updatedAt' in config ? config.updatedAt : config.createdAt;

  if (timestampField === undefined) {
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
export async function upsertRow(options: UpsertRowOptions): Promise<void> {
  const {
    client,
    tableName,
    row,
    pkField,
    uuidColumns = [],
    timestampColumns = [],
    excludeColumns = [],
  } = options;

  // Defense-in-depth: validate table name before SQL interpolation
  assertValidTableName(tableName);

  if (typeof row !== 'object' || row === null) {
    throw new Error('Row is not an object');
  }

  const rowObj = row as Record<string, unknown>;

  // Filter out excluded columns - these are not synced between environments
  const columns = Object.keys(rowObj).filter(col => !excludeColumns.includes(col));

  // Defense-in-depth: validate all column names before SQL interpolation
  for (const col of columns) {
    assertValidColumnName(col);
  }

  // Build values from filtered columns. FK columns (including circular
  // ones previously stripped to NULL in the two-pass pattern) now pass
  // through as-is — the enclosing transaction has SET CONSTRAINTS ALL
  // DEFERRED, so FK checks fire at COMMIT when all circular rows exist.
  const values = columns.map(col => {
    const val = rowObj[col];
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
      if (tableName === 'memories' && col === 'embedding') {
        return `${placeholder}::vector`;
      }
      if (uuidColumns.includes(col)) {
        return `${placeholder}::uuid`;
      }
      if (timestampColumns.includes(col)) {
        return `${placeholder}::timestamptz`;
      }
      return placeholder;
    })
    .join(', ');
  const columnList = columns.map(c => `"${c}"`).join(', ');

  // Build UPDATE SET clause for conflict resolution — all columns
  // participate now that deferred-FK NULL-stripping is gone.
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
