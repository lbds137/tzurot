/**
 * Unit tests for the exchange-memory sync: query scoping, every plan outcome,
 * and the applier's writes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { COALESCING, REPLY_PAIRING_WINDOW_MS } from '@tzurot/common-types/constants/message';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';

const { mockWrite, mockLogger } = vi.hoisted(() => ({
  mockWrite: vi.fn(),
  mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

vi.mock('./memorySingle.js', () => ({ writeMemoryContent: mockWrite }));

import { applyExchangeMemorySync, planExchangeMemorySync } from './historyEditMemory.js';

const ROW = {
  id: 'row-1',
  content: 'OLD',
  channelId: '123456789012345678',
  personaId: 'persona-1',
  personalityId: 'personality-1',
  createdAt: new Date('2026-06-04T12:00:00.000Z'),
};

const TRIGGER = { role: 'user', discordMessageId: ['333333333333333333'] };

describe('exchange memory sync', () => {
  const triggerFindFirst = vi.fn();
  const historyFindMany = vi.fn();
  const memoryFindMany = vi.fn();
  const memoryFindUnique = vi.fn();
  const pendingFindMany = vi.fn();
  const pendingFindUnique = vi.fn();
  const pendingUpdate = vi.fn();

  const prisma = {
    conversationHistory: { findFirst: triggerFindFirst, findMany: historyFindMany },
    memory: { findMany: memoryFindMany, findUnique: memoryFindUnique },
    pendingMemory: {
      findMany: pendingFindMany,
      findUnique: pendingFindUnique,
      updateMany: pendingUpdate,
    },
  } as unknown as PrismaClient;

  function memory(overrides: Record<string, unknown> = {}) {
    return {
      id: 'mem-1',
      content: '{user}: hi\n{assistant}: OLD',
      isLocked: false,
      chunkGroupId: null,
      ...overrides,
    };
  }

  function pending(overrides: Record<string, unknown> = {}) {
    return { id: 'pend-1', text: '{user}: hi\n{assistant}: OLD', ...overrides };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    triggerFindFirst.mockResolvedValue(TRIGGER);
    historyFindMany.mockResolvedValue([]);
    memoryFindMany.mockResolvedValue([memory()]);
    pendingFindMany.mockResolvedValue([]);
    mockWrite.mockResolvedValue({});
    pendingUpdate.mockResolvedValue({ count: 1 });
  });

  describe('planExchangeMemorySync', () => {
    it('scopes the trigger lookup by persona, personality and the pairing window', async () => {
      await planExchangeMemorySync(prisma, ROW, 'NEW');

      expect(triggerFindFirst).toHaveBeenCalledWith({
        where: {
          channelId: ROW.channelId,
          personalityId: ROW.personalityId,
          personaId: ROW.personaId,
          createdAt: {
            lt: ROW.createdAt,
            gte: new Date(ROW.createdAt.getTime() - REPLY_PAIRING_WINDOW_MS),
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { role: true, discordMessageId: true },
      });
    });

    it('scopes the memory lookup to live exchange rows of this persona and personality', async () => {
      await planExchangeMemorySync(prisma, ROW, 'NEW');

      expect(memoryFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            messageIds: { hasSome: TRIGGER.discordMessageId },
            personalityId: ROW.personalityId,
            personaId: ROW.personaId,
            visibility: 'normal',
            type: 'memory',
            isSummarized: false,
          },
          take: 2,
        })
      );
    });

    it('matches pending rows by persona, personality and a trigger id in metadata.messageIds', async () => {
      await planExchangeMemorySync(prisma, ROW, 'NEW');

      expect(pendingFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            personaId: ROW.personaId,
            personalityId: ROW.personalityId,
            OR: [{ metadata: { path: ['messageIds'], array_contains: ['333333333333333333'] } }],
          },
          take: 2,
        })
      );
    });

    it('is none without a memory lookup when the preceding row is not a user turn', async () => {
      triggerFindFirst.mockResolvedValue({ role: 'assistant', discordMessageId: ['1'] });

      expect(await planExchangeMemorySync(prisma, ROW, 'NEW')).toEqual({ kind: 'none' });
      expect(memoryFindMany).not.toHaveBeenCalled();
      expect(pendingFindMany).not.toHaveBeenCalled();
    });

    it('is none when the trigger has no discord ids', async () => {
      triggerFindFirst.mockResolvedValue({ role: 'user', discordMessageId: [] });

      expect(await planExchangeMemorySync(prisma, ROW, 'NEW')).toEqual({ kind: 'none' });
      expect(memoryFindMany).not.toHaveBeenCalled();
    });

    it('is none when neither a memory nor a pending row matches', async () => {
      memoryFindMany.mockResolvedValue([]);

      expect(await planExchangeMemorySync(prisma, ROW, 'NEW')).toEqual({ kind: 'none' });
    });

    it('is blocked ambiguous when two memories match', async () => {
      memoryFindMany.mockResolvedValue([memory(), memory({ id: 'mem-2' })]);

      expect(await planExchangeMemorySync(prisma, ROW, 'NEW')).toEqual({
        kind: 'blocked',
        reason: 'ambiguous',
      });
    });

    it('is blocked ambiguous when two pending rows match', async () => {
      pendingFindMany.mockResolvedValue([pending(), pending({ id: 'pend-2' })]);

      expect(await planExchangeMemorySync(prisma, ROW, 'NEW')).toEqual({
        kind: 'blocked',
        reason: 'ambiguous',
      });
    });

    it('is blocked locked for a locked memory', async () => {
      memoryFindMany.mockResolvedValue([memory({ isLocked: true })]);

      expect(await planExchangeMemorySync(prisma, ROW, 'NEW')).toEqual({
        kind: 'blocked',
        reason: 'locked',
      });
    });

    it('is blocked chunked for a chunked memory', async () => {
      memoryFindMany.mockResolvedValue([memory({ chunkGroupId: 'group-1' })]);

      expect(await planExchangeMemorySync(prisma, ROW, 'NEW')).toEqual({
        kind: 'blocked',
        reason: 'chunked',
      });
    });

    it('is blocked off-template for memory content outside the template', async () => {
      memoryFindMany.mockResolvedValue([memory({ content: 'free-form text' })]);

      expect(await planExchangeMemorySync(prisma, ROW, 'NEW')).toEqual({
        kind: 'blocked',
        reason: 'off-template',
      });
    });

    it('is blocked off-template for a pending row outside the template', async () => {
      memoryFindMany.mockResolvedValue([]);
      pendingFindMany.mockResolvedValue([pending({ text: 'free-form text' })]);

      expect(await planExchangeMemorySync(prisma, ROW)).toEqual({
        kind: 'blocked',
        reason: 'off-template',
      });
    });

    it('is blocked reply-off-template when the new reply would make the memory unparseable', async () => {
      expect(await planExchangeMemorySync(prisma, ROW, 'a\n{assistant}: b')).toEqual({
        kind: 'blocked',
        reason: 'reply-off-template',
      });
    });

    it('keeps off-template when the stored text itself does not parse, even with a new reply', async () => {
      memoryFindMany.mockResolvedValue([memory()]);
      pendingFindMany.mockResolvedValue([pending({ text: 'free-form text' })]);

      expect(await planExchangeMemorySync(prisma, ROW, 'a\n{assistant}: b')).toEqual({
        kind: 'blocked',
        reason: 'off-template',
      });
    });

    it('plans a sync for a user-part-block memory and a reply ending in a bracket', async () => {
      memoryFindMany.mockResolvedValue([
        memory({ content: '{user}: hi\n\n[Referenced content: a quote]\n{assistant}: OLD' }),
      ]);

      expect(await planExchangeMemorySync(prisma, ROW, '*smiles* [waves]')).toEqual({
        kind: 'sync',
        memoryIds: ['mem-1'],
        pendingIds: [],
      });
    });

    it('does not judge the reply content when no new reply is given', async () => {
      expect(await planExchangeMemorySync(prisma, ROW)).toEqual({
        kind: 'sync',
        memoryIds: ['mem-1'],
        pendingIds: [],
      });
    });

    it('plans a sync naming both rows when a memory and a pending row match', async () => {
      pendingFindMany.mockResolvedValue([pending()]);

      expect(await planExchangeMemorySync(prisma, ROW, 'NEW')).toEqual({
        kind: 'sync',
        memoryIds: ['mem-1'],
        pendingIds: ['pend-1'],
      });
    });

    it('plans a sync for a pending-only exchange', async () => {
      memoryFindMany.mockResolvedValue([]);
      pendingFindMany.mockResolvedValue([pending()]);

      expect(await planExchangeMemorySync(prisma, ROW, 'NEW')).toEqual({
        kind: 'sync',
        memoryIds: [],
        pendingIds: ['pend-1'],
      });
    });

    describe('sibling memories of a coalesced reply', () => {
      const SIBLING_TRIGGER = { personaId: 'persona-2', discordMessageId: ['444444444444444444'] };

      /** Primary query (no OR) gets `primary`; the batched sibling query gets `siblings`. */
      function stubMemories(primary: unknown[], siblings: unknown[]) {
        memoryFindMany.mockImplementation(({ where }: { where: { OR?: unknown } }) =>
          Promise.resolve(where.OR === undefined ? primary : siblings)
        );
      }

      function sibling(overrides: Record<string, unknown> = {}) {
        return memory({
          id: 'mem-2',
          personaId: 'persona-2',
          messageIds: ['444444444444444444'],
          ...overrides,
        });
      }

      beforeEach(() => {
        historyFindMany.mockResolvedValue([SIBLING_TRIGGER]);
      });

      it('queries other personas user rows between the previous reply and this one', async () => {
        const previous = new Date('2026-06-04T11:59:00.000Z');
        triggerFindFirst.mockResolvedValueOnce(TRIGGER).mockResolvedValueOnce({
          createdAt: previous,
        });

        await planExchangeMemorySync(prisma, ROW, 'NEW');

        expect(historyFindMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              channelId: ROW.channelId,
              personalityId: ROW.personalityId,
              role: 'user',
              deletedAt: null,
              personaId: { not: ROW.personaId },
              createdAt: { lt: ROW.createdAt, gt: previous },
            },
            take: COALESCING.MAX_SKIPPED_MESSAGES,
          })
        );
      });

      it('bounds the window by the hold deadline when there is no previous reply', async () => {
        triggerFindFirst.mockResolvedValueOnce(TRIGGER).mockResolvedValueOnce(null);

        await planExchangeMemorySync(prisma, ROW, 'NEW');

        expect(historyFindMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              createdAt: {
                lt: ROW.createdAt,
                gt: new Date(ROW.createdAt.getTime() - COALESCING.HOLD_DEADLINE_MS),
              },
            }),
          })
        );
      });

      it('plans the sibling memory and pending row after the primary ones', async () => {
        stubMemories([memory()], [sibling()]);
        pendingFindMany.mockImplementation(({ where }: { where: { personaId?: string } }) =>
          Promise.resolve(
            where.personaId !== undefined
              ? []
              : [
                  pending({
                    id: 'pend-2',
                    personaId: 'persona-2',
                    metadata: { messageIds: ['444444444444444444'] },
                  }),
                ]
          )
        );

        expect(await planExchangeMemorySync(prisma, ROW, 'NEW')).toEqual({
          kind: 'sync',
          memoryIds: ['mem-1', 'mem-2'],
          pendingIds: ['pend-2'],
        });
        expect(memoryFindMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              OR: [{ personaId: 'persona-2', messageIds: { hasSome: ['444444444444444444'] } }],
            }),
            take: 3,
          })
        );
      });

      it('plans a sibling even when the edited user has no memory of the reply', async () => {
        stubMemories([], [sibling()]);

        expect(await planExchangeMemorySync(prisma, ROW, 'NEW')).toEqual({
          kind: 'sync',
          memoryIds: ['mem-2'],
          pendingIds: [],
        });
      });

      it('ignores a sibling memory that holds a different reply', async () => {
        stubMemories(
          [],
          [sibling({ content: '{user}: other\n{assistant}: SOMETHING ELSE', isLocked: true })]
        );

        expect(await planExchangeMemorySync(prisma, ROW, 'NEW')).toEqual({ kind: 'none' });
      });

      it('ignores a memory of another persona that shares no candidate trigger', async () => {
        stubMemories([], [sibling({ personaId: 'persona-3' })]);

        expect(await planExchangeMemorySync(prisma, ROW, 'NEW')).toEqual({ kind: 'none' });
      });

      it('blocks other-locked when a sibling memory is locked', async () => {
        stubMemories([memory()], [sibling({ isLocked: true })]);

        expect(await planExchangeMemorySync(prisma, ROW, 'NEW')).toEqual({
          kind: 'blocked',
          reason: 'other-locked',
        });
      });

      it('blocks chunked when a sibling memory is chunked', async () => {
        stubMemories([], [sibling({ chunkGroupId: 'group-1' })]);

        expect(await planExchangeMemorySync(prisma, ROW, 'NEW')).toEqual({
          kind: 'blocked',
          reason: 'chunked',
        });
      });

      it('blocks ambiguous when one candidate has two matching memories', async () => {
        stubMemories([], [sibling(), sibling({ id: 'mem-3' })]);

        expect(await planExchangeMemorySync(prisma, ROW, 'NEW')).toEqual({
          kind: 'blocked',
          reason: 'ambiguous',
        });
      });

      it('blocks reply-off-template when the new reply would break a sibling memory', async () => {
        stubMemories([], [sibling()]);

        expect(await planExchangeMemorySync(prisma, ROW, 'a\n{assistant}: b')).toEqual({
          kind: 'blocked',
          reason: 'reply-off-template',
        });
      });

      it('lets the primary memory reason outrank a sibling one', async () => {
        stubMemories([memory({ isLocked: true })], [sibling({ isLocked: true })]);

        expect(await planExchangeMemorySync(prisma, ROW, 'NEW')).toEqual({
          kind: 'blocked',
          reason: 'locked',
        });
      });

      it('skips sibling queries entirely when no other persona has a candidate trigger', async () => {
        historyFindMany.mockResolvedValue([]);
        memoryFindMany.mockClear();

        expect(await planExchangeMemorySync(prisma, ROW, 'NEW')).toEqual({
          kind: 'sync',
          memoryIds: ['mem-1'],
          pendingIds: [],
        });
        expect(memoryFindMany).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('applyExchangeMemorySync', () => {
    it('rewrites only the assistant half of the memory', async () => {
      memoryFindUnique.mockResolvedValue({ content: '{user}: hi\n{assistant}: OLD' });

      await applyExchangeMemorySync(
        prisma,
        { kind: 'sync', memoryIds: ['mem-1'], pendingIds: [] },
        'NEW'
      );

      expect(mockWrite).toHaveBeenCalledWith(prisma, 'mem-1', '{user}: hi\n{assistant}: NEW');
      expect(pendingUpdate).not.toHaveBeenCalled();
    });

    it('preserves a referenced block in the user part', async () => {
      memoryFindUnique.mockResolvedValue({
        content: '{user}: hi\n\n[Referenced content: quoted]\n{assistant}: OLD',
      });

      await applyExchangeMemorySync(
        prisma,
        { kind: 'sync', memoryIds: ['mem-1'], pendingIds: [] },
        'NEW'
      );

      expect(mockWrite).toHaveBeenCalledWith(
        prisma,
        'mem-1',
        '{user}: hi\n\n[Referenced content: quoted]\n{assistant}: NEW'
      );
    });

    it('preserves a trailing referenced block on the assistant tail', async () => {
      memoryFindUnique.mockResolvedValue({
        content: '{user}: hi\n{assistant}: OLD\n\n[Referenced content: quoted]',
      });

      await applyExchangeMemorySync(
        prisma,
        { kind: 'sync', memoryIds: ['mem-1'], pendingIds: [] },
        'NEW'
      );

      expect(mockWrite).toHaveBeenCalledWith(
        prisma,
        'mem-1',
        '{user}: hi\n{assistant}: NEW\n\n[Referenced content: quoted]'
      );
    });

    it('rewrites the pending row text so a retry stores the edited reply', async () => {
      pendingFindUnique.mockResolvedValue({ text: '{user}: hi\n{assistant}: OLD' });

      await applyExchangeMemorySync(
        prisma,
        { kind: 'sync', memoryIds: [], pendingIds: ['pend-1'] },
        'NEW'
      );

      expect(pendingUpdate).toHaveBeenCalledWith({
        where: { id: 'pend-1' },
        data: { text: '{user}: hi\n{assistant}: NEW' },
      });
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('writes both rows when the plan names both', async () => {
      memoryFindUnique.mockResolvedValue({ content: '{user}: hi\n{assistant}: OLD' });
      pendingFindUnique.mockResolvedValue({ text: '{user}: hi\n{assistant}: OLD' });

      await applyExchangeMemorySync(
        prisma,
        { kind: 'sync', memoryIds: ['mem-1'], pendingIds: ['pend-1'] },
        'NEW'
      );

      expect(mockWrite).toHaveBeenCalledTimes(1);
      expect(pendingUpdate).toHaveBeenCalledTimes(1);
    });

    it('rewrites every planned row, including other users', async () => {
      memoryFindUnique.mockResolvedValue({ content: '{user}: hi\n{assistant}: OLD' });
      pendingFindUnique.mockResolvedValue({ text: '{user}: yo\n{assistant}: OLD' });

      const written = await applyExchangeMemorySync(
        prisma,
        { kind: 'sync', memoryIds: ['mem-1', 'mem-2'], pendingIds: ['pend-1', 'pend-2'] },
        'NEW'
      );

      expect(written).toBe(true);
      expect(mockWrite.mock.calls.map(call => call[1])).toEqual(['mem-1', 'mem-2']);
      expect(pendingUpdate.mock.calls.map(call => call[0].where.id)).toEqual(['pend-1', 'pend-2']);
    });

    it('skips a row that vanished or stopped matching the template', async () => {
      memoryFindUnique.mockResolvedValue(null);
      pendingFindUnique.mockResolvedValue({ text: 'free-form text' });

      await applyExchangeMemorySync(
        prisma,
        { kind: 'sync', memoryIds: ['mem-1'], pendingIds: ['pend-1'] },
        'NEW'
      );

      expect(mockWrite).not.toHaveBeenCalled();
      expect(pendingUpdate).not.toHaveBeenCalled();
    });

    it('returns true only when every planned row was written', async () => {
      memoryFindUnique.mockResolvedValue({ content: '{user}: hi\n{assistant}: OLD' });
      pendingFindUnique.mockResolvedValue({ text: '{user}: hi\n{assistant}: OLD' });

      expect(
        await applyExchangeMemorySync(
          prisma,
          { kind: 'sync', memoryIds: ['mem-1'], pendingIds: ['pend-1'] },
          'NEW'
        )
      ).toBe(true);
    });

    it.each([
      ['a vanished memory', { memoryIds: ['mem-1'], pendingIds: [] }, null, null],
      [
        'an unrewritable pending row',
        { memoryIds: [], pendingIds: ['pend-1'] },
        null,
        { text: 'free-form' },
      ],
    ])('returns false for %s', async (_label, ids, memoryRow, pendingRow) => {
      memoryFindUnique.mockResolvedValue(memoryRow);
      pendingFindUnique.mockResolvedValue(pendingRow);

      expect(await applyExchangeMemorySync(prisma, { kind: 'sync', ...ids }, 'NEW')).toBe(false);
    });

    it('treats a pending row consumed between read and write as a warned skip', async () => {
      pendingFindUnique.mockResolvedValue({ text: '{user}: hi\n{assistant}: OLD' });
      pendingUpdate.mockResolvedValue({ count: 0 });

      await expect(
        applyExchangeMemorySync(
          prisma,
          { kind: 'sync', memoryIds: [], pendingIds: ['pend-1'] },
          'NEW'
        )
      ).resolves.toBe(false);
      expect(pendingUpdate).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { pendingId: 'pend-1' },
        'Planned pending memory gone or unrewritable'
      );
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('returns false when one of two planned rows is skipped, though the other was written', async () => {
      memoryFindUnique.mockResolvedValue({ content: '{user}: hi\n{assistant}: OLD' });
      pendingFindUnique.mockResolvedValue(null);

      expect(
        await applyExchangeMemorySync(
          prisma,
          { kind: 'sync', memoryIds: ['mem-1'], pendingIds: ['pend-1'] },
          'NEW'
        )
      ).toBe(false);
      expect(mockWrite).toHaveBeenCalledTimes(1);
    });
  });
});
