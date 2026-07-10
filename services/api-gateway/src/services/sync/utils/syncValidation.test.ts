/**
 * Unit tests for the schema-version gate — the throw-on-mismatch default and
 * the allow-schema-skew soak-window override are both safety-critical branches.
 */

import { describe, it, expect, vi } from 'vitest';
import { checkSchemaVersions, validateSyncConfig } from './syncValidation.js';
import { EXCLUDED_TABLES } from '../config/syncTables.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';

const clientAt = (migration: string) =>
  ({
    $queryRaw: vi.fn().mockResolvedValue([{ migration_name: migration }]),
  }) as unknown as PrismaClient;

describe('checkSchemaVersions', () => {
  it('returns the shared version when both sides match', async () => {
    const version = await checkSchemaVersions(clientAt('20260701_a'), clientAt('20260701_a'));
    expect(version).toBe('20260701_a');
  });

  it('throws on mismatch by default (the protective branch)', async () => {
    await expect(
      checkSchemaVersions(clientAt('20260705_new'), clientAt('20260701_a'))
    ).rejects.toThrow('Schema version mismatch');
  });

  it('proceeds with a skew-labeled version under allowSkew (soak-window override)', async () => {
    const version = await checkSchemaVersions(
      clientAt('20260705_new'),
      clientAt('20260701_a'),
      true
    );
    expect(version).toContain('20260705_new');
    expect(version).toContain('skew allowed');
  });

  it('still throws when a version cannot be determined, even under allowSkew', async () => {
    const empty = {
      $queryRaw: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;
    await expect(checkSchemaVersions(empty, clientAt('20260701_a'), true)).rejects.toThrow(
      'Could not determine schema versions'
    );
  });
});

describe('validateSyncConfig — table existence + uuid-column parity', () => {
  /** dev client whose information_schema answers are scripted:
   * tables query → `tables`; uuid-columns query → `uuidRows`. */
  function schemaClient(
    tables: string[],
    uuidRows: { table_name: string; column_name: string }[]
  ): PrismaClient {
    // The validator also phantom-checks EXCLUDED_TABLES against the schema;
    // include them so those (out-of-scope here) checks stay quiet.
    const allTables = [...tables, ...Object.keys(EXCLUDED_TABLES)];
    return {
      $queryRaw: vi.fn().mockImplementation((strings: TemplateStringsArray) => {
        const query = strings.join('');
        if (query.includes('information_schema.tables')) {
          return Promise.resolve(allTables.map(t => ({ table_name: t })));
        }
        if (query.includes('information_schema.columns')) {
          return Promise.resolve(uuidRows);
        }
        return Promise.resolve([]);
      }),
    } as unknown as PrismaClient;
  }

  const config = {
    sync_tombstones: {
      pk: ['table_name', 'row_pk'],
      createdAt: 'deleted_at',
      uuidColumns: [],
      timestampColumns: ['deleted_at'],
    },
    personas: {
      pk: 'id',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      uuidColumns: ['id', 'owner_id'],
      timestampColumns: ['created_at', 'updated_at'],
    },
  } as never;

  it('a zero-uuid-column table (sync_tombstones) EXISTS when information_schema.tables says so', async () => {
    // The pre-fix bug: existence was inferred from the uuid-column map, so a
    // table with no uuid columns at all was false-flagged as missing.
    const client = schemaClient(
      ['sync_tombstones', 'personas'],
      [
        { table_name: 'personas', column_name: 'id' },
        { table_name: 'personas', column_name: 'owner_id' },
      ]
    );

    const { warnings } = await validateSyncConfig(client, config);

    expect(warnings).toEqual([]);
  });

  it('a genuinely missing table still warns', async () => {
    const client = schemaClient(
      ['personas'], // sync_tombstones absent from the schema
      [
        { table_name: 'personas', column_name: 'id' },
        { table_name: 'personas', column_name: 'owner_id' },
      ]
    );

    const { warnings } = await validateSyncConfig(client, config);

    expect(warnings).toEqual([
      "SYNC_CONFIG has table 'sync_tombstones' but it doesn't exist in database schema",
    ]);
  });

  it('uuid-column parity still warns in both directions', async () => {
    const client = schemaClient(
      ['sync_tombstones', 'personas'],
      [
        { table_name: 'personas', column_name: 'id' },
        // owner_id missing from schema; extra_col present but unconfigured
        { table_name: 'personas', column_name: 'extra_col' },
      ]
    );

    const { warnings } = await validateSyncConfig(client, config);

    expect(warnings).toContain(
      "Table 'personas' has UUID column 'extra_col' in schema but not in SYNC_CONFIG.uuidColumns"
    );
    expect(warnings).toContain(
      "Table 'personas' has 'owner_id' in SYNC_CONFIG.uuidColumns but it's not a UUID column in schema (or doesn't exist)"
    );
  });
});
