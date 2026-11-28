import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RouteDeps } from '../routeDeps.js';
import {
  AttemptAbortedError,
  MemoryBlockedError,
  RowChangedError,
  commitReroll,
  sweepAfterCommit,
  type CommitArgs,
} from './rerollCommit.js';
import { REROLL_TRANSACTION_OPTIONS } from './rerollAttempt.js';

const mocks = vi.hoisted(() => ({ sweep: vi.fn(), propagate: vi.fn(), warn: vi.fn() }));

vi.mock('./rerollJobResult.js', () => ({ sweepAbandonedAttempts: mocks.sweep }));
vi.mock('@tzurot/conversation-history', () => ({
  propagateDeletionToFacts: mocks.propagate,
  mergeMessageMetadata: vi.fn(),
}));
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: mocks.warn, error: vi.fn() }),
  };
});

const row = {
  id: 'row-1',
  channelId: 'chan-1',
  guildId: 'guild-1',
  personalityId: 'personality-1',
  personaId: 'persona-1',
  createdAt: new Date('2026-06-04T12:00:00.000Z'),
};

describe('commitReroll', () => {
  const order: string[] = [];
  const queryRaw = vi.fn();
  const findUnique = vi.fn();
  const historyUpdateMany = vi.fn();
  const historyCreate = vi.fn();
  const memoryUpdateMany = vi.fn();
  const pendingDeleteMany = vi.fn();
  const tx = {
    $queryRaw: queryRaw,
    conversationHistory: {
      findUnique,
      updateMany: historyUpdateMany,
      create: historyCreate,
    },
    memory: { updateMany: memoryUpdateMany },
    pendingMemory: { deleteMany: pendingDeleteMany },
  };
  const prisma = {
    $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as RouteDeps['prisma'];
  const args: CommitArgs = {
    prisma,
    row,
    body: {
      rowId: 'row-1',
      attemptId: 'attempt-1',
      jobId: 'job-1',
      content: 'NEW',
      discordMessageIds: ['111111111111111111'],
      newMemoryIds: [],
      newPendingIds: [],
    },
    newId: 'new-row',
    incognito: false,
    incognitoKind: undefined,
    memoryIds: ['old-mem'],
    pendingIds: ['old-pend'],
    attemptMemoryIds: ['new-mem'],
    attemptPendingIds: ['new-pend'],
    reviveOwnerId: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    order.length = 0;
    queryRaw.mockImplementation(async () => {
      order.push('lock');
      return [];
    });
    findUnique.mockImplementation(async () => {
      order.push('read');
      return { messageMetadata: {} };
    });
    historyUpdateMany.mockImplementation(async () => {
      order.push('softDelete');
      return { count: 1 };
    });
    memoryUpdateMany.mockResolvedValue({ count: 1 });
    pendingDeleteMany.mockResolvedValue({ count: 1 });
    mocks.sweep.mockResolvedValue(3);
    mocks.propagate.mockResolvedValue(undefined);
  });

  it('locks, reads the tombstones, soft-deletes, creates the new row, then removes memories; it does not sweep', async () => {
    const result = await commitReroll(args);

    expect(order).toEqual(['lock', 'read', 'softDelete']);
    expect(historyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'new-row',
        personalityId: 'personality-1',
        personaId: 'persona-1',
        role: 'assistant',
        content: 'NEW',
        createdAt: row.createdAt,
        messageMetadata: { incognito: false },
      }),
    });
    expect(memoryUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['old-mem'] }, personalityId: 'personality-1', isLocked: false },
      data: { visibility: 'deleted' },
    });
    expect(pendingDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['old-pend'] }, personalityId: 'personality-1' },
    });
    expect(result).toBe(1);
    expect(mocks.sweep).not.toHaveBeenCalled();
  });

  describe('sweepAfterCommit', () => {
    it('hands the sweep this row, this job and the attempt keep sets, with no age window, in its own transaction', async () => {
      await sweepAfterCommit(args);

      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        REROLL_TRANSACTION_OPTIONS
      );
      expect(mocks.sweep).toHaveBeenCalledWith(tx, {
        rowId: 'row-1',
        jobId: 'job-1',
        personalityId: 'personality-1',
        keepMemoryIds: ['new-mem'],
        keepPendingIds: ['new-pend'],
      });
    });

    it('propagates fact deletions when it removed memories, and not when it removed none', async () => {
      await sweepAfterCommit(args);
      expect(mocks.propagate).toHaveBeenCalledWith(prisma);

      mocks.propagate.mockClear();
      mocks.sweep.mockResolvedValue(0);
      await sweepAfterCommit(args);
      expect(mocks.propagate).not.toHaveBeenCalled();
    });

    it('never throws: a failed sweep or propagation is logged at warn with ids and the sweep is not retried', async () => {
      mocks.sweep.mockRejectedValue(new Error('boom'));

      await expect(sweepAfterCommit(args)).resolves.toBeUndefined();
      expect(mocks.warn).toHaveBeenCalledWith(
        expect.objectContaining({ rowId: 'row-1', jobId: 'job-1' }),
        expect.stringContaining('not retried')
      );
      expect(mocks.sweep).toHaveBeenCalledTimes(1);

      mocks.warn.mockClear();
      mocks.sweep.mockResolvedValue(2);
      mocks.propagate.mockRejectedValue(new Error('facts down'));
      await expect(sweepAfterCommit(args)).resolves.toBeUndefined();
      expect(mocks.warn).toHaveBeenCalledTimes(1);
    });
  });

  it('rolls back with AttemptAbortedError, writing nothing, when the attempt is tombstoned', async () => {
    findUnique.mockResolvedValue({ messageMetadata: { abortedRerollAttempts: ['attempt-1'] } });

    await expect(commitReroll(args)).rejects.toBeInstanceOf(AttemptAbortedError);
    expect(historyUpdateMany).not.toHaveBeenCalled();
    expect(historyCreate).not.toHaveBeenCalled();
  });

  it('rolls back with RowChangedError, creating nothing, when the row was already replaced', async () => {
    historyUpdateMany.mockResolvedValue({ count: 0 });

    await expect(commitReroll(args)).rejects.toBeInstanceOf(RowChangedError);
    expect(historyCreate).not.toHaveBeenCalled();
    expect(mocks.sweep).not.toHaveBeenCalled();
  });

  it('rolls back with MemoryBlockedError, sweeping nothing, when a planned memory could not be removed', async () => {
    memoryUpdateMany.mockResolvedValue({ count: 0 });

    await expect(commitReroll(args)).rejects.toBeInstanceOf(MemoryBlockedError);
    expect(mocks.sweep).not.toHaveBeenCalled();
  });
});
