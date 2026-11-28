import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Prisma } from '@tzurot/common-types/services/prisma';
import {
  liveSuccessorMemory,
  readAttemptMemory,
  readSuccessorCandidates,
  sweepAbandonedAttempts,
} from './rerollJobResult.js';

const mocks = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn() }));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: mocks.info,
      warn: mocks.warn,
      error: vi.fn(),
    }),
  };
});

const key = { jobId: 'job-1', rowId: 'row-1', attemptId: 'attempt-1' };

const stored = (over: Record<string, unknown> = {}) => ({
  result: {
    metadata: {
      rerollMemory: {
        rowId: 'row-1',
        attemptId: 'attempt-1',
        memoryIds: ['m1', 'm2'],
        pendingIds: ['p1'],
        ...over,
      },
    },
  },
});

describe('readAttemptMemory', () => {
  const findUnique = vi.fn();
  const db = { jobResult: { findUnique } } as unknown as Pick<
    Prisma.TransactionClient,
    'jobResult'
  >;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the listed ids when the result is for this row and attempt, selecting only the result', async () => {
    findUnique.mockResolvedValue(stored());

    await expect(readAttemptMemory(db, key)).resolves.toEqual({
      memoryIds: ['m1', 'm2'],
      pendingIds: ['p1'],
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { jobId: 'job-1' },
      select: { result: true },
    });
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null],
    ['mismatch', stored({ attemptId: 'attempt-2' })],
    ['mismatch', stored({ rowId: 'row-2' })],
    ['malformed', { result: { metadata: {} } }],
    ['malformed', { result: 'not an object' }],
    ['malformed', { result: { metadata: { rerollMemory: { rowId: 'row-1' } } } }],
  ])('returns null and warns with the %s reason', async (reason, row) => {
    findUnique.mockResolvedValue(row);

    await expect(readAttemptMemory(db, key)).resolves.toBeNull();
    expect(mocks.warn).toHaveBeenCalledWith(
      { jobId: 'job-1', rowId: 'row-1', reason },
      expect.any(String)
    );
  });
});

describe('readSuccessorCandidates / liveSuccessorMemory', () => {
  const queryRaw = vi.fn();
  const findMany = vi.fn();
  const rowArgs = { rowId: 'row-1', attemptId: 'attempt-1' };
  const listed = (jobId: string, attemptId: string, memoryIds: string[]) => ({
    job_id: jobId,
    result: stored({ attemptId, memoryIds, pendingIds: [] }).result,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the row’s other job results newest first with NULLS LAST, keyed by their successor row ids, skipping the aborting attempt', async () => {
    queryRaw.mockResolvedValue([
      listed('job-y', 'attempt-y', ['a']),
      listed('job-self', 'attempt-1', ['self']),
      { job_id: 'bad', result: { metadata: {} } },
    ]);

    const candidates = await readSuccessorCandidates(
      { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient,
      rowArgs
    );

    const [strings, ...values] = queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join('?')).toContain('DESC NULLS LAST');
    expect(values).toEqual(['row-1', 20]);
    expect([...candidates.values()]).toEqual([{ memoryIds: ['a'], pendingIds: [] }]);
  });

  it('looks up no row at all when there are no candidates', async () => {
    await expect(
      liveSuccessorMemory({ conversationHistory: { findMany } } as never, new Map())
    ).resolves.toEqual({ memoryIds: [], pendingIds: [] });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns only the ids of candidates whose successor row is live', async () => {
    const candidates = new Map([
      ['new-live', { memoryIds: ['a'], pendingIds: ['p'] }],
      ['new-dead', { memoryIds: ['b'], pendingIds: [] }],
    ]);
    findMany.mockResolvedValue([{ id: 'new-live' }]);

    await expect(
      liveSuccessorMemory({ conversationHistory: { findMany } } as never, candidates)
    ).resolves.toEqual({ memoryIds: ['a'], pendingIds: ['p'] });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['new-live', 'new-dead'] }, deletedAt: null },
      })
    );
  });
});

describe('sweepAbandonedAttempts', () => {
  const queryRaw = vi.fn();
  const memoryUpdateMany = vi.fn();
  const pendingDeleteMany = vi.fn();
  const jobUpdateMany = vi.fn();
  const tx = {
    $queryRaw: queryRaw,
    memory: { updateMany: memoryUpdateMany },
    pendingMemory: { deleteMany: pendingDeleteMany },
    jobResult: { updateMany: jobUpdateMany },
  } as unknown as Prisma.TransactionClient;
  const args = {
    rowId: 'row-1',
    jobId: 'job-1',
    personalityId: 'personality-1',
    keepMemoryIds: ['keep-m'],
    keepPendingIds: ['keep-p'],
  };
  const abandoned = (jobId: string, memoryIds: string[], pendingIds: string[]) => ({
    job_id: jobId,
    result: stored({ attemptId: `attempt-${jobId}`, memoryIds, pendingIds }).result,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    memoryUpdateMany.mockResolvedValue({ count: 0 });
    pendingDeleteMany.mockResolvedValue({ count: 0 });
    jobUpdateMany.mockResolvedValue({ count: 0 });
  });

  it('does nothing when no other attempt names the row', async () => {
    queryRaw.mockResolvedValue([]);

    await expect(sweepAbandonedAttempts(tx, args)).resolves.toBe(0);
    expect(memoryUpdateMany).not.toHaveBeenCalled();
    expect(pendingDeleteMany).not.toHaveBeenCalled();
    expect(jobUpdateMany).not.toHaveBeenCalled();
  });

  it('passes the row, the committing job and the page size as query parameters, with no age filter', async () => {
    queryRaw.mockResolvedValue([]);

    await sweepAbandonedAttempts(tx, args);

    const [strings, ...values] = queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join('?')).toContain('FROM job_results');
    expect(strings.join('?')).not.toContain('completed_at <');
    expect(values).toEqual(['row-1', 'job-1', 20]);
  });

  it('removes the listed ids (minus the keep sets) within the personality, unlocked only, and marks the results delivered', async () => {
    queryRaw.mockResolvedValue([
      abandoned('a', ['m1', 'keep-m'], ['p1']),
      abandoned('b', ['m1', 'm2'], ['keep-p', 'p2']),
    ]);
    memoryUpdateMany.mockResolvedValue({ count: 2 });

    await expect(sweepAbandonedAttempts(tx, args)).resolves.toBe(2);

    expect(memoryUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1', 'm2'] }, personalityId: 'personality-1', isLocked: false },
      data: { visibility: 'deleted' },
    });
    expect(pendingDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['p1', 'p2'] }, personalityId: 'personality-1' },
    });
    expect(jobUpdateMany).toHaveBeenCalledWith({
      where: { jobId: { in: ['a', 'b'] } },
      data: { status: 'DELIVERED', deliveredAt: expect.any(Date) },
    });
  });

  it('still marks a result delivered when its payload is unreadable, removing nothing for it', async () => {
    queryRaw.mockResolvedValue([{ job_id: 'bad', result: { metadata: {} } }]);

    await sweepAbandonedAttempts(tx, args);

    expect(memoryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: [] } }) })
    );
    expect(jobUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { jobId: { in: ['bad'] } } })
    );
  });

  it('logs ids and counts only', async () => {
    queryRaw.mockResolvedValue([abandoned('a', ['m1'], [])]);

    await sweepAbandonedAttempts(tx, args);

    expect(mocks.info).toHaveBeenCalledWith(
      { rowId: 'row-1', attempts: 1, removedMemories: 0 },
      expect.any(String)
    );
  });
});
