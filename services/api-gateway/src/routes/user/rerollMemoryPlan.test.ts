/**
 * Unit tests for the reroll memory plan: delegation to the edit-sync planner
 * for a triggered reply, and the exact-reply-text search for an untriggered one.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';

const { mockPlan, mockFindTrigger } = vi.hoisted(() => ({
  mockPlan: vi.fn(),
  mockFindTrigger: vi.fn(),
}));

vi.mock('@tzurot/conversation-history', () => ({ findImmediateTriggerRow: mockFindTrigger }));

vi.mock('./historyEditMemory.js', async () => {
  const actual =
    await vi.importActual<typeof import('./historyEditMemory.js')>('./historyEditMemory.js');
  return { ...actual, planExchangeMemorySync: mockPlan };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

import { planRerollMemoryRemoval } from './rerollMemoryPlan.js';

const ROW = {
  id: 'row-1',
  content: 'WEIGH-IN',
  channelId: '123456789012345678',
  personaId: 'persona-1',
  personalityId: 'personality-1',
  createdAt: new Date('2026-06-04T12:00:00.000Z'),
};

describe('planRerollMemoryRemoval', () => {
  const memoryFindMany = vi.fn();
  const pendingFindMany = vi.fn();
  const prisma = {
    memory: { findMany: memoryFindMany },
    pendingMemory: { findMany: pendingFindMany },
  } as unknown as PrismaClient;

  const memory = (overrides: Record<string, unknown> = {}) => ({
    id: 'mem-1',
    content: '{user}: nudge\n{assistant}: WEIGH-IN',
    isLocked: false,
    chunkGroupId: null,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindTrigger.mockResolvedValue(null);
    memoryFindMany.mockResolvedValue([]);
    pendingFindMany.mockResolvedValue([]);
  });

  describe('with a trigger', () => {
    beforeEach(() => {
      mockFindTrigger.mockResolvedValue({ discordMessageId: ['t1'] });
    });

    it('delegates to the edit-sync planner with no new reply and the exclusions', async () => {
      mockPlan.mockResolvedValue({ kind: 'sync', memoryIds: ['m'], pendingIds: ['p'] });

      const plan = await planRerollMemoryRemoval(prisma, ROW, { excludeMemoryIds: ['new'] });

      expect(mockPlan).toHaveBeenCalledWith(prisma, ROW, undefined, {
        excludeMemoryIds: ['new'],
        includeStaleOrphans: true,
      });
      expect(plan).toEqual({ kind: 'remove', memoryIds: ['m'], pendingIds: ['p'] });
      expect(memoryFindMany).not.toHaveBeenCalled();
    });

    it('passes a blocked plan and a none plan through', async () => {
      mockPlan.mockResolvedValueOnce({ kind: 'blocked', reason: 'locked' });
      mockPlan.mockResolvedValueOnce({ kind: 'none' });

      expect(await planRerollMemoryRemoval(prisma, ROW)).toEqual({
        kind: 'blocked',
        reason: 'locked',
      });
      expect(await planRerollMemoryRemoval(prisma, ROW)).toEqual({ kind: 'none' });
    });
  });

  describe('without a trigger', () => {
    it('searches untriggered memories of this persona and personality inside the window', async () => {
      await planRerollMemoryRemoval(prisma, ROW, { excludeMemoryIds: ['new'] });

      expect(memoryFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            personaId: ROW.personaId,
            personalityId: ROW.personalityId,
            visibility: 'normal',
            type: 'memory',
            isSummarized: false,
            messageIds: { isEmpty: true },
            OR: [
              { content: { contains: ROW.content } },
              { chunkGroupId: { not: null }, content: { contains: ROW.content.slice(0, 80) } },
            ],
            createdAt: { gte: ROW.createdAt, lte: expect.any(Date) },
            id: { notIn: ['new'] },
          },
          take: 3,
        })
      );
    });

    it('removes the memory whose stored reply is exactly the row content', async () => {
      memoryFindMany.mockResolvedValue([
        memory(),
        memory({ id: 'mem-2', content: '{user}: nudge\n{assistant}: OTHER' }),
      ]);

      expect(await planRerollMemoryRemoval(prisma, ROW)).toEqual({
        kind: 'remove',
        memoryIds: ['mem-1'],
        pendingIds: [],
      });
    });

    it('is none when no reply text matches', async () => {
      memoryFindMany.mockResolvedValue([memory({ content: '{user}: nudge\n{assistant}: OTHER' })]);

      expect(await planRerollMemoryRemoval(prisma, ROW)).toEqual({ kind: 'none' });
    });

    it('is blocked ambiguous when two memories match', async () => {
      memoryFindMany.mockResolvedValue([memory(), memory({ id: 'mem-2' })]);

      expect(await planRerollMemoryRemoval(prisma, ROW)).toEqual({
        kind: 'blocked',
        reason: 'ambiguous',
      });
    });

    it('is blocked locked for a locked match and chunked for a chunked one', async () => {
      memoryFindMany.mockResolvedValueOnce([memory({ isLocked: true })]);
      memoryFindMany.mockResolvedValueOnce([memory({ chunkGroupId: 'g' })]);

      expect(await planRerollMemoryRemoval(prisma, ROW)).toEqual({
        kind: 'blocked',
        reason: 'locked',
      });
      expect(await planRerollMemoryRemoval(prisma, ROW)).toEqual({
        kind: 'blocked',
        reason: 'chunked',
      });
    });

    it('blocks chunked for any chunk-group row the query finds, exact text or not', async () => {
      const chunk = (i: number, reply: string) =>
        memory({
          id: `c${i}`,
          content: `{user}: nudge\n{assistant}: ${reply}`,
          chunkGroupId: 'g',
        });
      memoryFindMany.mockResolvedValueOnce([chunk(0, 'WEIGH'), chunk(1, 'IN'), chunk(2, 'x')]);
      memoryFindMany.mockResolvedValueOnce([chunk(0, 'WEIGH-IN'), chunk(1, 'IN'), chunk(2, 'x')]);

      expect(await planRerollMemoryRemoval(prisma, ROW)).toEqual({
        kind: 'blocked',
        reason: 'chunked',
      });
      expect(await planRerollMemoryRemoval(prisma, ROW)).toEqual({
        kind: 'blocked',
        reason: 'chunked',
      });
    });

    it('matches a chunk group by the reply start, not the whole reply', async () => {
      const long = { ...ROW, content: `${'A'.repeat(100)}TAIL` };

      await planRerollMemoryRemoval(prisma, long);

      expect(memoryFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { content: { contains: long.content } },
              { chunkGroupId: { not: null }, content: { contains: 'A'.repeat(80) } },
            ],
          }),
        })
      );
    });

    it('includes an untriggered pending row with the exact reply and no trigger ids', async () => {
      pendingFindMany.mockResolvedValue([
        {
          id: 'pend-1',
          text: '{user}: nudge\n{assistant}: WEIGH-IN',
          metadata: { messageIds: [] },
        },
        {
          id: 'pend-2',
          text: '{user}: nudge\n{assistant}: WEIGH-IN',
          metadata: { messageIds: ['t9'] },
        },
      ]);

      expect(await planRerollMemoryRemoval(prisma, ROW)).toEqual({
        kind: 'remove',
        memoryIds: [],
        pendingIds: ['pend-1'],
      });
    });
  });
});
