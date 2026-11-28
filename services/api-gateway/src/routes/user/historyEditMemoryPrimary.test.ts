/**
 * Unit tests for the primary-row classification: which same-trigger rows are
 * the reply's own, which are stale orphans, and which are left out. Real-row
 * behavior is pinned in `historyReroll.component.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  findPrimaryRows,
  pendingMessageIds,
  storedReply,
  UNTRIGGERED_MEMORY_WINDOW_MS,
} from './historyEditMemoryPrimary.js';

const NOW = new Date('2026-06-04T14:00:00.000Z');
const STALE = new Date(NOW.getTime() - UNTRIGGERED_MEMORY_WINDOW_MS - 60_000);
const YOUNG = new Date(NOW.getTime() - 60_000);
const ROW = { personaId: 'persona-1', personalityId: 'personality-1', content: 'OLD' };

function memory(id: string, reply: string, createdAt: Date, extra = {}) {
  return {
    id,
    content: `{user}: hi\n{assistant}: ${reply}`,
    isLocked: false,
    chunkGroupId: null,
    createdAt,
    ...extra,
  };
}

describe('historyEditMemoryPrimary', () => {
  const memoryFindMany = vi.fn();
  const pendingFindMany = vi.fn();
  const prisma = {
    memory: { findMany: memoryFindMany },
    pendingMemory: { findMany: pendingFindMany },
  } as unknown as PrismaClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    pendingFindMany.mockResolvedValue([]);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses the reply half and the pending message ids', () => {
    expect(storedReply('{user}: hi\n{assistant}: OLD')).toBe('OLD');
    expect(storedReply('not a template')).toBeNull();
    expect(pendingMessageIds({ messageIds: ['1', 2, '3'] })).toEqual(['1', '3']);
    expect(pendingMessageIds(null)).toEqual([]);
  });

  it('reads a bounded set of rows per table', async () => {
    memoryFindMany.mockResolvedValue([]);

    await findPrimaryRows(prisma, ROW, ['t1'], {});

    expect(memoryFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }));
    expect(pendingFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }));
  });

  it('treats a lone row as the reply own whatever its text', async () => {
    memoryFindMany.mockResolvedValue([memory('m1', 'DRIFTED', STALE)]);

    const rows = await findPrimaryRows(prisma, ROW, ['t1'], {});

    expect(rows.memories.map(m => m.id)).toEqual(['m1']);
    expect(rows.orphanMemoryIds).toEqual([]);
  });

  it('picks the exact reply-text match, reports a stale orphan and ignores a young one', async () => {
    memoryFindMany.mockResolvedValue([
      memory('own', 'OLD', STALE),
      memory('stale', 'ATTEMPT', STALE),
      memory('young', 'ATTEMPT-2', YOUNG),
    ]);

    const rows = await findPrimaryRows(prisma, ROW, ['t1'], {});

    expect(rows.memories.map(m => m.id)).toEqual(['own']);
    expect(rows.orphanMemoryIds).toEqual(['stale']);
  });

  it('never offers a locked stale orphan for removal', async () => {
    memoryFindMany.mockResolvedValue([
      memory('own', 'OLD', STALE),
      memory('locked', 'A', STALE, { isLocked: true }),
    ]);

    const rows = await findPrimaryRows(prisma, ROW, ['t1'], {});

    expect(rows.orphanMemoryIds).toEqual([]);
    expect(rows.blocked).toBeNull();
  });

  it('blocks chunked when any row under the trigger is a chunk, even beside an exact match', async () => {
    memoryFindMany.mockResolvedValue([
      memory('own', 'OLD', STALE),
      memory('chunk', 'B', STALE, { chunkGroupId: 'g' }),
    ]);

    expect((await findPrimaryRows(prisma, ROW, ['t1'], {})).blocked).toBe('chunked');
  });

  it('blocks a 3-row chunk group whether or not a chunk text matches', async () => {
    const chunks = (texts: string[]) =>
      texts.map((reply, i) => memory(`c${i}`, reply, STALE, { chunkGroupId: 'g' }));

    memoryFindMany.mockResolvedValueOnce(chunks(['x', 'y', 'z']));
    memoryFindMany.mockResolvedValueOnce(chunks(['OLD', 'y', 'z']));

    expect((await findPrimaryRows(prisma, ROW, ['t1'], {})).blocked).toBe('chunked');
    expect((await findPrimaryRows(prisma, ROW, ['t1'], {})).blocked).toBe('chunked');
  });

  it('blocks ambiguous for two non-chunked rows with no exact match, locked when one is locked', async () => {
    memoryFindMany.mockResolvedValueOnce([memory('a', 'X', STALE), memory('b', 'Y', YOUNG)]);
    memoryFindMany.mockResolvedValueOnce([
      memory('a', 'X', STALE),
      memory('b', 'Y', STALE, { isLocked: true }),
    ]);

    expect((await findPrimaryRows(prisma, ROW, ['t1'], {})).blocked).toBe('ambiguous');
    expect((await findPrimaryRows(prisma, ROW, ['t1'], {})).blocked).toBe('locked');
  });

  it('plans normally for one exact match plus a stale different-text orphan', async () => {
    memoryFindMany.mockResolvedValue([memory('own', 'OLD', STALE), memory('o', 'ATTEMPT', STALE)]);

    const rows = await findPrimaryRows(prisma, ROW, ['t1'], {});

    expect(rows.blocked).toBeNull();
    expect(rows.orphanMemoryIds).toEqual(['o']);
  });

  it('is ambiguous for pending rows when several match none exactly', async () => {
    memoryFindMany.mockResolvedValue([]);
    pendingFindMany.mockResolvedValue([
      { id: 'p1', text: '{user}: hi\n{assistant}: X', createdAt: STALE },
      { id: 'p2', text: '{user}: hi\n{assistant}: Y', createdAt: STALE },
    ]);

    expect((await findPrimaryRows(prisma, ROW, ['t1'], {})).blocked).toBe('ambiguous');
  });

  it('reads newest first and blocks ambiguous when a table page is full', async () => {
    memoryFindMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => memory(`m${i}`, `R${i}`, STALE))
    );

    const rows = await findPrimaryRows(prisma, ROW, ['t1'], {});

    expect(memoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
    );
    expect(rows.blocked).toBe('ambiguous');
  });

  it('keeps two exact matches so the planner can call them ambiguous', async () => {
    memoryFindMany.mockResolvedValue([memory('a', 'OLD', STALE), memory('b', 'OLD', YOUNG)]);

    const rows = await findPrimaryRows(prisma, ROW, ['t1'], {});

    expect(rows.memories.map(m => m.id)).toEqual(['a', 'b']);
  });

  it('classifies pending rows the same way', async () => {
    memoryFindMany.mockResolvedValue([]);
    pendingFindMany.mockResolvedValue([
      { id: 'p-own', text: '{user}: hi\n{assistant}: OLD', createdAt: STALE },
      { id: 'p-stale', text: '{user}: hi\n{assistant}: X', createdAt: STALE },
      { id: 'p-young', text: '{user}: hi\n{assistant}: Y', createdAt: YOUNG },
    ]);

    const rows = await findPrimaryRows(prisma, ROW, ['t1'], {});

    expect(rows.pendings.map(p => p.id)).toEqual(['p-own']);
    expect(rows.orphanPendingIds).toEqual(['p-stale']);
  });
});
