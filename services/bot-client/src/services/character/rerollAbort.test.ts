import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  abortReroll,
  abortRerollDetailed,
  abortThenDrop,
  isDefiniteRefusal,
  type AbortArgs,
} from './rerollAbort.js';

const mocks = vi.hoisted(() => ({ abort: vi.fn(), warn: vi.fn() }));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: mocks.warn, error: vi.fn() }),
  };
});

const args = {
  jobId: 'job-1',
  userClient: { abortRerollAssistantMessage: mocks.abort },
  routeKey: '222',
  rowId: 'row-1',
  attemptId: 'attempt-1',
  keepMemoryIds: ['old-mem'],
  newMemoryIds: ['new-mem'],
  newPendingIds: ['new-pending'],
} as unknown as AbortArgs;

describe('abortReroll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends the job id beside the attempt and the fallback ids, keyed by the route key', async () => {
    mocks.abort.mockResolvedValue({ ok: true, data: { removedMemories: 1, committed: false } });

    await abortReroll(args);

    expect(mocks.abort).toHaveBeenCalledWith('222', {
      rowId: 'row-1',
      attemptId: 'attempt-1',
      jobId: 'job-1',
      newMemoryIds: ['new-mem'],
      newPendingIds: ['new-pending'],
      keepMemoryIds: ['old-mem'],
    });
  });

  it.each([
    [true, 'committed'],
    [false, 'aborted'],
  ])('answers %s from the gateway as %s', async (committed, outcome) => {
    mocks.abort.mockResolvedValue({ ok: true, data: { removedMemories: 0, committed } });

    await expect(abortReroll(args)).resolves.toBe(outcome);
  });

  it('answers unknown, logging ids only, when the gateway refuses', async () => {
    mocks.abort.mockResolvedValue({ ok: false, status: 503, error: 'x', kind: 'http' });

    await expect(abortReroll(args)).resolves.toBe('unknown');
    expect(mocks.warn).toHaveBeenCalledWith(
      { jobId: 'job-1', rowId: 'row-1', status: 503 },
      expect.any(String)
    );
  });

  it('answers unknown, never throwing, when the call itself fails', async () => {
    mocks.abort.mockRejectedValue(new Error('down'));

    await expect(abortReroll(args)).resolves.toBe('unknown');
  });

  it('answers unknown to the live handlers for a definite refusal too (only recovery tells them apart)', async () => {
    mocks.abort.mockResolvedValue({ ok: false, status: 404, error: 'x', kind: 'http' });

    await expect(abortReroll(args)).resolves.toBe('unknown');
  });
});

describe('abortRerollDetailed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('carries the old row state the gateway reported with an aborted answer', async () => {
    mocks.abort.mockResolvedValue({
      ok: true,
      data: {
        removedMemories: 0,
        committed: false,
        oldRowLive: true,
        oldRowContentDigest: 'a'.repeat(64),
      },
    });

    await expect(abortRerollDetailed(args)).resolves.toEqual({
      kind: 'aborted',
      oldRowLive: true,
      oldRowContentDigest: 'a'.repeat(64),
    });
  });

  it('answers committed with no row state', async () => {
    mocks.abort.mockResolvedValue({
      ok: true,
      data: { removedMemories: 0, committed: true, oldRowLive: false, oldRowContentDigest: null },
    });

    await expect(abortRerollDetailed(args)).resolves.toEqual({ kind: 'committed' });
  });

  it.each([400, 403, 404, 409])('answers refused for a definite %i', async status => {
    mocks.abort.mockResolvedValue({ ok: false, status, error: 'x', kind: 'http' });

    await expect(abortRerollDetailed(args)).resolves.toEqual({ kind: 'refused', status });
  });

  it.each([408, 429, 500, 503])('answers unknown for a possibly transient %i', async status => {
    mocks.abort.mockResolvedValue({ ok: false, status, error: 'x', kind: 'http' });

    await expect(abortRerollDetailed(args)).resolves.toEqual({ kind: 'unknown' });
  });
});

describe('isDefiniteRefusal', () => {
  it.each([
    [400, true],
    [404, true],
    [409, true],
    [408, false],
    [429, false],
    [500, false],
    [200, false],
  ])('%i → %s', (status, expected) => {
    expect(isDefiniteRefusal(status)).toBe(expected);
  });
});

describe('abortThenDrop', () => {
  it.each([['aborted'], ['committed']] as const)(
    'drops the record after an abort that answered %s',
    async outcome => {
      const drop = vi.fn().mockResolvedValue(undefined);

      const keep = vi.fn();

      await abortThenDrop(async () => outcome, drop, keep);

      expect(drop).toHaveBeenCalledTimes(1);
      expect(keep).not.toHaveBeenCalled();
    }
  );

  it('keeps the record, handed to recovery, when the abort could not answer', async () => {
    const drop = vi.fn().mockResolvedValue(undefined);
    const keep = vi.fn();

    await abortThenDrop(async () => 'unknown', drop, keep);

    expect(drop).not.toHaveBeenCalled();
    expect(keep).toHaveBeenCalledTimes(1);
  });

  it('runs the abort when there is no record to drop', async () => {
    const abort = vi.fn().mockResolvedValue('aborted');

    await abortThenDrop(abort, undefined);

    expect(abort).toHaveBeenCalledTimes(1);
  });
});
