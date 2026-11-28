import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import type { LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';
import type { RerollJobContext } from '../services/JobTracker.js';
import type { RerollPreflight } from '../services/character/rerollTurn.js';
import {
  REROLL_BOOT_ID,
  REROLL_INFLIGHT_MIN_AGE_MS,
} from '../services/character/rerollInflight.js';
import {
  REROLL_MAX_CONTENT_LENGTH,
  REROLL_MAX_THINKING_LENGTH,
} from '@tzurot/common-types/constants/discord';
import { API_ERROR_SUBCODE } from '@tzurot/common-types/constants/error';
import {
  handleRerollJobResult,
  handleUnknownRerollResult,
  PARTIAL_REROLLED_MESSAGE,
  REROLLED_MESSAGE,
  RESTORED_MESSAGE,
  SAVE_FAILED_MESSAGE,
  TOO_LONG_MESSAGE,
} from './rerollResultHandler.js';

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  commit: vi.fn(),
  abort: vi.fn(),
  fetchLiveChunks: vi.fn(),
  resolveTarget: vi.fn(),
  beginEdit: vi.fn(),
  finishEdit: vi.fn(),
  restoreEdit: vi.fn(),
  releaseRerollGuard: vi.fn(),
  takeRerollJob: vi.fn(),
  deleteJob: vi.fn(),
  schedule: vi.fn(),
  markHandled: vi.fn(),
  handledBy: vi.fn(),
  peekInflight: vi.fn(),
  handOff: vi.fn(),
  fetchUser: vi.fn(),
  replySpecSafe: vi.fn(),
  updateDiagnosticResponseIds: vi.fn(),
  writeInflight: vi.fn(),
  appendInflightExtra: vi.fn(),
  deleteInflight: vi.fn(),
}));

vi.mock('../redis.js', () => ({ redis: {} }));
// Only the Redis operations are replaced; the record builder (and the boot id it stamps) is real.
vi.mock('../services/character/rerollInflight.js', async () => {
  const actual = await vi.importActual<typeof import('../services/character/rerollInflight.js')>(
    '../services/character/rerollInflight.js'
  );
  return {
    ...actual,
    writeInflight: mocks.writeInflight,
    appendInflightExtra: mocks.appendInflightExtra,
    deleteInflight: mocks.deleteInflight,
    peekInflight: mocks.peekInflight,
  };
});
vi.mock('../services/character/rerollGuard.js', () => ({
  releaseRerollGuard: mocks.releaseRerollGuard,
  takeRerollJob: mocks.takeRerollJob,
  deleteRerollJob: mocks.deleteJob,
  markRerollJobHandled: mocks.markHandled,
  rerollJobHandledBy: mocks.handledBy,
}));
vi.mock('../services/character/rerollRecovery.js', () => ({
  handOffToRecovery: mocks.handOff,
  defaultSchedule: mocks.schedule,
}));
vi.mock('../utils/gatewayClients.js', () => ({
  clientsForUser: () => ({
    userClient: {
      checkRerollAssistantMessage: mocks.check,
      rerollAssistantMessage: mocks.commit,
      abortRerollAssistantMessage: mocks.abort,
    },
  }),
}));
vi.mock('../utils/editResponse/liveTarget.js', () => ({
  fetchLiveChunks: mocks.fetchLiveChunks,
  resolveTarget: mocks.resolveTarget,
}));
vi.mock('../utils/editResponse/discordEdit.js', () => ({
  beginEditedChunks: mocks.beginEdit,
  finishEditedChunks: mocks.finishEdit,
  restoreEditedChunks: mocks.restoreEdit,
}));
vi.mock('../utils/gatewayServiceCalls.js', () => ({
  updateDiagnosticResponseIds: mocks.updateDiagnosticResponseIds,
}));
vi.mock('../ux/render/reply.js', () => ({ replySpecSafe: mocks.replySpecSafe }));

const redis = {} as Redis;
const OLD_IDS = ['222222222222222222', '333333333333333333'];

const preflight: RerollPreflight = {
  rowId: 'row-1',
  personalityId: 'pers-1',
  personaId: 'persona-1',
  ownerDiscordId: 'owner',
  incognito: false,
  content: 'old',
  discordMessageIds: OLD_IDS,
  trigger: null,
  memoryPlan: { kind: 'remove', memoryIds: ['old-mem'], pendingIds: [] },
} satisfies RerollPreflight;

function makeCtx(): RerollJobContext {
  return {
    kind: 'reroll',
    interaction: { user: { id: 'clicker' }, client: {} },
    channel: { id: 'chan-1' },
    rowId: 'row-1',
    attemptId: 'attempt-1',
    preflight,
  } as unknown as RerollJobContext;
}

function makeResult(overrides: Partial<LLMGenerationResult> = {}): LLMGenerationResult {
  return {
    requestId: 'req-1',
    success: true,
    content: 'new reply',
    metadata: {
      modelUsed: 'model-B',
      rerollMemory: { memoryIds: ['new-mem'], pendingIds: ['new-pending'] },
    },
    ...overrides,
  } as unknown as LLMGenerationResult;
}

/** A handled marker as the guard reads it back: this boot's, set just now. */
const thisBoot = (): { bootId: string; markedAt: number } => ({
  bootId: REROLL_BOOT_ID,
  markedAt: Date.now(),
});

