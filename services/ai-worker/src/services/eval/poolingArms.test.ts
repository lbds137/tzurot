import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  denseArm,
  ftsArm,
  armSortKey,
  rankBadge,
  oldestHistoryMs,
  POOL_K,
  OVERFETCH,
  SCORE_FLOOR,
} from './poolingArms.js';
import type { PooledCandidate } from './qrelsReconciliation.js';

const hit = (id: string, chunkGroupId: string | null, createdAt = 1000) => ({
  pageContent: `content of ${id}`,
  metadata: { id, chunkGroupId, createdAt },
});

describe('denseArm', () => {
  it('passes the query and pooling options across the adapter seam', async () => {
    const queryMemories = vi.fn().mockResolvedValue([]);
    await denseArm({ queryMemories }, 'persona-1', 'the query');
    expect(queryMemories).toHaveBeenCalledWith('the query', {
      personaId: 'persona-1',
      limit: OVERFETCH,
      scoreThreshold: SCORE_FLOOR,
    });
  });

  it('collapses chunk siblings to one candidate keyed by chunk group', async () => {
    const queryMemories = vi
      .fn()
      .mockResolvedValue([hit('m1', 'group-a'), hit('m2', 'group-a'), hit('m3', null)]);
    const rows = await denseArm({ queryMemories }, 'p', 'q');
    expect(rows.map(row => row.corpusId)).toEqual(['group-a', 'm3']);
    expect(rows[0].content).toBe('content of m1');
  });

  it('skips hits carrying neither chunk group nor id, and caps at POOL_K', async () => {
    const hits = [
      { pageContent: 'orphan', metadata: {} },
      ...Array.from({ length: OVERFETCH }, (_, i) => hit(`m${i}`, null)),
    ];
    const queryMemories = vi.fn().mockResolvedValue(hits);
    const rows = await denseArm({ queryMemories }, 'p', 'q');
    expect(rows).toHaveLength(POOL_K);
    expect(rows[0].corpusId).toBe('m0');
  });
});

describe('ftsArm', () => {
  const ftsRow = (id: string, chunkGroupId: string | null = null) => ({
    id,
    content: `content of ${id}`,
    created_at: new Date('2026-01-01T00:00:00Z'),
    chunk_group_id: chunkGroupId,
  });

  const prismaWith = (rows: unknown[]): Pick<PrismaClient, '$queryRaw'> =>
    ({ $queryRaw: vi.fn().mockResolvedValue(rows) }) as unknown as Pick<PrismaClient, '$queryRaw'>;

  it('builds an OR-of-lexemes query from words of 2+ characters', async () => {
    const prisma = prismaWith([]);
    await ftsArm(prisma, 'persona-1', 'Look, at THIS gym! a x');
    const values = (prisma.$queryRaw as ReturnType<typeof vi.fn>).mock.calls[0].slice(1);
    expect(values).toContain('look | at | this | gym');
  });

  it('short-circuits without querying when no lexemes survive', async () => {
    const prisma = prismaWith([]);
    expect(await ftsArm(prisma, 'persona-1', '!!! ?')).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('dedups by chunk group and caps at POOL_K', async () => {
    const rows = [
      ftsRow('m1', 'group-a'),
      ftsRow('m2', 'group-a'),
      ...Array.from({ length: OVERFETCH }, (_, i) => ftsRow(`f${i}`)),
    ];
    const out = await ftsArm(prismaWith(rows), 'persona-1', 'some words');
    expect(out).toHaveLength(POOL_K);
    expect(out[0]).toEqual({
      corpusId: 'group-a',
      createdAtMs: new Date('2026-01-01T00:00:00Z').getTime(),
      content: 'content of m1',
    });
    expect(out.filter(row => row.corpusId === 'group-a')).toHaveLength(1);
  });
});

describe('oldestHistoryMs', () => {
  it('returns the earliest turn timestamp', () => {
    const history = [
      { createdAt: '2026-01-02T00:00:00Z' },
      { createdAt: '2026-01-01T00:00:00Z' },
      { createdAt: '2026-01-03T00:00:00Z' },
    ];
    expect(oldestHistoryMs(history)).toBe(new Date('2026-01-01T00:00:00Z').getTime());
  });

  it('returns MAX_SAFE_INTEGER (not Infinity) for empty history so JSON survives', () => {
    expect(oldestHistoryMs([])).toBe(Number.MAX_SAFE_INTEGER);
    expect(JSON.parse(JSON.stringify({ ms: oldestHistoryMs([]) })).ms).toBe(
      Number.MAX_SAFE_INTEGER
    );
  });
});

describe('sheet helpers', () => {
  const candidate = (ranks: Record<string, number>): PooledCandidate => ({
    corpusId: 'c1',
    createdAtMs: 0,
    contentPreview: '',
    ranks,
    verdict: 'eligible',
  });

  it('armSortKey uses the best rank across arms, 99 when unranked', () => {
    expect(armSortKey(candidate({ a: 5, b: 2 }))).toBe(2);
    expect(armSortKey(candidate({}))).toBe(99);
  });

  it('rankBadge renders label#rank or null when the arm missed it', () => {
    expect(rankBadge(candidate({ a: 3 }), 'a', 'A')).toBe('A#3');
    expect(rankBadge(candidate({ a: 3 }), 'b', 'B')).toBeNull();
  });
});
