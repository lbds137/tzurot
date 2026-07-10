import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  loadSyncTombstones,
  flushPendingDeletes,
  pruneSyncTombstones,
  tombstoneKey,
  TOMBSTONE_RETENTION_DAYS,
} from './syncTombstoneUtils.js';

vi.mock('@tzurot/common-types/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const U1 = '4f9b0f66-0000-4000-8000-0000000000e1';
const U2 = '4f9b0f66-0000-4000-8000-0000000000e2';

function clientWithTombstones(
  rows: { tableName: string; rowPk: string; deletedAt: Date }[]
): PrismaClient {
  return {
    syncTombstone: {
      findMany: vi.fn().mockResolvedValueOnce(rows).mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
  } as unknown as PrismaClient;
}

describe('loadSyncTombstones', () => {
  it('merges both sides with the LATEST deleted_at winning per key', async () => {
    const older = new Date('2026-07-01T00:00:00Z');
    const newer = new Date('2026-07-09T00:00:00Z');
    const dev = clientWithTombstones([
      { tableName: 'llm_configs', rowPk: U1, deletedAt: older },
      { tableName: 'personas', rowPk: U2, deletedAt: older },
    ]);
    const prod = clientWithTombstones([{ tableName: 'llm_configs', rowPk: U1, deletedAt: newer }]);

    const merged = await loadSyncTombstones(dev, prod);

    expect(merged.get(tombstoneKey('llm_configs', U1))).toEqual(newer);
    expect(merged.get(tombstoneKey('personas', U2))).toEqual(older);
  });
});

describe('flushPendingDeletes', () => {
  it('deletes per table in REVERSE sync order with parameterized uuid tuples', async () => {
    const executed: { query: string; params: unknown[] }[] = [];
    const client = {
      $executeRawUnsafe: vi.fn(async (query: string, ...params: unknown[]) => {
        executed.push({ query, params });
        return 1;
      }),
    } as unknown as PrismaClient;
    const warnings: string[] = [];

    const { counts, anyFailed } = await flushPendingDeletes(
      client,
      [
        { tableName: 'personas', rowKey: U1 }, // parent — must delete AFTER children
        { tableName: 'memories', rowKey: U2 },
      ],
      'dev',
      warnings
    );
    expect(anyFailed).toBe(false);

    expect(executed).toHaveLength(2);
    // Reverse SYNC_TABLE_ORDER: memories (child) before personas (parent).
    expect(executed[0].query).toContain('DELETE FROM "memories"');
    expect(executed[0].query).toContain('$1::uuid');
    expect(executed[0].params).toEqual([U2]);
    expect(executed[1].query).toContain('DELETE FROM "personas"');
    expect(counts).toEqual({ memories: 1, personas: 1 });
    expect(warnings).toEqual([]);
  });

  it('splits composite rowKeys into per-column tuple params', async () => {
    const executed: { query: string; params: unknown[] }[] = [];
    const client = {
      $executeRawUnsafe: vi.fn(async (query: string, ...params: unknown[]) => {
        executed.push({ query, params });
        return 1;
      }),
    } as unknown as PrismaClient;

    await flushPendingDeletes(
      client,
      [{ tableName: 'personality_owners', rowKey: `${U1}|${U2}` }],
      'prod',
      []
    );

    expect(executed[0].query).toContain('("personality_id", "user_id") IN (($1::uuid, $2::uuid))');
    expect(executed[0].params).toEqual([U1, U2]);
  });

  it('fail-soft: one table failing (RESTRICT divergence) warns and continues', async () => {
    const client = {
      $executeRawUnsafe: vi
        .fn()
        .mockRejectedValueOnce(new Error('violates foreign key constraint'))
        .mockResolvedValue(1),
    } as unknown as PrismaClient;
    const warnings: string[] = [];

    const { counts, anyFailed } = await flushPendingDeletes(
      client,
      [
        { tableName: 'personas', rowKey: U1 },
        { tableName: 'memories', rowKey: U2 },
      ],
      'dev',
      warnings
    );

    // memories (first in reverse order) failed; personas still processed.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('memories');
    expect(counts).toEqual({ personas: 1 });
    expect(anyFailed).toBe(true); // gates the prune — see DatabaseSyncService
  });

  it('no-ops on an empty delete set', async () => {
    const client = { $executeRawUnsafe: vi.fn() } as unknown as PrismaClient;
    expect(await flushPendingDeletes(client, [], 'dev', [])).toEqual({
      counts: {},
      anyFailed: false,
    });
    expect(client.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});

describe('pruneSyncTombstones', () => {
  it('prunes past the retention window on BOTH sides', async () => {
    const mkClient = (count: number): PrismaClient =>
      ({
        syncTombstone: { deleteMany: vi.fn().mockResolvedValue({ count }) },
      }) as unknown as PrismaClient;
    const dev = mkClient(3);
    const prod = mkClient(2);

    const pruned = await pruneSyncTombstones(dev, prod);

    expect(pruned).toBe(5);
    const devArgs = vi.mocked(
      (dev as unknown as { syncTombstone: { deleteMany: ReturnType<typeof vi.fn> } }).syncTombstone
        .deleteMany
    ).mock.calls[0][0] as { where: { deletedAt: { lt: Date } } };
    const ageDays = (Date.now() - devArgs.where.deletedAt.lt.getTime()) / 86_400_000;
    expect(Math.round(ageDays)).toBe(TOMBSTONE_RETENTION_DAYS);
  });
});