const lastReplyText = (): string => JSON.stringify(mocks.replySpecSafe.mock.calls.at(-1)?.[1]);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.check.mockResolvedValue({
    ok: true,
    data: { ...preflight, memoryPlan: { kind: 'remove', memoryIds: ['old-mem'], pendingIds: [] } },
  });
  mocks.fetchLiveChunks.mockResolvedValue({
    channel: {},
    chunks: [
      { id: OLD_IDS[0], content: 'old chunk 1' },
      { id: OLD_IDS[1], content: 'old chunk 2' },
    ],
  });
  mocks.writeInflight.mockResolvedValue(true);
  mocks.deleteJob.mockResolvedValue(undefined);
  mocks.appendInflightExtra.mockResolvedValue(undefined);
  mocks.deleteInflight.mockResolvedValue(undefined);
  mocks.resolveTarget.mockResolvedValue({ target: {}, dmPrefix: '' });
  mocks.beginEdit.mockResolvedValue({ ok: true, messageIds: OLD_IDS, partial: false });
  mocks.finishEdit.mockResolvedValue({ ok: true, survivorIds: [] });
  mocks.restoreEdit.mockResolvedValue(true);
  mocks.takeRerollJob.mockResolvedValue(null);
  mocks.handledBy.mockResolvedValue(null);
  mocks.peekInflight.mockResolvedValue(null);
  mocks.commit.mockResolvedValue({ ok: true, data: { id: 'row-1', removedMemories: 1 } });
  mocks.abort.mockResolvedValue({ ok: true, data: { removedMemories: 2, committed: false } });
  mocks.updateDiagnosticResponseIds.mockResolvedValue(undefined);
  mocks.replySpecSafe.mockResolvedValue(undefined);
});

describe('handleRerollJobResult', () => {
  it('commits with the new memory ids, replies success, records diagnostics and releases the guard', async () => {
    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    expect(mocks.commit).toHaveBeenCalledWith(
      OLD_IDS[0],
      expect.objectContaining({
        rowId: 'row-1',
        attemptId: 'attempt-1',
        jobId: 'job-1',
        content: 'new reply',
        discordMessageIds: OLD_IDS,
        newMemoryIds: ['new-mem'],
        newPendingIds: ['new-pending'],
      })
    );
    expect(mocks.abort).not.toHaveBeenCalled();
    expect(mocks.updateDiagnosticResponseIds).toHaveBeenCalledWith('req-1', OLD_IDS);
    expect(lastReplyText()).toContain(REROLLED_MESSAGE);
    expect(mocks.releaseRerollGuard).toHaveBeenCalledWith(redis, 'row-1', 'attempt-1');
  });

  it('re-runs the preflight excluding the new reply memories', async () => {
    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    expect(mocks.check).toHaveBeenCalledWith(OLD_IDS[0], {
      excludeMemoryIds: ['new-mem'],
      excludePendingIds: ['new-pending'],
    });
  });

  it('replies with the partial variant when some chunks could not be updated', async () => {
    mocks.beginEdit.mockResolvedValue({ ok: true, messageIds: OLD_IDS, partial: true });

    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    expect(lastReplyText()).toContain(PARTIAL_REROLLED_MESSAGE);
  });

  it('rebuilds the footer from the new result, never the old message', async () => {
    mocks.fetchLiveChunks.mockResolvedValue({
      channel: {},
      chunks: [{ id: OLD_IDS[0], content: 'old\n-# Model: model-A' }],
    });

    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    const newChunks = mocks.beginEdit.mock.calls[0][2] as string[];
    const joined = newChunks.join('\n');
    expect(joined).toContain('model-B');
    expect(joined).not.toContain('model-A');
  });

  it('on a Discord edit failure aborts the memories and never commits', async () => {
    mocks.beginEdit.mockResolvedValue({ ok: false, reason: 'error' });

    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    expect(mocks.abort).toHaveBeenCalledWith(OLD_IDS[0], {
      rowId: 'row-1',
      attemptId: 'attempt-1',
      jobId: 'job-1',
      newMemoryIds: ['new-mem'],
      newPendingIds: ['new-pending'],
      keepMemoryIds: ['old-mem'],
    });
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.releaseRerollGuard).toHaveBeenCalledTimes(1);
  });

  it('on a commit failure that did not land, aborts, restores, and says the original was put back', async () => {
    mocks.commit.mockResolvedValue({ ok: false, status: 503, error: 'x', kind: 'http' });

    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    expect(mocks.abort).toHaveBeenCalledTimes(1);
    expect(lastReplyText()).toContain(RESTORED_MESSAGE);
    expect(mocks.releaseRerollGuard).toHaveBeenCalledTimes(1);
  });

  it('on a failed generation replies with the error, never edits or commits, and releases the guard', async () => {
    const failed = makeResult({ success: false, content: '', error: 'boom' } as never);

    await handleRerollJobResult('job-1', failed, makeCtx(), { redis });

    expect(mocks.beginEdit).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.replySpecSafe).toHaveBeenCalledTimes(1);
    expect(mocks.releaseRerollGuard).toHaveBeenCalledWith(redis, 'row-1', 'attempt-1');
  });

  it('does not call abort for a failed generation that wrote no memory', async () => {
    const failed = makeResult({ success: false, content: '', metadata: {} } as never);

    await handleRerollJobResult('job-1', failed, makeCtx(), { redis });

    expect(mocks.abort).not.toHaveBeenCalled();
  });

  it('aborts when the preflight re-check now blocks the reroll', async () => {
    mocks.check.mockResolvedValue({
      ok: true,
      data: { ...preflight, memoryPlan: { kind: 'blocked', reason: 'locked' } },
    });

    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    expect(mocks.abort).toHaveBeenCalledTimes(1);
    expect(mocks.beginEdit).not.toHaveBeenCalled();
    expect(lastReplyText()).toContain('locked');
  });

  it('aborts when the row changed during generation', async () => {
    mocks.check.mockResolvedValue({ ok: true, data: { ...preflight, rowId: 'row-other' } });

    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    expect(mocks.abort).toHaveBeenCalledTimes(1);
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it('aborts when the live message cannot be resolved', async () => {
    mocks.fetchLiveChunks.mockResolvedValue(null);

    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    expect(mocks.abort).toHaveBeenCalledTimes(1);
    expect(mocks.beginEdit).not.toHaveBeenCalled();
  });

  it('commits a multi-chunk reply past the Edit Response cap', async () => {
    await handleRerollJobResult('job-1', makeResult({ content: 'x'.repeat(6000) }), makeCtx(), {
      redis,
    });

    expect(mocks.abort).not.toHaveBeenCalled();
    expect((mocks.beginEdit.mock.calls[0][2] as string[]).length).toBeGreaterThan(1);
    expect(mocks.commit).toHaveBeenCalledWith(
      OLD_IDS[0],
      expect.objectContaining({ content: 'x'.repeat(6000) })
    );
  });

  it('aborts before touching Discord when the new reply exceeds the reroll bound', async () => {
    await handleRerollJobResult(
      'job-1',
      makeResult({ content: 'x'.repeat(REROLL_MAX_CONTENT_LENGTH + 1) }),
      makeCtx(),
      { redis }
    );

    expect(mocks.beginEdit).not.toHaveBeenCalled();
    expect(mocks.abort).toHaveBeenCalledTimes(1);
    expect(lastReplyText()).toContain(TOO_LONG_MESSAGE);
  });

  it('aborts and releases the guard when delivery throws', async () => {
    mocks.beginEdit.mockRejectedValue(new Error('network'));

    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    expect(mocks.abort).toHaveBeenCalledTimes(1);
    expect(mocks.releaseRerollGuard).toHaveBeenCalledTimes(1);
  });
});

