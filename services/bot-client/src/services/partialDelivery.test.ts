/**
 * Tests for the partial-delivery error-path seam: PartialDeliveryError,
 * toSendFailure, stripDmPrefix, resolveErrorPathTurn, settleErrorPathTurn.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PartialDeliveryError,
  toSendFailure,
  stripDmPrefix,
  resolveErrorPathTurn,
  settleErrorPathTurn,
  type PersistableTurn,
} from './partialDelivery.js';
import { updateDiagnosticResponseIds } from '../utils/gatewayServiceCalls.js';

vi.mock('../utils/gatewayServiceCalls.js', () => ({
  updateDiagnosticResponseIds: vi.fn(),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

describe('PartialDeliveryError', () => {
  it('carries chunkMessageIds, deliveredContent, name, and the original cause', () => {
    const cause = new Error('webhook 500');
    const err = new PartialDeliveryError({
      chunkMessageIds: ['id-1', 'id-2'],
      deliveredContent: 'chunk one\nchunk two',
      totalChunks: 3,
      cause,
    });

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('PartialDeliveryError');
    expect(err.chunkMessageIds).toEqual(['id-1', 'id-2']);
    expect(err.deliveredContent).toBe('chunk one\nchunk two');
    expect(err.cause).toBe(cause);
    expect(err.message).toContain('2 of 3 chunks sent before');
    expect(err.message).toContain('webhook 500');
  });

  it('stringifies a non-Error cause into the message', () => {
    const err = new PartialDeliveryError({
      chunkMessageIds: ['id-1'],
      deliveredContent: 'chunk one',
      totalChunks: 2,
      cause: 'raw string failure',
    });

    expect(err.message).toContain('1 of 2 chunks sent before: raw string failure');
    expect(err.cause).toBe('raw string failure');
  });
});

describe('toSendFailure', () => {
  it('returns the same error unchanged when zero chunks were delivered', () => {
    const original = new Error('first chunk failed');
    const result = toSendFailure(original, {
      chunkMessageIds: [],
      plainChunks: ['chunk one', 'chunk two'],
      totalChunks: 2,
    });

    expect(result).toBe(original);
    expect(result).not.toBeInstanceOf(PartialDeliveryError);
  });

  it('wraps into a PartialDeliveryError with copied ids and joined delivered text', () => {
    const original = new Error('second chunk failed');
    const ids = ['id-1', 'id-2'];
    const result = toSendFailure(original, {
      chunkMessageIds: ids,
      plainChunks: ['chunk one', 'chunk two', 'chunk three (never sent)'],
      totalChunks: 3,
    });

    expect(result).toBeInstanceOf(PartialDeliveryError);
    const partial = result as PartialDeliveryError;
    expect(partial.chunkMessageIds).toEqual(['id-1', 'id-2']);
    // Copy, not the same array reference — mutating the caller's array must
    // not reach back into the thrown error.
    expect(partial.chunkMessageIds).not.toBe(ids);
    expect(partial.deliveredContent).toBe('chunk one\nchunk two');
    expect(partial.cause).toBe(original);
  });

  it('skips empty plain chunks when joining delivered content', () => {
    const original = new Error('boom');
    const result = toSendFailure(original, {
      chunkMessageIds: ['id-1', 'id-2'],
      plainChunks: ['', 'chunk two'],
      totalChunks: 2,
    }) as PartialDeliveryError;

    expect(result.deliveredContent).toBe('chunk two');
  });
});

describe('stripDmPrefix', () => {
  const prefix = '**Test Bot:** ';

  it('strips the prefix with its trailing space intact', () => {
    expect(stripDmPrefix('**Test Bot:** Hello there', prefix)).toBe('Hello there');
  });

  it('strips the trimmed form (splitter dropped the trailing space)', () => {
    expect(stripDmPrefix('**Test Bot:**Hello there', prefix)).toBe('Hello there');
  });

  it('leaves a non-matching chunk unchanged', () => {
    expect(stripDmPrefix('some later chunk with no prefix', prefix)).toBe(
      'some later chunk with no prefix'
    );
  });
});

describe('resolveErrorPathTurn', () => {
  function buildPartial(ids: string[], deliveredContent: string): PartialDeliveryError {
    return new PartialDeliveryError({
      chunkMessageIds: ids,
      deliveredContent,
      totalChunks: ids.length + 1,
      cause: new Error('boom'),
    });
  }

  const errorTurn: PersistableTurn = { content: 'error text', chunkMessageIds: ['err-1'] };

  it('partial + delivered error notice + persistErrorText=true: composes both into one row', () => {
    const partial = buildPartial(['id-1'], 'delivered text');
    const outcome = resolveErrorPathTurn({ partial, errorTurn, persistErrorText: true });

    expect(outcome.persist).toEqual({
      content: 'delivered text\nerror text',
      chunkMessageIds: ['id-1', 'err-1'],
    });
    expect(outcome.diagnosticIds).toEqual(['id-1', 'err-1']);
  });

  it('partial + delivered error notice + persistErrorText=false: persists only the delivered text', () => {
    const partial = buildPartial(['id-1'], 'delivered text');
    const outcome = resolveErrorPathTurn({ partial, errorTurn, persistErrorText: false });

    expect(outcome.persist).toEqual({ content: 'delivered text', chunkMessageIds: ['id-1'] });
    // Diagnostics still see both — the error notice DID reach Discord.
    expect(outcome.diagnosticIds).toEqual(['id-1', 'err-1']);
  });

  it('partial + error notice send failed (errorTurn null): persists only the delivered text', () => {
    const partial = buildPartial(['id-1'], 'delivered text');
    const outcome = resolveErrorPathTurn({ partial, errorTurn: null, persistErrorText: true });

    expect(outcome.persist).toEqual({ content: 'delivered text', chunkMessageIds: ['id-1'] });
    expect(outcome.diagnosticIds).toEqual(['id-1']);
  });

  it('no partial + delivered error notice + persistErrorText=true: persists the error turn alone', () => {
    const outcome = resolveErrorPathTurn({ partial: undefined, errorTurn, persistErrorText: true });

    expect(outcome.persist).toEqual({ content: 'error text', chunkMessageIds: ['err-1'] });
    expect(outcome.diagnosticIds).toEqual(['err-1']);
  });

  it('no partial + delivered error notice + persistErrorText=false: persists nothing', () => {
    const outcome = resolveErrorPathTurn({
      partial: undefined,
      errorTurn,
      persistErrorText: false,
    });

    expect(outcome.persist).toBeNull();
    expect(outcome.diagnosticIds).toEqual(['err-1']);
  });

  it('no partial + error notice send failed: persists nothing, no diagnostic ids', () => {
    const outcome = resolveErrorPathTurn({
      partial: undefined,
      errorTurn: null,
      persistErrorText: true,
    });

    expect(outcome.persist).toBeNull();
    expect(outcome.diagnosticIds).toEqual([]);
  });
});

describe('settleErrorPathTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateDiagnosticResponseIds).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls save once with the resolved turn and updates diagnostics with combined ids', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const partial = new PartialDeliveryError({
      chunkMessageIds: ['id-1'],
      deliveredContent: 'delivered text',
      totalChunks: 2,
      cause: new Error('boom'),
    });
    const errorTurn: PersistableTurn = { content: 'error text', chunkMessageIds: ['err-1'] };

    await settleErrorPathTurn({
      partial,
      errorTurn,
      persistErrorText: true,
      save,
      requestId: 'req-1',
      logContext: { jobId: 'job-1' },
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({
      content: 'delivered text\nerror text',
      chunkMessageIds: ['id-1', 'err-1'],
    });
    await Promise.resolve();
    expect(vi.mocked(updateDiagnosticResponseIds)).toHaveBeenCalledWith('req-1', ['id-1', 'err-1']);
  });

  it('swallows a save rejection and still resolves', async () => {
    const save = vi.fn().mockRejectedValue(new Error('db unavailable'));
    const errorTurn: PersistableTurn = { content: 'error text', chunkMessageIds: ['err-1'] };

    await expect(
      settleErrorPathTurn({
        partial: undefined,
        errorTurn,
        persistErrorText: true,
        save,
        requestId: 'req-1',
        logContext: {},
      })
    ).resolves.toBeUndefined();

    expect(save).toHaveBeenCalledTimes(1);
  });

  it('does not call save when the resolved persist is null', async () => {
    const save = vi.fn();

    await settleErrorPathTurn({
      partial: undefined,
      errorTurn: null,
      persistErrorText: true,
      save,
      requestId: 'req-1',
      logContext: {},
    });

    expect(save).not.toHaveBeenCalled();
  });

  it('does not call updateDiagnosticResponseIds when there are no ids', async () => {
    const save = vi.fn().mockResolvedValue(undefined);

    await settleErrorPathTurn({
      partial: undefined,
      errorTurn: null,
      persistErrorText: false,
      save,
      requestId: 'req-1',
      logContext: {},
    });

    await Promise.resolve();
    expect(vi.mocked(updateDiagnosticResponseIds)).not.toHaveBeenCalled();
  });
});
