/**
 * Unit tests for the schema-version gate — the throw-on-mismatch default and
 * the allow-schema-skew soak-window override are both safety-critical branches.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  checkSchemaVersions,
  validateSyncConfig,
  validateTombstoneTriggers,
} from './syncValidation.js';
import { EXCLUDED_TABLES, SYNC_CONFIG } from '../config/syncTables.js';
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

describe('validateTombstoneTriggers — per-table trigger existence + pk-arg-order parity', () => {
  const EXEMPT = ['conversation_history', 'conversation_history_tombstones', 'sync_tombstones'];

  /** The healthy inventory: one trigger row per non-exempt SYNC_CONFIG table,
   * TG_ARGV in SYNC_CONFIG.pk order — what a correctly-migrated DB reports. */
  function healthyTriggerRows(): { event_object_table: string; action_statement: string }[] {
    return Object.entries(SYNC_CONFIG)
      .filter(([table]) => !EXEMPT.includes(table))
      .map(([table, config]) => ({
        event_object_table: table,
        action_statement: `EXECUTE FUNCTION sync_tombstone_capture(${(typeof config.pk === 'string'
          ? [config.pk]
          : config.pk
        )
          .map(col => `'${col}'`)
          .join(', ')})`,
      }));
  }

  function triggerClient(
    rows: { event_object_table: string; action_statement: string }[]
  ): PrismaClient {
    return {
      $queryRaw: vi.fn().mockImplementation((strings: TemplateStringsArray) => {
        const query = strings.join('');
        if (query.includes('information_schema.triggers')) {
          return Promise.resolve(rows);
        }
        return Promise.resolve([]);
      }),
    } as unknown as PrismaClient;
  }

  it('stays silent when every table has its trigger in pk order on both sides', async () => {
    const warnings = await validateTombstoneTriggers(
      triggerClient(healthyTriggerRows()),
      triggerClient(healthyTriggerRows())
    );
    expect(warnings).toEqual([]);
  });

  it('warns naming the SIDE when a trigger is missing on prod only', async () => {
    const prodRows = healthyTriggerRows().filter(r => r.event_object_table !== 'personas');
    const warnings = await validateTombstoneTriggers(
      triggerClient(healthyTriggerRows()),
      triggerClient(prodRows)
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('personas: no sync_tombstone trigger on prod');
    expect(warnings[0]).toContain('resurrection risk');
  });

  it('warns on TG_ARGV order not matching SYNC_CONFIG.pk (composite table)', async () => {
    const devRows = healthyTriggerRows().map(r =>
      r.event_object_table === 'personality_owners'
        ? {
            ...r,
            action_statement:
              "EXECUTE FUNCTION sync_tombstone_capture('user_id', 'personality_id')",
          }
        : r
    );
    const warnings = await validateTombstoneTriggers(
      triggerClient(devRows),
      triggerClient(healthyTriggerRows())
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(
      'personality_owners: trigger pk order on dev is (user_id, personality_id)'
    );
    expect(warnings[0]).toContain('SYNC_CONFIG.pk is (personality_id, user_id)');
  });

  it('never flags the exempt tables (bespoke conversation_history path + the ledgers)', async () => {
    // Healthy inventory deliberately contains NO rows for the exempt tables.
    const warnings = await validateTombstoneTriggers(
      triggerClient(healthyTriggerRows()),
      triggerClient(healthyTriggerRows())
    );
    expect(warnings.filter(w => EXEMPT.some(t => w.startsWith(`${t}:`)))).toEqual([]);
  });
});