describe('commit refusals, restore and the post-commit phase', () => {
  const refusal = (status: number, code?: string) => ({
    ok: false,
    status,
    error: 'x',
    kind: 'http',
    code,
  });
  const timeout = { ok: false, status: 0, error: 'timeout', kind: 'timeout' };
  const abortAnswer = (committed: boolean) => ({
    ok: true,
    data: { removedMemories: 0, committed },
  });

  it('after a landed commit runs phase 2 once, and only after the commit call', async () => {
    const order: string[] = [];
    mocks.commit.mockImplementation(async () => {
      order.push('commit');
      return { ok: true, data: { id: 'row-1', removedMemories: 1 } };
    });
    mocks.finishEdit.mockImplementation(async () => {
      order.push('finish');
      return { ok: true, survivorIds: [] };
    });

    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    expect(order).toEqual(['commit', 'finish']);
    expect(mocks.restoreEdit).not.toHaveBeenCalled();
  });

  it('still succeeds when phase 2 reports leftovers (logged, not surfaced)', async () => {
    mocks.finishEdit.mockResolvedValue({ ok: false, survivorIds: ['333333333333333333'] });

    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    expect(lastReplyText()).toContain(REROLLED_MESSAGE);
  });

  it.each([
    [400, undefined],
    [403, undefined],
    [409, API_ERROR_SUBCODE.NOT_LATEST],
    [409, API_ERROR_SUBCODE.ROW_CHANGED],
    [409, API_ERROR_SUBCODE.MEMORY_BLOCKED],
    [409, API_ERROR_SUBCODE.ATTEMPT_ABORTED],
  ])(
    'restores, then aborts, on a definite %i refusal (%s), and says the original was put back',
    async (status, code) => {
      const order: string[] = [];
      mocks.commit.mockResolvedValue(refusal(status, code));
      mocks.restoreEdit.mockImplementation(async () => {
        order.push('restore');
        return true;
      });
      mocks.abort.mockImplementation(async () => {
        order.push('abort');
        return abortAnswer(false);
      });
      mocks.deleteInflight.mockImplementation(async () => {
        order.push('delete');
      });

      await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

      // The record outlives the abort the refusal still owes.
      expect(order).toEqual(['restore', 'abort', 'delete']);
      expect(mocks.finishEdit).not.toHaveBeenCalled();
      expect(lastReplyText()).toContain(RESTORED_MESSAGE);
      expect(mocks.releaseRerollGuard).toHaveBeenCalledTimes(1);
    }
  );

  it('keeps the old copy when the restore failed', async () => {
    mocks.commit.mockResolvedValue(refusal(409, API_ERROR_SUBCODE.NOT_LATEST));
    mocks.restoreEdit.mockResolvedValue(false);

    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    expect(lastReplyText()).toContain(SAVE_FAILED_MESSAGE);
    expect(lastReplyText()).not.toContain(RESTORED_MESSAGE);
  });

  it.each([
    ['a timeout', timeout],
    ['a 500', refusal(500)],
    ['a 503', refusal(503)],
    ['a 408', refusal(408)],
    ['a 429', refusal(429)],
  ])('settles %s through the abort, not by restoring blindly', async (_name, failure) => {
    mocks.commit.mockResolvedValue(failure);
    mocks.abort.mockResolvedValue(abortAnswer(false));

    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    expect(mocks.abort).toHaveBeenCalledTimes(1);
    expect(mocks.restoreEdit).toHaveBeenCalledTimes(1);
    expect(mocks.finishEdit).not.toHaveBeenCalled();
    expect(lastReplyText()).toContain(RESTORED_MESSAGE);
  });

  it('timeout then abort committed:true: success reply AND phase 2 runs, no restore', async () => {
    mocks.commit.mockResolvedValue(timeout);
    mocks.abort.mockResolvedValue(abortAnswer(true));

    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    expect(lastReplyText()).toContain(REROLLED_MESSAGE);
    expect(mocks.finishEdit).toHaveBeenCalledTimes(1);
    expect(mocks.restoreEdit).not.toHaveBeenCalled();
    expect(mocks.releaseRerollGuard).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['refused', { ok: false, status: 500, error: 'x', kind: 'http' }],
    ['unreachable', null],
  ])('timeout then an abort that is %s: neither restore nor phase 2', async (_name, answer) => {
    mocks.commit.mockResolvedValue(timeout);
    if (answer === null) {
      mocks.abort.mockRejectedValue(new Error('down'));
    } else {
      mocks.abort.mockResolvedValue(answer);
    }

    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    expect(mocks.restoreEdit).not.toHaveBeenCalled();
    expect(mocks.finishEdit).not.toHaveBeenCalled();
    expect(lastReplyText()).toContain(SAVE_FAILED_MESSAGE);
  });

  it('records the incognito kind on the commit: the result kind, else the preflight kind', async () => {
    await handleRerollJobResult(
      'job-1',
      makeResult({
        metadata: { incognitoModeActive: true, incognitoKind: 'session' },
      } as never),
      makeCtx(),
      { redis }
    );
    mocks.check.mockResolvedValue({
      ok: true,
      data: { ...preflight, incognito: true, incognitoKind: 'summon' },
    });
    await handleRerollJobResult('job-2', makeResult({ metadata: {} } as never), makeCtx(), {
      redis,
    });

    expect(mocks.commit.mock.calls[0][1]).toEqual(
      expect.objectContaining({ incognito: true, incognitoKind: 'session' })
    );
    expect(mocks.commit.mock.calls[1][1]).toEqual(
      expect.objectContaining({ incognito: true, incognitoKind: 'summon' })
    );
  });

  it('drops a reasoning trace over the commit bound rather than failing the reroll on it', async () => {
    const trace = 'x'.repeat(REROLL_MAX_THINKING_LENGTH + 1);

    await handleRerollJobResult(
      'job-1',
      makeResult({ metadata: { thinkingContent: trace } } as never),
      makeCtx(),
      { redis }
    );
    await handleRerollJobResult(
      'job-2',
      makeResult({ metadata: { thinkingContent: 'short trace' } } as never),
      makeCtx(),
      { redis }
    );

    expect(mocks.commit.mock.calls[0][1]).toEqual(
      expect.objectContaining({ thinkingContent: null })
    );
    expect(mocks.commit.mock.calls[1][1]).toEqual(
      expect.objectContaining({ thinkingContent: 'short trace' })
    );
  });

  it('sends no kind for a non-incognito reply, even if the preflight carried a stale one', async () => {
    mocks.check.mockResolvedValue({
      ok: true,
      data: { ...preflight, incognito: false, incognitoKind: 'session' },
    });

    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    expect(mocks.commit.mock.calls[0][1]).not.toHaveProperty('incognitoKind');
  });

  describe('duplicate delivery', () => {
    const record = {
      rowId: 'row-1',
      attemptId: 'attempt-1',
      routeKey: OLD_IDS[0],
      actorId: 'clicker',
      keepMemoryIds: ['old-mem'],
    };

    it('a second delivery during the in-flight commit aborts nothing and leaves the guard to the first', async () => {
      let stored: typeof record | null = record;
      mocks.takeRerollJob.mockImplementation(async () => {
        const taken = stored;
        stored = null;
        return taken;
      });
      mocks.fetchUser.mockResolvedValue({ id: 'clicker' });
      const handled = new Set<string>();
      mocks.markHandled.mockImplementation(async (_redis: unknown, id: string) => {
        handled.add(id);
      });
      mocks.handledBy.mockImplementation(async (_redis: unknown, id: string) =>
        handled.has(id) ? thisBoot() : null
      );
      let finishCommit: (value: unknown) => void = () => undefined;
      mocks.commit.mockReturnValue(new Promise(resolve => (finishCommit = resolve)));

      const first = handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });
      await vi.waitFor(() => expect(mocks.commit).toHaveBeenCalledTimes(1));
      const second = await handleUnknownRerollResult(
        'job-1',
        makeResult(),
        { users: { fetch: mocks.fetchUser } } as never,
        { redis }
      );

      // Answered as handled ('delivered' upstream), not as a genuine loss.
      expect(second).toBe(true);
      expect(mocks.abort).not.toHaveBeenCalled();
      expect(mocks.releaseRerollGuard).not.toHaveBeenCalled();

      finishCommit({ ok: true, data: { id: 'row-1', removedMemories: 1 } });
      await first;

      expect(mocks.commit).toHaveBeenCalledTimes(1);
      expect(mocks.abort).not.toHaveBeenCalled();
      expect(mocks.releaseRerollGuard).toHaveBeenCalledTimes(1);
    });

    it('marks the job handled before the first gateway call, and never takes the job record up front', async () => {
      const order: string[] = [];
      mocks.markHandled.mockImplementation(async () => {
        order.push('mark');
      });
      mocks.check.mockImplementation(async () => {
        order.push('check');
        return { ok: true, data: preflight };
      });

      await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

      expect(order.slice(0, 2)).toEqual(['mark', 'check']);
      expect(mocks.takeRerollJob).not.toHaveBeenCalled();
    });

    it('a same-boot duplicate answers true and leaves the record to the tracked path', async () => {
      mocks.handledBy.mockResolvedValue(thisBoot());
      mocks.takeRerollJob.mockResolvedValue(record);

      const answer = await handleUnknownRerollResult('job-1', makeResult(), {} as never, {
        redis,
      });

      expect(answer).toBe(true);
      expect(mocks.takeRerollJob).not.toHaveBeenCalled();
      expect(mocks.abort).not.toHaveBeenCalled();
      expect(mocks.releaseRerollGuard).not.toHaveBeenCalled();
    });

    it('the unknown path never sets the handled marker, so a genuinely lost result stays a loss', async () => {
      mocks.handledBy.mockResolvedValue(null);
      mocks.takeRerollJob.mockResolvedValue(record);
      mocks.fetchUser.mockResolvedValue({ id: 'clicker' });

      await handleUnknownRerollResult(
        'job-1',
        makeResult(),
        { users: { fetch: mocks.fetchUser } } as never,
        { redis }
      );
      expect(mocks.markHandled).not.toHaveBeenCalled();

      // The next delivery finds no record and no marker: answered false (a loss).
      mocks.takeRerollJob.mockResolvedValue(null);
      await expect(
        handleUnknownRerollResult('job-1', makeResult(), {} as never, { redis })
      ).resolves.toBe(false);
    });

    it('a result that was neither tracked nor handled is still reported as not a reroll', async () => {
      mocks.takeRerollJob.mockResolvedValue(null);
      mocks.handledBy.mockResolvedValue(null);

      await expect(
        handleUnknownRerollResult('job-9', makeResult(), {} as never, { redis })
      ).resolves.toBe(false);
    });

    describe('a marker written by another boot, old enough that its handler is dead', () => {
      const deadClient = { users: { fetch: mocks.fetchUser } } as never;
      beforeEach(() => {
        mocks.handledBy.mockResolvedValue({
          bootId: 'boot-dead',
          markedAt: Date.now() - REROLL_INFLIGHT_MIN_AGE_MS - 1,
        });
        mocks.fetchUser.mockResolvedValue({ id: 'clicker' });
      });

      it('with an in-flight record: leaves it to recovery and answers true, touching nothing', async () => {
        mocks.peekInflight.mockResolvedValue({ jobId: 'job-1' });
        mocks.takeRerollJob.mockResolvedValue(record);

        const answer = await handleUnknownRerollResult('job-1', makeResult(), deadClient, {
          redis,
        });

        expect(answer).toBe(true);
        expect(mocks.peekInflight).toHaveBeenCalledWith(redis, 'job-1');
        expect(mocks.takeRerollJob).not.toHaveBeenCalled();
        expect(mocks.abort).not.toHaveBeenCalled();
        expect(mocks.releaseRerollGuard).not.toHaveBeenCalled();
      });

      it('without an in-flight record: takes the job record and aborts the attempt as a lost result would', async () => {
        mocks.peekInflight.mockResolvedValue(null);
        mocks.takeRerollJob.mockResolvedValue(record);

        const answer = await handleUnknownRerollResult('job-1', makeResult(), deadClient, {
          redis,
        });

        expect(answer).toBe(true);
        expect(mocks.abort).toHaveBeenCalledWith(
          OLD_IDS[0],
          expect.objectContaining({ attemptId: 'attempt-1', jobId: 'job-1' })
        );
        expect(mocks.releaseRerollGuard).toHaveBeenCalledWith(redis, 'row-1', 'attempt-1');
      });

      it('without an in-flight record and with no job record either: the handler finished, answers true and aborts nothing', async () => {
        mocks.peekInflight.mockResolvedValue(null);
        mocks.takeRerollJob.mockResolvedValue(null);

        await expect(
          handleUnknownRerollResult('job-1', makeResult(), deadClient, { redis })
        ).resolves.toBe(true);
        expect(mocks.abort).not.toHaveBeenCalled();
        expect(mocks.releaseRerollGuard).not.toHaveBeenCalled();
      });

      it('a crash before writeInflight leaves the job record in the store, and the redelivery aborts the attempt exactly once', async () => {
        // One shared store backs both the take and the delete, so what the tracked
        // path does to the job record is observable.
        let stored: typeof record | null = record;
        mocks.takeRerollJob.mockImplementation(async () => {
          const taken = stored;
          stored = null;
          return taken;
        });
        mocks.deleteJob.mockImplementation(async () => {
          stored = null;
        });
        // The process dies at the first gateway call: that promise never settles,
        // so neither the handler's catch nor its finally ever runs.
        mocks.check.mockReturnValue(new Promise(() => undefined));
        void handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });
        await vi.waitFor(() => expect(mocks.check).toHaveBeenCalledTimes(1));
        expect(stored).not.toBeNull();
        expect(mocks.deleteJob).not.toHaveBeenCalled();
        expect(mocks.abort).not.toHaveBeenCalled();

        // The next boot: the result is redelivered and the other-boot marker is old.
        mocks.peekInflight.mockResolvedValue(null);
        await expect(
          handleUnknownRerollResult('job-1', makeResult(), deadClient, { redis })
        ).resolves.toBe(true);

        expect(mocks.abort).toHaveBeenCalledTimes(1);
        expect(mocks.abort).toHaveBeenCalledWith(
          OLD_IDS[0],
          expect.objectContaining({ attemptId: 'attempt-1', jobId: 'job-1' })
        );
        expect(mocks.releaseRerollGuard).toHaveBeenCalledWith(redis, 'row-1', 'attempt-1');
        expect(stored).toBeNull();
      });
    });

    describe('a marker written by another boot, younger than the minimum age (a live overlap)', () => {
      const youngClient = { users: { fetch: mocks.fetchUser } } as never;
      beforeEach(() => {
        mocks.handledBy.mockResolvedValue({ bootId: 'boot-other', markedAt: Date.now() - 1_000 });
        mocks.fetchUser.mockResolvedValue({ id: 'clicker' });
        mocks.takeRerollJob.mockResolvedValue(record);
      });

      it('is not acted on now: answers true, aborts and takes nothing, and schedules a recheck for the remaining age', async () => {
        await expect(
          handleUnknownRerollResult('job-1', makeResult(), youngClient, { redis })
        ).resolves.toBe(true);

        expect(mocks.takeRerollJob).not.toHaveBeenCalled();
        expect(mocks.abort).not.toHaveBeenCalled();
        expect(mocks.schedule).toHaveBeenCalledTimes(1);
        const delay = mocks.schedule.mock.calls[0][1] as number;
        expect(delay).toBeGreaterThan(REROLL_INFLIGHT_MIN_AGE_MS - 5_000);
        expect(delay).toBeLessThanOrEqual(REROLL_INFLIGHT_MIN_AGE_MS - 1_000);
      });

      it('the recheck re-runs the decision once the marker is old: the lost attempt is aborted then', async () => {
        const injected = vi.fn();
        await handleUnknownRerollResult('job-1', makeResult(), youngClient, {
          redis,
          schedule: injected,
        });
        expect(injected).toHaveBeenCalledTimes(1);
        expect(mocks.abort).not.toHaveBeenCalled();

        mocks.handledBy.mockResolvedValue({
          bootId: 'boot-other',
          markedAt: Date.now() - REROLL_INFLIGHT_MIN_AGE_MS - 1,
        });
        mocks.peekInflight.mockResolvedValue(null);
        await (injected.mock.calls[0][0] as () => Promise<void>)();

        expect(mocks.abort).toHaveBeenCalledWith(
          OLD_IDS[0],
          expect.objectContaining({ attemptId: 'attempt-1', jobId: 'job-1' })
        );
        expect(injected).toHaveBeenCalledTimes(1);
      });
    });

    it('a marker from this boot is a live duplicate even when no in-flight record exists yet', async () => {
      mocks.handledBy.mockResolvedValue(thisBoot());
      mocks.peekInflight.mockResolvedValue(null);

      await expect(
        handleUnknownRerollResult('job-1', makeResult(), {} as never, { redis })
      ).resolves.toBe(true);
      expect(mocks.peekInflight).not.toHaveBeenCalled();
      expect(mocks.takeRerollJob).not.toHaveBeenCalled();
      expect(mocks.abort).not.toHaveBeenCalled();
    });

    describe('the job record is deleted only once the attempt no longer needs it', () => {
      it('after writeInflight succeeded, and before the first Discord edit', async () => {
        const order: string[] = [];
        mocks.writeInflight.mockImplementation(async () => {
          order.push('write');
          return true;
        });
        mocks.deleteJob.mockImplementation(async () => {
          order.push('delete');
        });
        mocks.beginEdit.mockImplementation(async () => {
          order.push('begin');
          return { ok: true, messageIds: OLD_IDS, partial: false };
        });

        await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

        expect(order.slice(0, 3)).toEqual(['write', 'delete', 'begin']);
        expect(mocks.deleteJob).toHaveBeenCalledWith(redis, 'job-1');
      });

      it('not before the in-flight record exists: nothing is deleted at the first gateway call', async () => {
        const seen: number[] = [];
        mocks.check.mockImplementation(async () => {
          seen.push(mocks.deleteJob.mock.calls.length);
          return { ok: true, data: preflight };
        });

        await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

        expect(seen).toEqual([0]);
      });

      it.each([
        [
          'a failed result',
          () => makeResult({ success: false, content: '', error: 'boom' }),
          () => undefined,
        ],
        [
          'a too-long result',
          () => makeResult({ content: 'x'.repeat(REROLL_MAX_CONTENT_LENGTH + 1) }),
          () => undefined,
        ],
        [
          'an early abort (the preflight re-check refuses)',
          () => makeResult(),
          () => mocks.check.mockResolvedValue({ ok: false, status: 409, error: 'x', kind: 'http' }),
        ],
        [
          'a thrown error',
          () => makeResult(),
          () => mocks.check.mockRejectedValue(new Error('boom')),
        ],
      ])(
        'on %s: the attempt ends before a record exists, so the job record goes',
        async (_n, result, arrange) => {
          arrange();

          await handleRerollJobResult('job-1', result(), makeCtx(), { redis });

          expect(mocks.writeInflight).not.toHaveBeenCalled();
          expect(mocks.deleteJob).toHaveBeenCalledWith(redis, 'job-1');
        }
      );

      it('when writeInflight could not store the record the job record still goes at the end of the run', async () => {
        mocks.writeInflight.mockResolvedValue(false);
        const seen: number[] = [];
        mocks.beginEdit.mockImplementation(async () => {
          seen.push(mocks.deleteJob.mock.calls.length);
          return { ok: true, messageIds: OLD_IDS, partial: false };
        });

        await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

        expect(seen).toEqual([0]);
        expect(mocks.deleteJob).toHaveBeenCalledWith(redis, 'job-1');
      });
    });
  });
});

