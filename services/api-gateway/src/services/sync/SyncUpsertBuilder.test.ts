import { describe, it, expect, vi } from 'vitest';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

vi.mock('./utils/syncValidation.js', () => ({
  assertValidTableName: vi.fn(),
  assertValidColumnName: vi.fn(),
}));

import {
  buildRowMap,
  compareTimestamps,
  resolveVectorSyncColumns,
  upsertRow,
  MEMORIES_SYNC_COLUMNS,
  MEMORY_FACTS_SYNC_COLUMNS,
  VECTOR_SYNC_TABLES,
  type SyncExecutor,
} from './SyncUpsertBuilder.js';
import { SYNC_CONFIG, type TableSyncConfig } from './config/syncTables.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';

describe('SyncUpsertBuilder', () => {
  describe('buildRowMap', () => {
    it('should build map from rows with single PK', () => {
      const rows = [
        { id: 'a', name: 'Alice' },
        { id: 'b', name: 'Bob' },
      ];
      const map = buildRowMap(rows, 'id');
      expect(map.size).toBe(2);
      expect(map.get('a')).toEqual({ id: 'a', name: 'Alice' });
      expect(map.get('b')).toEqual({ id: 'b', name: 'Bob' });
    });

    it('should build map from rows with composite PK', () => {
      const rows = [
        { userId: 'u1', guildId: 'g1', role: 'admin' },
        { userId: 'u1', guildId: 'g2', role: 'member' },
      ];
      const map = buildRowMap(rows, ['userId', 'guildId']);
      expect(map.size).toBe(2);
      expect(map.get('u1|g1')).toEqual({ userId: 'u1', guildId: 'g1', role: 'admin' });
      expect(map.get('u1|g2')).toEqual({ userId: 'u1', guildId: 'g2', role: 'member' });
    });

    it('should handle empty rows array', () => {
      const map = buildRowMap([], 'id');
      expect(map.size).toBe(0);
    });

    it('should overwrite duplicate keys (last wins)', () => {
      const rows = [
        { id: 'a', value: 1 },
        { id: 'a', value: 2 },
      ];
      const map = buildRowMap(rows, 'id');
      expect(map.size).toBe(1);
      expect(map.get('a')).toEqual({ id: 'a', value: 2 });
    });
  });

  describe('compareTimestamps', () => {
    const now = new Date('2025-01-20T12:00:00Z');
    const earlier = new Date('2025-01-19T12:00:00Z');
    const config = {
      pk: 'id',
      uuidColumns: ['id'] as readonly string[],
      updatedAt: 'updatedAt',
      createdAt: 'createdAt',
    } as unknown as (typeof SYNC_CONFIG)[keyof typeof SYNC_CONFIG];

    it('should return dev-newer when dev has later timestamp', () => {
      const devRow = { updatedAt: now };
      const prodRow = { updatedAt: earlier };
      expect(compareTimestamps(devRow, prodRow, config)).toBe('dev-newer');
    });

    it('should return prod-newer when prod has later timestamp', () => {
      const devRow = { updatedAt: earlier };
      const prodRow = { updatedAt: now };
      expect(compareTimestamps(devRow, prodRow, config)).toBe('prod-newer');
    });

    it('should return same when timestamps are equal', () => {
      const devRow = { updatedAt: now };
      const prodRow = { updatedAt: new Date(now.getTime()) };
      expect(compareTimestamps(devRow, prodRow, config)).toBe('same');
    });

    it('should return same when timestamp field is undefined', () => {
      const configNoTimestamp = {
        pk: 'id',
        uuidColumns: ['id'] as readonly string[],
      } as unknown as (typeof SYNC_CONFIG)[keyof typeof SYNC_CONFIG];
      const devRow = { createdAt: now };
      const prodRow = { createdAt: earlier };
      expect(compareTimestamps(devRow, prodRow, configNoTimestamp)).toBe('same');
    });

    it('should return same when timestamps are not Date objects', () => {
      const devRow = { updatedAt: '2025-01-20' };
      const prodRow = { updatedAt: '2025-01-19' };
      expect(compareTimestamps(devRow, prodRow, config)).toBe('same');
    });
  });
});

