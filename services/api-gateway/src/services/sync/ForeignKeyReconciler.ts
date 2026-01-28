/**
 * Foreign Key Reconciler
 * Handles Pass 2 of two-pass sync: updating deferred FK columns
 * after all referenced rows exist in both databases
 */

import { type PrismaClient } from '@tzurot/common-types';
import { createLogger } from '@tzurot/common-types';
import type { TableSyncConfig as SyncTableConfig } from './config/syncTables.js';
import { assertValidTableName, assertValidColumnName } from './utils/syncValidation.js';

const logger = createLogger('fk-reconciler');

/** Options for updating a single FK column */
interface UpdateFkColumnOptions {
  client: PrismaClient;
  tableName: string;
  fkColumn: string;
  value: string;
  pkColumns: string[];
  pkValues: unknown[];
}

/** Options for reconciling FK columns in both directions */
interface ReconcileBothDirectionsOptions {
  tableName: string;
  config: SyncTableConfig;
  devMap: Map<string, unknown>;
  prodMap: Map<string, unknown>;
  pkColumns: string[];
  deferredFkColumns: readonly string[];
  compareTimestamps: (
    devRow: unknown,
    prodRow: unknown,
    config: SyncTableConfig
  ) => 'dev-newer' | 'prod-newer' | 'same';
}

/** Options for reconciling FK columns in one direction */
interface ReconcileOneWayOptions {
  tableName: string;
  sourceMap: Map<string, unknown>;
  targetMap: Map<string, unknown>;
  pkColumns: string[];
  deferredFkColumns: readonly string[];
  direction: 'dev-to-prod' | 'prod-to-dev';
}

/**
 * Reconciles deferred foreign key columns after initial sync pass.
 *
 * During Pass 1, circular FK columns are set to NULL to avoid FK constraint
 * violations. This reconciler updates those columns in Pass 2 once all
 * referenced rows exist.
 */
export class ForeignKeyReconciler {
  constructor(
    private devClient: PrismaClient,
    private prodClient: PrismaClient
  ) {}

  /**
   * Update deferred FK columns for a table after all tables have been synced
   */
  async reconcile(
    tableName: string,
    config: SyncTableConfig,
    fetchAllRows: (client: PrismaClient, tableName: string) => Promise<unknown[]>,
    buildRowMap: (rows: unknown[], pkField: string | readonly string[]) => Map<string, unknown>,
    compareTimestamps: (
      devRow: unknown,
      prodRow: unknown,
      config: SyncTableConfig
    ) => 'dev-newer' | 'prod-newer' | 'same'
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
    const devRows = await fetchAllRows(this.devClient, tableName);
    const prodRows = await fetchAllRows(this.prodClient, tableName);

    // Build maps by primary key
    const devMap = buildRowMap(devRows, config.pk);
    const prodMap = buildRowMap(prodRows, config.pk);

    // Get primary key column(s)
    const pkColumns = typeof config.pk === 'string' ? [config.pk] : Array.from(config.pk);

    // Update deferred FK columns in both directions using last-write-wins
    await this.reconcileBothDirections({
      tableName,
      config,
      devMap,
      prodMap,
      pkColumns,
      deferredFkColumns,
      compareTimestamps,
    });

    // Handle rows that only exist in one database
    await this.reconcileOneWay({
      tableName,
      sourceMap: prodMap,
      targetMap: devMap,
      pkColumns,
      deferredFkColumns,
      direction: 'prod-to-dev',
    });
    await this.reconcileOneWay({
      tableName,
      sourceMap: devMap,
      targetMap: prodMap,
      pkColumns,
      deferredFkColumns,
      direction: 'dev-to-prod',
    });
  }

  /**
   * Reconcile FK columns for rows that exist in both databases
   */
  private async reconcileBothDirections(options: ReconcileBothDirectionsOptions): Promise<void> {
    const { tableName, config, devMap, prodMap, pkColumns, deferredFkColumns, compareTimestamps } =
      options;

    for (const [key, devRow] of devMap) {
      const prodRow = prodMap.get(key);
      if (prodRow === undefined) {
        continue;
      }

      const devObj = devRow as Record<string, unknown>;
      const prodObj = prodRow as Record<string, unknown>;

      const comparison = compareTimestamps(devRow, prodRow, config);

      for (const fkColumn of deferredFkColumns) {
        const devValue = devObj[fkColumn];
        const prodValue = prodObj[fkColumn];

        if (devValue === prodValue) {
          continue;
        }

        const pkValues = pkColumns.map(col => devObj[col]);

        if (comparison === 'dev-newer' || comparison === 'same') {
          if (devValue !== null && devValue !== undefined) {
            await this.updateFkColumn({
              client: this.prodClient,
              tableName,
              fkColumn,
              value: devValue as string,
              pkColumns,
              pkValues,
            });
          }
        }

        if (comparison === 'prod-newer' || comparison === 'same') {
          if (prodValue !== null && prodValue !== undefined) {
            await this.updateFkColumn({
              client: this.devClient,
              tableName,
              fkColumn,
              value: prodValue as string,
              pkColumns,
              pkValues,
            });
          }
        }
      }
    }
  }

  /**
   * Reconcile FK columns for rows that only exist in one database
   */
  private async reconcileOneWay(options: ReconcileOneWayOptions): Promise<void> {
    const { tableName, sourceMap, targetMap, pkColumns, deferredFkColumns, direction } = options;
    const targetClient = direction === 'dev-to-prod' ? this.prodClient : this.devClient;

    for (const [key, sourceRow] of sourceMap) {
      if (targetMap.has(key)) {
        continue;
      }

      const sourceObj = sourceRow as Record<string, unknown>;
      const pkValues = pkColumns.map(col => sourceObj[col]);

      for (const fkColumn of deferredFkColumns) {
        const value = sourceObj[fkColumn];
        if (value !== null && value !== undefined) {
          await this.updateFkColumn({
            client: targetClient,
            tableName,
            fkColumn,
            value: value as string,
            pkColumns,
            pkValues,
          });
        }
      }
    }
  }

  /**
   * Update a single FK column for a specific row
   */
  private async updateFkColumn(options: UpdateFkColumnOptions): Promise<void> {
    const { client, tableName, fkColumn, value, pkColumns, pkValues } = options;

    // Defense-in-depth: validate table and column names before SQL interpolation
    assertValidTableName(tableName);
    assertValidColumnName(fkColumn);
    for (const col of pkColumns) {
      assertValidColumnName(col);
    }

    const whereClause = pkColumns.map((col, i) => `"${col}" = $${i + 2}::uuid`).join(' AND ');

    const query = `
      UPDATE "${tableName}"
      SET "${fkColumn}" = $1::uuid
      WHERE ${whereClause}
    `;

    try {
      await client.$executeRawUnsafe(query, value, ...pkValues);
    } catch (error) {
      logger.error(
        { tableName, fkColumn, value, pkValues, error },
        '[Sync] FK update failed - referenced row may not exist'
      );
      throw error;
    }
  }
}