describe('the restart record (reroll:inflight)', () => {
  const refusal = { ok: false, status: 409, error: 'x', kind: 'http', code: 'ROW_CHANGED' };

  it('is written BEFORE the first Discord edit, with everything a restart needs to undo it', async () => {
    const order: string[] = [];
    mocks.writeInflight.mockImplementation(async () => {
      order.push('write');
    });
    mocks.beginEdit.mockImplementation(async () => {
      order.push('begin');
      return { ok: true, messageIds: OLD_IDS, partial: false };
    });

    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    expect(order.slice(0, 2)).toEqual(['write', 'begin']);
    expect(mocks.writeInflight).toHaveBeenCalledWith(redis, {
      jobId: 'job-1',
      rowId: 'row-1',
      attemptId: 'attempt-1',
      bootId: REROLL_BOOT_ID,
      actorId: 'clicker',
      routeKey: OLD_IDS[0],
      keepMemoryIds: ['old-mem'],
      channelId: 'chan-1',
      personalityId: 'pers-1',
      rowContent: 'old',
      chunks: [
        { id: OLD_IDS[0], before: 'old chunk 1' },
        { id: OLD_IDS[1], before: 'old chunk 2' },
      ],
      editedCount: 1,
      extraIds: [],
      newMemoryIds: ['new-mem'],
      newPendingIds: ['new-pending'],
      createdAt: expect.any(Number),
      writtenAt: expect.any(Number),
    });
  });

  it('is kept current: begin gets a callback that appends each extra chunk id to the same record', async () => {
    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    const onExtraSent = mocks.beginEdit.mock.calls[0][4] as (id: string) => Promise<void>;
    await onExtraSent('extra-1');

    const record = mocks.writeInflight.mock.calls[0][1];
    expect(mocks.appendInflightExtra).toHaveBeenCalledWith(redis, record, 'extra-1');
  });

  it('is deleted after a landed commit, once finish has run', async () => {
    const order: string[] = [];
    mocks.finishEdit.mockImplementation(async () => {
      order.push('finish');
      return { ok: true, survivorIds: [] };
    });
    mocks.deleteInflight.mockImplementation(async () => {
      order.push('delete');
    });

    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    expect(order).toEqual(['finish', 'delete']);
    expect(mocks.deleteInflight).toHaveBeenCalledWith(redis, 'job-1');
  });

  it('is deleted after a successful restore, once the restore has run', async () => {
    const order: string[] = [];
    mocks.commit.mockResolvedValue(refusal);
    mocks.restoreEdit.mockImplementation(async () => {
      order.push('restore');
      return true;
    });
    mocks.deleteInflight.mockImplementation(async () => {
      order.push('delete');
    });

    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    expect(order).toEqual(['restore', 'delete']);
  });

  it('is kept when the restore failed, so a restart can finish the repair', async () => {
    mocks.commit.mockResolvedValue(refusal);
    mocks.restoreEdit.mockResolvedValue(false);

    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    expect(mocks.deleteInflight).not.toHaveBeenCalled();
    // ... and handed to this process's recovery retry timer, not left for the next boot.
    expect(mocks.handOff).toHaveBeenCalledTimes(1);
    expect(mocks.handOff).toHaveBeenCalledWith({ client: {}, redis }, 'job-1');
  });

  it('is not handed to recovery once a restore or finish has settled it', async () => {
    mocks.commit.mockResolvedValue(refusal);
    mocks.restoreEdit.mockResolvedValue(true);

    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    expect(mocks.handOff).not.toHaveBeenCalled();
  });

  it('is kept when the abort could not say what happened to the commit (neither restore nor finish ran)', async () => {
    mocks.commit.mockResolvedValue({ ok: false, status: 0, error: 'timeout', kind: 'timeout' });
    mocks.abort.mockRejectedValue(new Error('down'));

    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    expect(mocks.restoreEdit).not.toHaveBeenCalled();
    expect(mocks.finishEdit).not.toHaveBeenCalled();
    expect(mocks.deleteInflight).not.toHaveBeenCalled();
    expect(mocks.handOff).toHaveBeenCalledWith({ client: {}, redis }, 'job-1');
  });

  it('is handed to recovery too when a throw mid-delivery leaves the abort unable to answer', async () => {
    mocks.commit.mockRejectedValue(new Error('boom'));
    mocks.abort.mockRejectedValue(new Error('down'));

    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    expect(mocks.deleteInflight).not.toHaveBeenCalled();
    expect(mocks.handOff).toHaveBeenCalledWith({ client: {}, redis }, 'job-1');
  });

  it('is handed to recovery when begin throws after the record was written (no edit exists to repair from)', async () => {
    mocks.beginEdit.mockRejectedValue(new Error('discord blew up'));

    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    expect(mocks.writeInflight).toHaveBeenCalledTimes(1);
    expect(mocks.handOff).toHaveBeenCalledTimes(1);
    expect(mocks.handOff).toHaveBeenCalledWith({ client: {}, redis }, 'job-1');
    // The throw still lands in the delivery catch: the attempt is aborted.
    expect(mocks.abort).toHaveBeenCalled();
  });

  it('is not handed to recovery when the throw comes before the record is written', async () => {
    mocks.check.mockRejectedValue(new Error('gateway down'));

    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    expect(mocks.writeInflight).not.toHaveBeenCalled();
    expect(mocks.handOff).not.toHaveBeenCalled();
  });

  it('is deleted when the first edit failed (nothing changed on Discord)', async () => {
    mocks.beginEdit.mockResolvedValue({ ok: false, reason: 'error' });

    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    expect(mocks.deleteInflight).toHaveBeenCalledWith(redis, 'job-1');
  });

  it('is deleted only after the abort for a failed first edit has answered', async () => {
    const order: string[] = [];
    mocks.beginEdit.mockResolvedValue({ ok: false, reason: 'error' });
    mocks.abort.mockImplementation(async () => {
      order.push('abort');
      return { ok: true, data: { removedMemories: 2, committed: false } };
    });
    mocks.deleteInflight.mockImplementation(async () => {
      order.push('delete');
    });

    await handleRerollJobResult('job-1', makeResult(), makeCtx(), { redis });

    expect(order).toEqual(['abort', 'delete']);
  });

  it('is never written for a run that fails before Discord is touched', async () => {
    await handleRerollJobResult(
      'job-1',
      makeResult({ success: false, content: '', error: 'boom' }),
      makeCtx(),
      { redis }
    );

    expect(mocks.writeInflight).not.toHaveBeenCalled();
    expect(mocks.beginEdit).not.toHaveBeenCalled();
  });
});