describe('resolveVectorSyncColumns — skew tolerance', () => {
  const clientWith = (cols: string[]) =>
    ({
      $queryRawUnsafe: vi.fn().mockResolvedValue(cols.map(c => ({ column_name: c }))),
    }) as unknown as PrismaClient;

  it('returns the full canonical list when both sides match', async () => {
    const all = [...MEMORIES_SYNC_COLUMNS];
    const result = await resolveVectorSyncColumns(clientWith(all), clientWith(all), 'memories');
    expect(result).toEqual(all);
  });

  it('drops columns missing on either side (soak window) instead of failing', async () => {
    const all = [...MEMORIES_SYNC_COLUMNS];
    const prodMissingNew = all.filter(c => c !== 'pool' && c !== 'is_fiction');
    const result = await resolveVectorSyncColumns(
      clientWith(all),
      clientWith(prodMissingNew),
      'memories'
    );
    expect(result).not.toContain('pool');
    expect(result).not.toContain('is_fiction');
    expect(result).toContain('visibility');
  });

  it('resolves memory_facts against its own canonical list', async () => {
    const all = [...MEMORY_FACTS_SYNC_COLUMNS];
    const result = await resolveVectorSyncColumns(clientWith(all), clientWith(all), 'memory_facts');
    expect(result).toEqual(all);
    expect(result).toContain('superseded_by_id');
  });
});

describe('vector-table upserts — the ::vector cast crosses the SQL seam', () => {
  const capturingClient = (): { client: SyncExecutor; queries: string[] } => {
    const queries: string[] = [];
    const client = {
      $executeRawUnsafe: vi.fn(async (q: string) => {
        queries.push(q);
        return 1;
      }),
      $queryRawUnsafe: vi.fn(async () => []),
    } as unknown as SyncExecutor;
    return { queries, client };
  };

  it.each(Object.keys(VECTOR_SYNC_TABLES))(
    '%s: embedding param is cast ::vector, others are not',
    async tableName => {
      const { client, queries } = capturingClient();
      await upsertRow({
        client,
        tableName,
        row: { id: 'x', embedding: '[0.1,0.2]', statement: 's' },
        pkField: 'id',
        uuidColumns: ['id'],
      });
      expect(queries).toHaveLength(1);
      expect(queries[0]).toMatch(/\$2::vector/); // embedding is the 2nd column
      expect(queries[0]).toMatch(/\$1::uuid/);
      expect(queries[0]).not.toMatch(/\$3::vector/);
    }
  );

  it('non-vector tables never get a ::vector cast even with an embedding-named column', async () => {
    const { client, queries } = capturingClient();
    await upsertRow({
      client,
      tableName: 'users',
      row: { id: 'x', embedding: 'not-a-vector-table' },
      pkField: 'id',
      uuidColumns: ['id'],
    });
    expect(queries[0]).not.toContain('::vector');
  });
});

describe('MEM-ARCH-028: memories retrieval-signal columns never cross the sync', () => {
  const capturingClient = (): { client: SyncExecutor; queries: string[] } => {
    const queries: string[] = [];
    const client = {
      $executeRawUnsafe: vi.fn(async (q: string) => {
        queries.push(q);
        return 1;
      }),
      $queryRawUnsafe: vi.fn(async () => []),
    } as unknown as SyncExecutor;
    return { queries, client };
  };

  it('the memories upsert SQL omits last_retrieved_at and retrieval_count', async () => {
    const memoriesConfig: TableSyncConfig = SYNC_CONFIG.memories;
    const { client, queries } = capturingClient();

    await upsertRow({
      client,
      tableName: 'memories',
      row: {
        id: 'x',
        content: 'hello',
        last_retrieved_at: new Date('2026-01-01T00:00:00Z'),
        retrieval_count: 7,
      },
      pkField: memoriesConfig.pk,
      uuidColumns: memoriesConfig.uuidColumns,
      timestampColumns: memoriesConfig.timestampColumns,
      excludeColumns: memoriesConfig.excludeColumns ?? [],
    });

    expect(queries).toHaveLength(1);
    expect(queries[0]).not.toContain('last_retrieved_at');
    expect(queries[0]).not.toContain('retrieval_count');
    // The columns that DO belong in the sync stay present, confirming the
    // exclusion is scoped to the two retrieval-signal columns rather than
    // accidentally dropping the whole row.
    expect(queries[0]).toContain('content');
  });

  it('the memories config excludes exactly the retrieval-signal columns', () => {
    expect(SYNC_CONFIG.memories.excludeColumns).toEqual(['last_retrieved_at', 'retrieval_count']);
  });
});
