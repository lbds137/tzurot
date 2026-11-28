/**
 * Unit tests for the reroll routes: request validation, the owner scope in the
 * WHERE clauses, status mapping and the commit's write shape. Real-row
 * behavior (scoping across personalities, the transaction's effect) is pinned
 * in `historyReroll.component.test.ts`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../types.js';
import type { RouteDeps } from '../routeDeps.js';

const { mockIsBotOwner, mockPlan, mockPropagate, mockFindTrigger, mockMerge, mockWarn } =
  vi.hoisted(() => ({
    mockWarn: vi.fn(),
    mockMerge: vi.fn(),
    mockIsBotOwner: vi.fn(() => false),
    mockPlan: vi.fn(),
    mockPropagate: vi.fn(),
    mockFindTrigger: vi.fn(),
  }));

vi.mock('@tzurot/common-types/utils/ownerMiddleware', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/ownerMiddleware')>(
    '@tzurot/common-types/utils/ownerMiddleware'
  );
  return { ...actual, isBotOwner: mockIsBotOwner };
});
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: mockWarn, error: vi.fn() }),
  };
});
vi.mock('@tzurot/conversation-history', () => ({
  findImmediateTriggerRow: mockFindTrigger,
  propagateDeletionToFacts: mockPropagate,
  mergeMessageMetadata: mockMerge,
}));
vi.mock('./rerollMemoryPlan.js', () => ({ planRerollMemoryRemoval: mockPlan }));

import { resolveMainLockTimeoutMs } from '@tzurot/common-types/services/poolConfig';
import { generateRerolledConversationHistoryUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { sha256Hex } from '@tzurot/common-types/utils/sha256Hex';
import {
  REROLL_TRANSACTION_OPTIONS,
  REROLL_TRANSACTION_TIMEOUT_MS,
  rerollTransactionOptions,
} from './rerollAttempt.js';
import {
  handleAbortRerollAssistantMessage,
  handleCheckRerollAssistantMessage,
  handleRerollAssistantMessage,
} from './historyReroll.js';

const ROW = {
  id: 'row-1',
  content: 'OLD',
  discordMessageId: ['111111111111111111'],
  personaId: 'persona-1',
  personalityId: 'personality-1',
  channelId: '123456789012345678',
  guildId: 'guild-1',
  createdAt: new Date('2026-06-04T12:00:00.000Z'),
  messageMetadata: {},
  persona: { owner: { discordId: '900000000000000001' } },
};

describe('reroll routes', () => {
  const findFirst = vi.fn();
  const findMany = vi.fn();
  const historyUpdate = vi.fn();
  const historyCreate = vi.fn();
  const memoryUpdateMany = vi.fn();
  const pendingDeleteMany = vi.fn();
  const historyFindUnique = vi.fn();
  const historyFindMany = vi.fn();
  /** `tx.$queryRaw`: the row lock, and the commit's sweep query. */
  const queryRaw = vi.fn();
  /** `prisma.$queryRaw` (outside any transaction): the late-abort job-results read. */
  const preLockQueryRaw = vi.fn();
  const jobResultFindUnique = vi.fn();
  const callOrder: string[] = [];
  const tx = {
    $queryRaw: queryRaw,
    jobResult: { findUnique: jobResultFindUnique, updateMany: vi.fn() },
    conversationHistory: {
      updateMany: historyUpdate,
      create: historyCreate,
      findUnique: historyFindUnique,
      findMany: historyFindMany,
      findFirst,
    },
    memory: { updateMany: memoryUpdateMany },
    pendingMemory: { deleteMany: pendingDeleteMany },
  };
  const prisma = {
    $queryRaw: preLockQueryRaw,
    conversationHistory: { findFirst, findMany },
    jobResult: { findUnique: jobResultFindUnique },
    memory: { updateMany: memoryUpdateMany },
    pendingMemory: { deleteMany: pendingDeleteMany },
    $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const deps = { prisma } as unknown as RouteDeps;
  let newerRow: { id: string } | null = null;

  async function run(
    handler: typeof handleCheckRerollAssistantMessage,
    body: unknown,
    userId: string | undefined = '900000000000000001'
  ) {
    const res = {} as { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
    // `respond` marks the moment the answer is sent, so a test can order it against the sweep.
    res.json = vi.fn(() => {
      callOrder.push('respond');
      return res;
    });
    res.status = vi.fn(() => res);
    const { json, status } = res;
    await handler(deps)(
      {
        userId,
        params: { messageId: '111111111111111111' },
        body,
        query: {},
      } as unknown as AuthenticatedRequest,
      res as unknown as Response,
      () => undefined
    );
    return { json, status };
  }

  const commitBody = {
    rowId: 'row-1',
    attemptId: 'attempt-1',
    jobId: 'job-1',
    content: 'NEW',
    discordMessageIds: ['111111111111111111'],
    newMemoryIds: ['new-mem'],
    newPendingIds: ['new-pend'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsBotOwner.mockReturnValue(false);
    mockFindTrigger.mockResolvedValue(null);
    historyUpdate.mockResolvedValue({ count: 1 });
    callOrder.length = 0;
    queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      callOrder.push(strings.join('?').includes('FOR UPDATE') ? 'lock' : 'sweep-query');
      return [];
    });
    preLockQueryRaw.mockImplementation(async () => {
      callOrder.push('read-job-results');
      return [];
    });
    historyFindUnique.mockResolvedValue({ messageMetadata: {}, content: 'OLD', deletedAt: null });
    historyFindMany.mockResolvedValue([]);
    mockMerge.mockResolvedValue('updated');
    jobResultFindUnique.mockResolvedValue(null);
    mockPlan.mockResolvedValue({
      kind: 'remove',
      memoryIds: ['old-mem'],
      pendingIds: ['old-pend'],
    });
    memoryUpdateMany.mockResolvedValue({ count: 1 });
    pendingDeleteMany.mockResolvedValue({ count: 1 });
    newerRow = null;
    findFirst.mockImplementation(async (args: { where: { id?: unknown; OR?: unknown } }) => {
      if (args.where.OR !== undefined) {
        return newerRow;
      }
      // The attempt-landed lookup asks for the deterministic new id, never 'row-1'.
      return args.where.id !== undefined && args.where.id !== 'row-1' ? null : ROW;
    });
  });

  describe('reroll-check', () => {
    it('500s a missing caller identity without querying', async () => {
      const { status } = await run(handleCheckRerollAssistantMessage, {}, '');

      expect(status).toHaveBeenCalledWith(500);
      expect(findFirst).not.toHaveBeenCalled();
    });

    it('scopes the row lookup to the caller-owned persona', async () => {
      await run(handleCheckRerollAssistantMessage, {});

      expect(findFirst).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: expect.objectContaining({
            discordMessageId: { has: '111111111111111111' },
            role: 'assistant',
            deletedAt: null,
            persona: { owner: { discordId: '900000000000000001' } },
          }),
        })
      );
    });

    it('drops the owner scope for the bot owner', async () => {
      mockIsBotOwner.mockReturnValue(true);

      await run(handleCheckRerollAssistantMessage, {});

      expect(findFirst.mock.calls[0][0].where).not.toHaveProperty('persona');
    });

    it('404s a missing row', async () => {
      findFirst.mockResolvedValueOnce(null);

      const { status } = await run(handleCheckRerollAssistantMessage, {});

      expect(status).toHaveBeenCalledWith(404);
    });

    it('409s NOT_LATEST when a newer row of any role exists', async () => {
      newerRow = { id: 'newer' };

      const { status, json } = await run(handleCheckRerollAssistantMessage, {});

      expect(status).toHaveBeenCalledWith(409);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NOT_LATEST' }));
      expect(mockPlan).not.toHaveBeenCalled();
    });

    it('rejects a malformed body', async () => {
      const { status } = await run(handleCheckRerollAssistantMessage, { excludeMemoryIds: 'x' });

      expect(status).toHaveBeenCalledWith(400);
    });

    it('plans with the body exclusions and writes nothing', async () => {
      const { json } = await run(handleCheckRerollAssistantMessage, {
        excludeMemoryIds: ['new-mem'],
      });

      expect(mockPlan).toHaveBeenCalledWith(prisma, ROW, { excludeMemoryIds: ['new-mem'] });
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          rowId: 'row-1',
          ownerDiscordId: '900000000000000001',
          incognito: false,
          trigger: null,
          memoryPlan: { kind: 'remove', memoryIds: ['old-mem'], pendingIds: ['old-pend'] },
        })
      );
      expect(memoryUpdateMany).not.toHaveBeenCalled();
      expect(historyUpdate).not.toHaveBeenCalled();
    });

    it('reports a stored incognito kind', async () => {
      findFirst.mockResolvedValueOnce({
        ...ROW,
        messageMetadata: { incognito: true, incognitoKind: 'session' },
      });

      const { json } = await run(handleCheckRerollAssistantMessage, {});

      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ incognito: true, incognitoKind: 'session' })
      );
    });

    it('reports a stored incognito flag', async () => {
      findFirst.mockResolvedValueOnce({ ...ROW, messageMetadata: { incognito: true } });

      const { json } = await run(handleCheckRerollAssistantMessage, {});

      expect(json).toHaveBeenCalledWith(expect.objectContaining({ incognito: true }));
    });
  });

  describe('reroll commit', () => {
    it('409s ROW_CHANGED when the row is gone', async () => {
      findFirst.mockResolvedValueOnce(null);

      const { status, json } = await run(handleRerollAssistantMessage, commitBody);

      expect(status).toHaveBeenCalledWith(409);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ROW_CHANGED' }));
    });

    it('409s ROW_CHANGED when the path message id is not one of the row ids', async () => {
      findFirst.mockResolvedValueOnce({ ...ROW, discordMessageId: ['999999999999999999'] });

      const { json } = await run(handleRerollAssistantMessage, commitBody);

      expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ROW_CHANGED' }));
    });

    it('409s NOT_LATEST and MEMORY_BLOCKED without writing', async () => {
      newerRow = { id: 'newer' };
      const notLatest = await run(handleRerollAssistantMessage, commitBody);
      newerRow = null;
      mockPlan.mockResolvedValueOnce({ kind: 'blocked', reason: 'locked' });
      const blocked = await run(handleRerollAssistantMessage, commitBody);

      expect(notLatest.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NOT_LATEST' }));
      expect(blocked.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'MEMORY_BLOCKED',
          message: expect.stringContaining('locked'),
        })
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('re-plans with the new ids excluded', async () => {
      await run(handleRerollAssistantMessage, commitBody);

      expect(mockPlan).toHaveBeenCalledWith(prisma, ROW, {
        excludeMemoryIds: ['new-mem'],
        excludePendingIds: ['new-pend'],
      });
    });

    it('takes the keep set from the matching job result, not the body', async () => {
      jobResultFindUnique.mockResolvedValue({
        result: {
          metadata: {
            rerollMemory: {
              rowId: 'row-1',
              attemptId: 'attempt-1',
              memoryIds: ['job-mem'],
              pendingIds: ['job-pend'],
            },
          },
        },
      });

      await run(handleRerollAssistantMessage, commitBody);

      expect(mockPlan).toHaveBeenCalledWith(prisma, ROW, {
        excludeMemoryIds: ['job-mem'],
        excludePendingIds: ['job-pend'],
      });
    });

    it('falls back to the body ids, warning, when the job result is missing', async () => {
      await run(handleRerollAssistantMessage, commitBody);

      expect(mockPlan).toHaveBeenCalledWith(prisma, ROW, {
        excludeMemoryIds: ['new-mem'],
        excludePendingIds: ['new-pend'],
      });
      expect(mockWarn).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: 'job-1', reason: 'missing' }),
        expect.any(String)
      );
    });

    it('writes the whole commit in one transaction, scoped to the row persona and personality', async () => {
      const { json } = await run(handleRerollAssistantMessage, {
        ...commitBody,
        thinkingContent: 'hmm',
        incognito: true,
        incognitoKind: 'session',
      });

      // One transaction for the commit, a second (after it) for the sweep.
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(historyUpdate).toHaveBeenCalledWith({
        where: { id: 'row-1', deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(historyCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: expect.any(String),
          channelId: ROW.channelId,
          guildId: ROW.guildId,
          personalityId: ROW.personalityId,
          personaId: ROW.personaId,
          role: 'assistant',
          content: 'NEW',
          discordMessageId: ['111111111111111111'],
          createdAt: ROW.createdAt,
          thinkingContent: 'hmm',
          messageMetadata: { incognito: true, incognitoKind: 'session' },
        }),
      });
      expect(historyCreate.mock.calls[0][0].data.id).not.toBe('row-1');
      expect(memoryUpdateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['old-mem'] },
          personalityId: 'personality-1',
          isLocked: false,
        },
        data: { visibility: 'deleted' },
      });
      expect(pendingDeleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['old-pend'] }, personalityId: 'personality-1' },
      });
      expect(mockPropagate).toHaveBeenCalledWith(prisma);
      expect(json).toHaveBeenCalledWith({ id: expect.any(String), removedMemories: 1 });
    });

    it('carries the stored incognito flag and kind when the body omits them', async () => {
      findFirst.mockResolvedValueOnce({
        ...ROW,
        messageMetadata: { incognito: true, incognitoKind: 'summon' },
      });

      await run(handleRerollAssistantMessage, commitBody);

      expect(historyCreate.mock.calls[0][0].data.messageMetadata).toEqual({
        incognito: true,
        incognitoKind: 'summon',
      });
    });

    it('always writes an explicit incognito boolean, keeping the old row other metadata but not its tombstones', async () => {
      historyFindUnique.mockResolvedValue({
        messageMetadata: { custom: 1, abortedRerollAttempts: ['older'] },
      });

      await run(handleRerollAssistantMessage, commitBody);

      expect(historyCreate.mock.calls[0][0].data.messageMetadata).toEqual({
        custom: 1,
        incognito: false,
      });
    });

    it('locks the old row before reading its tombstones or writing anything', async () => {
      historyFindUnique.mockImplementation(async () => {
        callOrder.push('read');
        return { messageMetadata: {} };
      });
      historyUpdate.mockImplementation(async () => {
        callOrder.push('softDelete');
        return { count: 1 };
      });

      await run(handleRerollAssistantMessage, commitBody);

      expect(callOrder.slice(0, 3)).toEqual(['lock', 'read', 'softDelete']);
    });

    it('sweeps the row’s abandoned attempts after the commit, excluding its own job and ids, with no age filter', async () => {
      await run(handleRerollAssistantMessage, commitBody);

      expect(callOrder).toEqual(['lock', 'respond', 'sweep-query']);
      expect(queryRaw.mock.invocationCallOrder[1]).toBeGreaterThan(
        pendingDeleteMany.mock.invocationCallOrder[0]
      );
      const [strings, ...values] = queryRaw.mock.calls[1] as [TemplateStringsArray, ...unknown[]];
      expect(strings.join('?')).toContain('FROM job_results');
      expect(strings.join('?')).not.toContain('completed_at <');
      // Parameterised, never interpolated: row id, the committing job, the page size.
      expect(values).toEqual(['row-1', 'job-1', 20]);
    });

    it('sends the response BEFORE the sweep runs', async () => {
      let sweepStartedAfterResponse = false;
      queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
        if (strings.join('?').includes('FOR UPDATE')) {
          return [];
        }
        sweepStartedAfterResponse = callOrder.includes('respond');
        return [];
      });

      await run(handleRerollAssistantMessage, commitBody);

      expect(sweepStartedAfterResponse).toBe(true);
    });

    it('runs the sweep in its own transaction after the commit, both with the explicit options', async () => {
      await run(handleRerollAssistantMessage, commitBody);

      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      for (const call of vi.mocked(prisma.$transaction).mock.calls as unknown[][]) {
        expect(call[1]).toEqual(REROLL_TRANSACTION_OPTIONS);
      }
      // The commit transaction took the lock; the sweep query belongs to the second one.
      expect(historyCreate.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.$transaction.mock.invocationCallOrder[1]
      );
    });

    it('revives the committing attempt memories inside the commit, scoped to the personality and unlocked', async () => {
      await run(handleRerollAssistantMessage, commitBody);

      expect(memoryUpdateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['new-mem'] },
          personalityId: 'personality-1',
          isLocked: false,
          visibility: 'deleted',
        },
        data: { visibility: 'normal' },
      });
    });

    it('a sweep that fails after the response is logged with ids, never surfaced, and not retried', async () => {
      queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
        if (strings.join('?').includes('FOR UPDATE')) {
          return [];
        }
        throw new Error('sweep boom');
      });

      const { json, status } = await run(handleRerollAssistantMessage, commitBody);

      expect(json).toHaveBeenCalledWith({
        id: generateRerolledConversationHistoryUuid('row-1', 'attempt-1'),
        removedMemories: 1,
      });
      expect(status).not.toHaveBeenCalledWith(500);
      expect(mockWarn).toHaveBeenCalledWith(
        expect.objectContaining({ rowId: 'row-1', jobId: 'job-1' }),
        expect.stringContaining('not retried')
      );
      // One sweep attempt only.
      expect(
        queryRaw.mock.calls.filter(call => !String(call[0]).includes('FOR UPDATE'))
      ).toHaveLength(1);
    });

    it('a fact-propagation failure after a successful sweep is also logged, not surfaced', async () => {
      mockPlan.mockResolvedValueOnce({ kind: 'none' });
      memoryUpdateMany.mockResolvedValue({ count: 0 });
      queryRaw.mockImplementation(async (strings: TemplateStringsArray) =>
        strings.join('?').includes('FOR UPDATE')
          ? []
          : [
              {
                job_id: 'job-old',
                result: {
                  metadata: {
                    rerollMemory: {
                      rowId: 'row-1',
                      attemptId: 'attempt-old',
                      memoryIds: ['m'],
                      pendingIds: [],
                    },
                  },
                },
              },
            ]
      );
      // Calls in order: the revive of the attempt's own memories, the commit's removal, the sweep.
      memoryUpdateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });
      // Only the post-response propagation runs (nothing was removed by the commit itself).
      mockPropagate.mockRejectedValueOnce(new Error('facts down'));

      const { status } = await run(handleRerollAssistantMessage, commitBody);

      expect(status).not.toHaveBeenCalledWith(500);
      expect(mockWarn).toHaveBeenCalledWith(
        expect.objectContaining({ rowId: 'row-1' }),
        expect.stringContaining('not retried')
      );
    });

    it('propagates fact deletions when only abandoned attempts were swept', async () => {
      mockPlan.mockResolvedValueOnce({ kind: 'none' });
      memoryUpdateMany.mockResolvedValue({ count: 0 });
      queryRaw.mockImplementation(async (strings: TemplateStringsArray) =>
        strings.join('?').includes('FOR UPDATE')
          ? []
          : [
              {
                job_id: 'job-old',
                result: {
                  metadata: {
                    rerollMemory: {
                      rowId: 'row-1',
                      attemptId: 'attempt-old',
                      memoryIds: ['old-attempt-mem'],
                      pendingIds: [],
                    },
                  },
                },
              },
            ]
      );
      // Calls in order: the revive of the attempt's own memories, the commit's removal, the sweep.
      memoryUpdateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });

      await run(handleRerollAssistantMessage, commitBody);

      expect(memoryUpdateMany).toHaveBeenLastCalledWith({
        where: { id: { in: ['old-attempt-mem'] }, personalityId: 'personality-1', isLocked: false },
        data: { visibility: 'deleted' },
      });
      expect(mockPropagate).toHaveBeenCalledWith(prisma);
    });

    it('409s ATTEMPT_ABORTED without writing when an abort tombstoned this attempt', async () => {
      historyFindUnique.mockResolvedValue({
        messageMetadata: { abortedRerollAttempts: ['older', 'attempt-1'] },
      });

      const { status, json } = await run(handleRerollAssistantMessage, commitBody);

      expect(status).toHaveBeenCalledWith(409);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ATTEMPT_ABORTED' }));
      expect(historyUpdate).not.toHaveBeenCalled();
      expect(historyCreate).not.toHaveBeenCalled();
      expect(memoryUpdateMany).not.toHaveBeenCalled();
    });

    it('answers ROW_CHANGED and creates nothing when the row was soft-deleted between the re-read and the transaction', async () => {
      historyUpdate.mockResolvedValueOnce({ count: 0 });

      const { status, json } = await run(handleRerollAssistantMessage, commitBody);

      expect(status).toHaveBeenCalledWith(409);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ROW_CHANGED' }));
      expect(historyCreate).not.toHaveBeenCalled();
      expect(memoryUpdateMany).not.toHaveBeenCalled();
      expect(mockPropagate).not.toHaveBeenCalled();
    });

    it('skips fact propagation when no memory was removed', async () => {
      mockPlan.mockResolvedValueOnce({ kind: 'none' });
      memoryUpdateMany.mockResolvedValueOnce({ count: 0 });

      await run(handleRerollAssistantMessage, commitBody);

      expect(mockPropagate).not.toHaveBeenCalled();
    });
  });

  describe('reroll abort', () => {
    const abortBody = {
      rowId: 'row-1',
      attemptId: 'attempt-1',
      jobId: 'job-1',
      newMemoryIds: ['a', 'b'],
      newPendingIds: ['p'],
      keepMemoryIds: ['b'],
    };

    it('404s a row outside the owner scope', async () => {
      findFirst.mockResolvedValueOnce(null);

      const { status } = await run(handleAbortRerollAssistantMessage, abortBody);

      expect(status).toHaveBeenCalledWith(404);
      expect(memoryUpdateMany).not.toHaveBeenCalled();
    });

    const abortRow = { ...ROW, persona: { ownerId: 'owner-1' } };
    beforeEach(() => {
      findFirst.mockImplementation(async (args: { where: { id?: unknown } }) =>
        args.where.id !== undefined && args.where.id !== 'row-1' ? null : abortRow
      );
    });

    it('removes new minus keep for the row user and personality (any persona), inside one locked transaction', async () => {
      const { json } = await run(handleAbortRerollAssistantMessage, abortBody);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(callOrder).toEqual(['read-job-results', 'lock', 'respond']);
      expect(memoryUpdateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['a'] },
          personalityId: 'personality-1',
          persona: { ownerId: 'owner-1' },
          isLocked: false,
        },
        data: { visibility: 'deleted' },
      });
      expect(pendingDeleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['p'] }, personaId: 'persona-1', personalityId: 'personality-1' },
      });
      expect(json).toHaveBeenCalledWith({
        removedMemories: 1,
        committed: false,
        oldRowLive: true,
        oldRowContentDigest: sha256Hex('OLD'),
      });
    });

    it('reports the old row as not live, with no digest, when it was already soft-deleted', async () => {
      historyFindUnique.mockResolvedValue({
        messageMetadata: {},
        content: 'OLD',
        deletedAt: new Date('2026-06-04T13:00:00.000Z'),
      });

      const { json } = await run(handleAbortRerollAssistantMessage, abortBody);

      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ committed: false, oldRowLive: false, oldRowContentDigest: null })
      );
    });

    it('runs the abort in a transaction with explicit options derived from the resolved pool lock_timeout', async () => {
      await run(handleAbortRerollAssistantMessage, abortBody);

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        timeout: resolveMainLockTimeoutMs() * 5,
        maxWait: resolveMainLockTimeoutMs(),
      });
      expect(REROLL_TRANSACTION_TIMEOUT_MS).toBeGreaterThan(resolveMainLockTimeoutMs());
    });

    it('reads the job results OUTSIDE the transaction, before the row lock; only the successor lookup runs under it', async () => {
      historyFindUnique.mockResolvedValue({
        messageMetadata: {},
        content: 'OLD',
        deletedAt: new Date('2026-06-04T13:00:00.000Z'),
      });
      preLockQueryRaw.mockImplementation(async () => {
        callOrder.push('read-job-results');
        return [
          {
            job_id: 'job-y',
            result: {
              metadata: {
                rerollMemory: {
                  rowId: 'row-1',
                  attemptId: 'attempt-y',
                  memoryIds: ['a'],
                  pendingIds: [],
                },
              },
            },
          },
        ];
      });
      historyFindMany.mockImplementation(async () => {
        callOrder.push('successor-lookup');
        return [];
      });

      await run(handleAbortRerollAssistantMessage, abortBody);

      expect(callOrder.slice(0, 3)).toEqual(['read-job-results', 'lock', 'successor-lookup']);
      expect(preLockQueryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.$transaction.mock.invocationCallOrder[0]
      );
      // Under the lock the transaction client runs only the lock statement, never the job_results scan.
      expect(queryRaw.mock.calls.every(call => String(call[0]).includes('FOR UPDATE'))).toBe(true);
      const [strings] = preLockQueryRaw.mock.calls[0] as [TemplateStringsArray];
      expect(strings.join('?')).toContain('FROM job_results');
      expect(strings.join('?')).toContain('DESC NULLS LAST');
    });

    describe('a late abort after another attempt committed on the row', () => {
      const successorId = generateRerolledConversationHistoryUuid('row-1', 'attempt-y');
      const committedJob = {
        job_id: 'job-y',
        result: {
          metadata: {
            rerollMemory: {
              rowId: 'row-1',
              attemptId: 'attempt-y',
              memoryIds: ['a'],
              pendingIds: ['p'],
            },
          },
        },
      };
      beforeEach(() => {
        jobResultFindUnique.mockResolvedValue(jobRecord());
        historyFindUnique.mockResolvedValue({
          messageMetadata: {},
          content: 'OLD',
          deletedAt: new Date('2026-06-04T13:00:00.000Z'),
        });
        preLockQueryRaw.mockImplementation(async () => {
          callOrder.push('read-job-results');
          return [committedJob];
        });
        historyFindMany.mockResolvedValue([{ id: successorId }]);
      });

      it('leaves every memory and pending the committed attempt lists', async () => {
        await run(handleAbortRerollAssistantMessage, abortBody);

        expect(historyFindMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ id: { in: [successorId] }, deletedAt: null }),
          })
        );
        expect(memoryUpdateMany.mock.calls[0][0].where.id).toEqual({ in: ['c'] });
        expect(pendingDeleteMany.mock.calls[0][0].where.id).toEqual({ in: ['q'] });
      });

      it('excludes nothing when no listed successor is live (the old row was deleted otherwise)', async () => {
        historyFindMany.mockResolvedValue([]);

        await run(handleAbortRerollAssistantMessage, abortBody);

        expect(memoryUpdateMany.mock.calls[0][0].where.id).toEqual({ in: ['a', 'c'] });
      });

      it('does not look for a committed attempt while the old row is still live', async () => {
        historyFindUnique.mockResolvedValue({
          messageMetadata: {},
          content: 'OLD',
          deletedAt: null,
        });

        await run(handleAbortRerollAssistantMessage, abortBody);

        expect(historyFindMany).not.toHaveBeenCalled();
      });
    });

    const jobRecord = (over: Record<string, unknown> = {}) => ({
      result: {
        metadata: {
          rerollMemory: {
            rowId: 'row-1',
            attemptId: 'attempt-1',
            memoryIds: ['a', 'c'],
            pendingIds: ['p', 'q'],
            ...over,
          },
        },
      },
    });

    it('takes the attempt ids from the job result when its row and attempt match, for any persona', async () => {
      jobResultFindUnique.mockResolvedValue(jobRecord());

      await run(handleAbortRerollAssistantMessage, {
        ...abortBody,
        newMemoryIds: ['forged'],
        newPendingIds: ['forged-p'],
      });

      expect(jobResultFindUnique).toHaveBeenCalledWith({
        where: { jobId: 'job-1' },
        select: { result: true },
      });
      expect(memoryUpdateMany).toHaveBeenCalledWith({
        where: { id: { in: ['a', 'c'] }, personalityId: 'personality-1', isLocked: false },
        data: { visibility: 'deleted' },
      });
      expect(pendingDeleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['p', 'q'] }, personalityId: 'personality-1' },
      });
    });

    it('still honours the keep set on a match', async () => {
      jobResultFindUnique.mockResolvedValue(jobRecord());

      await run(handleAbortRerollAssistantMessage, { ...abortBody, keepMemoryIds: ['a'] });

      expect(memoryUpdateMany.mock.calls[0][0].where.id).toEqual({ in: ['c'] });
    });

    it.each([
      ['another attempt', { attemptId: 'attempt-2' }],
      ['another row', { rowId: 'row-9' }],
    ])(
      'falls back to the caller ids for the requesting user, warning, when the job result is for %s',
      async (_label, over) => {
        jobResultFindUnique.mockResolvedValue(jobRecord(over));

        await run(handleAbortRerollAssistantMessage, abortBody);

        expect(memoryUpdateMany).toHaveBeenCalledWith({
          where: {
            id: { in: ['a'] },
            personalityId: 'personality-1',
            persona: { ownerId: 'owner-1' },
            isLocked: false,
          },
          data: { visibility: 'deleted' },
        });
        expect(mockWarn).toHaveBeenCalledWith(
          expect.objectContaining({ jobId: 'job-1', reason: 'mismatch' }),
          expect.any(String)
        );
      }
    );

    it('falls back to the caller ids, warning, when there is no job result', async () => {
      const { json } = await run(handleAbortRerollAssistantMessage, abortBody);

      expect(memoryUpdateMany.mock.calls[0][0].where.persona).toEqual({ ownerId: 'owner-1' });
      expect(mockWarn).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: 'job-1', reason: 'missing' }),
        expect.any(String)
      );
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ removedMemories: 1, committed: false })
      );
    });

    it('records the attempt as a tombstone on the old row, keeping other metadata and the last 10', async () => {
      const older = Array.from({ length: 10 }, (_, i) => `old-${i}`);
      historyFindUnique.mockResolvedValue({
        messageMetadata: { incognito: true, abortedRerollAttempts: older },
      });

      await run(handleAbortRerollAssistantMessage, abortBody);

      expect(mockMerge).toHaveBeenCalledWith(
        tx,
        'row-1',
        { abortedRerollAttempts: [...older.slice(1), 'attempt-1'] },
        { operation: 'reroll-abort-tombstone' }
      );
    });

    it('removes nothing and answers no success when the tombstone could not be written', async () => {
      mockMerge.mockResolvedValue('failed');

      const { status, json } = await run(handleAbortRerollAssistantMessage, abortBody);

      expect(memoryUpdateMany).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(500);
      expect(json).not.toHaveBeenCalledWith(
        expect.objectContaining({ committed: expect.anything() })
      );
    });

    it('removes nothing and reports committed when the attempt row is already live', async () => {
      findFirst.mockImplementation(async (args: { where: { id?: unknown } }) =>
        args.where.id === 'row-1' ? abortRow : { id: 'landed' }
      );

      const { json } = await run(handleAbortRerollAssistantMessage, abortBody);

      expect(json).toHaveBeenCalledWith({
        removedMemories: 0,
        committed: true,
        oldRowLive: false,
        oldRowContentDigest: null,
      });
      expect(memoryUpdateMany).not.toHaveBeenCalled();
      expect(pendingDeleteMany).not.toHaveBeenCalled();
      expect(mockMerge).not.toHaveBeenCalled();
    });
  });
});