describe('handleUnknownRerollResult', () => {
  const record = {
    rowId: 'row-1',
    attemptId: 'attempt-1',
    routeKey: OLD_IDS[0],
    actorId: 'clicker',
    keepMemoryIds: ['old-mem'],
  };
  const client = { users: { fetch: mocks.fetchUser } } as never;

  beforeEach(() => {
    mocks.takeRerollJob.mockResolvedValue(record);
    mocks.fetchUser.mockResolvedValue({ id: 'clicker' });
  });

  it('returns false and does nothing when the job was not a reroll', async () => {
    mocks.takeRerollJob.mockResolvedValue(null);

    await expect(handleUnknownRerollResult('job-9', makeResult(), client, { redis })).resolves.toBe(
      false
    );
    expect(mocks.abort).not.toHaveBeenCalled();
    expect(mocks.releaseRerollGuard).not.toHaveBeenCalled();
  });

  it('aborts the new memories with the recorded attempt and releases the guard', async () => {
    await expect(handleUnknownRerollResult('job-1', makeResult(), client, { redis })).resolves.toBe(
      true
    );

    expect(mocks.abort).toHaveBeenCalledWith(OLD_IDS[0], {
      rowId: 'row-1',
      attemptId: 'attempt-1',
      jobId: 'job-1',
      newMemoryIds: ['new-mem'],
      newPendingIds: ['new-pending'],
      keepMemoryIds: ['old-mem'],
    });
    expect(mocks.releaseRerollGuard).toHaveBeenCalledWith(redis, 'row-1', 'attempt-1');
  });

  it('still releases the guard when the clicker cannot be fetched', async () => {
    mocks.fetchUser.mockRejectedValue(new Error('gone'));

    await expect(handleUnknownRerollResult('job-1', makeResult(), client, { redis })).resolves.toBe(
      true
    );
    expect(mocks.abort).not.toHaveBeenCalled();
    expect(mocks.releaseRerollGuard).toHaveBeenCalledWith(redis, 'row-1', 'attempt-1');
  });
});
