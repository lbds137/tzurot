/**
 * Unit tests for the sibling-lookup helpers: the id exclusion filter, the
 * blocker classification and the batched sibling reads. The candidate search
 * and the planner built on them are covered through `planExchangeMemorySync`
 * in `historyEditMemory.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { idExclusion, loadSiblingRows, memoryBlocker } from './historyEditMemorySiblings.js';

describe('idExclusion', () => {
  it('is undefined when nothing is excluded and no row is held', () => {
    expect(idExclusion(undefined, undefined)).toBeUndefined();
    expect(idExclusion(undefined, [])).toBeUndefined();
  });

  it('uses a plain not for a single held row', () => {
    expect(idExclusion('mem-1', undefined)).toEqual({ not: 'mem-1' });
  });

  it('uses notIn for excluded ids alone', () => {
    expect(idExclusion(undefined, ['a', 'b'])).toEqual({ notIn: ['a', 'b'] });
  });

  it('merges the held row into the excluded ids', () => {
    expect(idExclusion('mem-1', ['a'])).toEqual({ notIn: ['a', 'mem-1'] });
  });
});

describe('memoryBlocker', () => {
  const free = { personaId: 'p1', isLocked: false, chunkGroupId: null };

  it('is null for a free memory', () => {
    expect(memoryBlocker(free, 'p1')).toBeNull();
  });

  it("is locked for the turn persona's locked memory", () => {
    expect(memoryBlocker({ ...free, isLocked: true }, 'p1')).toBe('locked');
  });

  it("is other-locked for another persona's locked memory", () => {
    expect(memoryBlocker({ ...free, isLocked: true, personaId: 'p2' }, 'p1')).toBe('other-locked');
  });

  it('is chunked for a chunk-group member', () => {
    expect(memoryBlocker({ ...free, chunkGroupId: 'g' }, 'p1')).toBe('chunked');
  });
});

describe('loadSiblingRows', () => {
  const candidates = [{ personaId: 'p2', discordMessageId: ['d1'] }];

  function setup() {
    const memoryFindMany = vi.fn().mockResolvedValue([]);
    const pendingFindMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      memory: { findMany: memoryFindMany },
      pendingMemory: { findMany: pendingFindMany },
    } as unknown as PrismaClient;
    return { prisma, memoryFindMany, pendingFindMany };
  }

  it('leaves out the primary rows and the excluded ids, and bounds the read', async () => {
    const { prisma, memoryFindMany, pendingFindMany } = setup();

    await loadSiblingRows(
      prisma,
      'personality-1',
      candidates,
      { triggerIds: ['t'], memoryId: 'mem-1', pendingId: 'pend-1' },
      { excludeMemoryIds: ['new-mem'], excludePendingIds: ['new-pend'] }
    );

    expect(memoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { notIn: ['new-mem', 'mem-1'] } }),
        take: 3,
      })
    );
    expect(pendingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { notIn: ['new-pend', 'pend-1'] } }),
        take: 3,
      })
    );
  });

  it('keeps the plain not for the primary rows when nothing is excluded', async () => {
    const { prisma, memoryFindMany } = setup();

    await loadSiblingRows(prisma, 'personality-1', candidates, {
      triggerIds: ['t'],
      memoryId: 'mem-1',
      pendingId: undefined,
    });

    expect(memoryFindMany.mock.calls[0][0].where.id).toEqual({ not: 'mem-1' });
  });

  it('narrows both reads to rows containing the reply text, so take cannot cut the real row off', async () => {
    const { prisma, memoryFindMany, pendingFindMany } = setup();

    await loadSiblingRows(
      prisma,
      'personality-1',
      candidates,
      { triggerIds: ['t'], memoryId: undefined, pendingId: undefined },
      { replyText: 'OLD REPLY' }
    );

    expect(memoryFindMany.mock.calls[0][0].where.content).toEqual({ contains: 'OLD REPLY' });
    expect(pendingFindMany.mock.calls[0][0].where.text).toEqual({ contains: 'OLD REPLY' });
  });
});