describe('rerollTransactionOptions (derived from the RESOLVED pool lock_timeout)', () => {
  it('uses the default lock timeout when the env is unset (never below the Prisma defaults)', () => {
    expect(rerollTransactionOptions({})).toEqual({
      timeout: Math.max(5000, resolveMainLockTimeoutMs({}) * 5),
      maxWait: Math.max(2000, resolveMainLockTimeoutMs({})),
    });
  });

  it('floors both at the Prisma defaults (5000 / 2000) when the lock timeout is tiny', () => {
    expect(rerollTransactionOptions({ DB_MAIN_LOCK_TIMEOUT_MS: '200' })).toEqual({
      timeout: 5000,
      maxWait: 2000,
    });
  });

  it('follows DB_MAIN_LOCK_TIMEOUT_MS: a raised lock timeout raises both, keeping timeout above the lock wait', () => {
    const options = rerollTransactionOptions({ DB_MAIN_LOCK_TIMEOUT_MS: '10000' });

    expect(options).toEqual({ timeout: 50_000, maxWait: 10_000 });
    expect(options.timeout).toBeGreaterThan(
      resolveMainLockTimeoutMs({ DB_MAIN_LOCK_TIMEOUT_MS: '10000' })
    );
  });

  it('falls back to the default for an unusable override, as the pool does', () => {
    expect(rerollTransactionOptions({ DB_MAIN_LOCK_TIMEOUT_MS: 'abc' })).toEqual(
      rerollTransactionOptions({})
    );
  });

  it('is what the module-level options resolved from the process env', () => {
    expect(REROLL_TRANSACTION_OPTIONS).toEqual(rerollTransactionOptions());
  });
});
