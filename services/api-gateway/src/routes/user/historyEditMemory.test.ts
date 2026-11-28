/**
 * Unit tests for the exchange-memory sync: query scoping, every plan outcome,
 * and the applier's writes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { REPLY_PAIRING_WINDOW_MS } from '@tzurot/common-types/constants/message';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';

const { mockWrite } = vi.hoisted(() => ({ mockWrite: vi.fn() }));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

vi.mock('./memorySingle.js', () => ({ writeMemoryContent: mockWrite }));

import { applyExchangeMemorySync, planExchangeMemorySync } from './historyEditMemory.js';

const ROW = {
  id: 'row-1',
  channelId: '123456789012345678',
  personaId: 'persona-1',
  personalityId: 'personality-1',
  createdAt: new Date('2026-06-04T12:00:00.000Z'),
};

const TRIGGER = { role: 'user', discordMessageId: ['333333333333333333'] };

describe('exchange memory sync', () => {
  const triggerFindFirst = vi.fn();
  const memoryFindMany = vi.fn();
  const memoryFindUnique = vi.fn();
  const pendingFindMany = vi.fn();
  const pendingFindUnique = vi.fn();
  const pendingUpdate = vi.fn();

  const prisma = {
    conversationHistory: { findFirst: triggerFindFirst },
    memory: { findMany: memoryFindMany, findUnique: memoryFindUnique },
    pendingMemory: {
      findMany: pendingFindMany,
      findUnique: pendingFindUnique,
      update: pendingUpdate,
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
    memoryFindMany.mockResolvedValue([memory()]);
    pendingFindMany.mockResolvedValue([]);
    mockWrite.mockResolvedValue({});
    pendingUpdate.mockResolvedValue({});
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

    it('is blocked off-template when the new reply would make the memory unparseable', async () => {
      expect(await planExchangeMemorySync(prisma, ROW, 'a\n{assistant}: b')).toEqual({
        kind: 'blocked',
        reason: 'off-template',
      });
    });

    it('does not judge the reply content when no new reply is given', async () => {
      expect(await planExchangeMemorySync(prisma, ROW)).toEqual({
        kind: 'sync',
        memoryId: 'mem-1',
        pendingId: undefined,
      });
    });

    it('plans a sync naming both rows when a memory and a pending row match', async () => {
      pendingFindMany.mockResolvedValue([pending()]);

      expect(await planExchangeMemorySync(prisma, ROW, 'NEW')).toEqual({
        kind: 'sync',
        memoryId: 'mem-1',
        pendingId: 'pend-1',
      });
    });

    it('plans a sync for a pending-only exchange', async () => {
      memoryFindMany.mockResolvedValue([]);
      pendingFindMany.mockResolvedValue([pending()]);

      expect(await planExchangeMemorySync(prisma, ROW, 'NEW')).toEqual({
        kind: 'sync',
        memoryId: undefined,
        pendingId: 'pend-1',
      });
    });
  });

  describe('applyExchangeMemorySync', () => {
    it('rewrites only the assistant half of the memory', async () => {
      memoryFindUnique.mockResolvedValue({ content: '{user}: hi\n{assistant}: OLD' });

      await applyExchangeMemorySync(prisma, { kind: 'sync', memoryId: 'mem-1' }, 'NEW');

      expect(mockWrite).toHaveBeenCalledWith(prisma, 'mem-1', '{user}: hi\n{assistant}: NEW');
      expect(pendingUpdate).not.toHaveBeenCalled();
    });

    it('preserves a referenced block in the user part', async () => {
      memoryFindUnique.mockResolvedValue({
        content: '{user}: hi\n\n[Referenced content: quoted]\n{assistant}: OLD',
      });

      await applyExchangeMemorySync(prisma, { kind: 'sync', memoryId: 'mem-1' }, 'NEW');

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

      await applyExchangeMemorySync(prisma, { kind: 'sync', memoryId: 'mem-1' }, 'NEW');

      expect(mockWrite).toHaveBeenCalledWith(
        prisma,
        'mem-1',
        '{user}: hi\n{assistant}: NEW\n\n[Referenced content: quoted]'
      );
    });

    it('rewrites the pending row text so a retry stores the edited reply', async () => {
      pendingFindUnique.mockResolvedValue({ text: '{user}: hi\n{assistant}: OLD' });

      await applyExchangeMemorySync(prisma, { kind: 'sync', pendingId: 'pend-1' }, 'NEW');

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
        { kind: 'sync', memoryId: 'mem-1', pendingId: 'pend-1' },
        'NEW'
      );

      expect(mockWrite).toHaveBeenCalledTimes(1);
      expect(pendingUpdate).toHaveBeenCalledTimes(1);
    });

    it('skips a row that vanished or stopped matching the template', async () => {
      memoryFindUnique.mockResolvedValue(null);
      pendingFindUnique.mockResolvedValue({ text: 'free-form text' });

      await applyExchangeMemorySync(
        prisma,
        { kind: 'sync', memoryId: 'mem-1', pendingId: 'pend-1' },
        'NEW'
      );

      expect(mockWrite).not.toHaveBeenCalled();
      expect(pendingUpdate).not.toHaveBeenCalled();
    });
  });
});
