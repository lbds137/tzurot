/**
 * Tests for the memory-archive auto-promotion check scheduler's run cycle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Client } from 'discord.js';
import type { MemoryArchivePromotion } from '@tzurot/common-types/schemas/api/memoryArchive';
import type { GatewayResult } from '@tzurot/clients';

const mockMemoryArchivePromote = vi.fn();
vi.mock('../utils/gatewayClients.js', () => ({
  getOwnerClient: () => ({ memoryArchivePromote: mockMemoryArchivePromote }),
}));

// vi.hoisted: the module under test calls createIntervalScheduler at import
// time, so plain consts would not be initialized when the factory runs. The
// mock also captures the `run` option so tests can invoke the real wrapper
// (the startup-flag logic lives there, not in the mocked scheduler).
const { mockSchedulerStart, mockSchedulerStop, capturedRun } = vi.hoisted(() => ({
  mockSchedulerStart: vi.fn(),
  mockSchedulerStop: vi.fn(),
  capturedRun: { current: null as null | ((client: import('discord.js').Client) => Promise<void>) },
}));
vi.mock('@tzurot/common-types/utils/intervalScheduler', () => ({
  createIntervalScheduler: (opts: {
    run: (client: import('discord.js').Client) => Promise<void>;
  }) => {
    capturedRun.current = opts.run;
    return { start: mockSchedulerStart, stop: mockSchedulerStop };
  },
}));

const mockPostOwnerChannelEmbed = vi.fn().mockResolvedValue(true);
vi.mock('../utils/ownerChannel.js', () => ({
  postOwnerChannelEmbed: (...args: unknown[]) => mockPostOwnerChannelEmbed(...args),
}));

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return { ...actual, createLogger: () => mockLogger };
});

import {
  runArchivePromotionCheck,
  startArchivePromotionScheduler,
  stopArchivePromotionScheduler,
} from './ArchivePromotionScheduler.js';

const FAKE_CLIENT = {} as Client;

function promotion(overrides: Partial<MemoryArchivePromotion> = {}): MemoryArchivePromotion {
  return {
    personalityId: '550e8400-e29b-41d4-a716-446655440001',
    slug: 'my-persona',
    coverage: 0.97,
    writes: { archiveSplitRender: true, recentDaysDigest: true, renderMode: true },
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  // Re-assert the default so no test depends on whether vi.clearAllMocks()
  // (below) preserves a module-scope mockResolvedValue (not verified here).
  mockPostOwnerChannelEmbed.mockResolvedValue(true);
});

afterEach(() => {
  stopArchivePromotionScheduler();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('runArchivePromotionCheck', () => {
  it('posts nothing when no promotions happened', async () => {
    mockMemoryArchivePromote.mockResolvedValue({
      ok: true,
      data: {
        enabled: true,
        evaluated: 5,
        promoted: [],
        skipped: { notReady: 5, optedOut: 0, alreadyListed: 0, conflicted: 0 },
      },
    });

    await runArchivePromotionCheck(FAKE_CLIENT);

    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('posts one embed carrying the slug and coverage percentage when something was promoted', async () => {
    mockMemoryArchivePromote.mockResolvedValue({
      ok: true,
      data: {
        enabled: true,
        evaluated: 5,
        promoted: [promotion()],
        skipped: { notReady: 4, optedOut: 0, alreadyListed: 0, conflicted: 0 },
      },
    });

    await runArchivePromotionCheck(FAKE_CLIENT);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    const [, embed] = mockPostOwnerChannelEmbed.mock.calls[0] as [
      Client,
      { toJSON: () => unknown },
    ];
    const json = JSON.stringify(embed.toJSON());
    expect(json).toContain('my-persona');
    expect(json).toContain('97.0%');
  });

  it('caps the embed at MAX_PROMOTION_FIELDS (25) and names the remainder', async () => {
    const promoted = Array.from({ length: 30 }, (_, i) =>
      promotion({ slug: `persona-${String(i)}` })
    );
    mockMemoryArchivePromote.mockResolvedValue({
      ok: true,
      data: {
        enabled: true,
        evaluated: 30,
        promoted,
        skipped: { notReady: 0, optedOut: 0, alreadyListed: 0, conflicted: 0 },
      },
    });

    await runArchivePromotionCheck(FAKE_CLIENT);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    const [, embed] = mockPostOwnerChannelEmbed.mock.calls[0] as [
      Client,
      { toJSON: () => { fields?: unknown[]; description?: string | null } },
    ];
    const data = embed.toJSON();
    expect(data.fields).toHaveLength(25);
    expect(data.description).toContain('5 more');
  });

  it('does nothing when promotion is disabled', async () => {
    mockMemoryArchivePromote.mockResolvedValue({
      ok: true,
      data: {
        enabled: false,
        evaluated: 0,
        promoted: [],
        skipped: { notReady: 0, optedOut: 0, alreadyListed: 0, conflicted: 0 },
      },
    });

    await runArchivePromotionCheck(FAKE_CLIENT);

    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('posts a failure embed and logs a warning when the gateway call fails', async () => {
    mockMemoryArchivePromote.mockResolvedValue({
      ok: false,
      kind: 'http',
      error: 'gateway unreachable',
      status: 502,
    });

    await runArchivePromotionCheck(FAKE_CLIENT);

    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
  });

  it('a thrown client error is caught: one warn, one failure embed, no rethrow', async () => {
    mockMemoryArchivePromote.mockRejectedValue(new Error('network exploded'));

    await expect(runArchivePromotionCheck(FAKE_CLIENT)).resolves.toBeUndefined();

    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
  });
});

describe('startArchivePromotionScheduler / stopArchivePromotionScheduler', () => {
  it('starts and stops the underlying interval scheduler', () => {
    startArchivePromotionScheduler(FAKE_CLIENT);
    expect(mockSchedulerStart).toHaveBeenCalledWith(FAKE_CLIENT);

    stopArchivePromotionScheduler();
    expect(mockSchedulerStop).toHaveBeenCalled();
  });
});

describe('startup-run gateway-not-ready retry', () => {
  type Failure = Extract<GatewayResult<unknown>, { ok: false }>;

  const NOT_FOUND_404: Failure = {
    ok: false,
    kind: 'http',
    error: 'Route POST /api/admin/memory-archive/promote not found',
    status: 404,
  };
  const NETWORK_FAILURE: Failure = {
    ok: false,
    kind: 'network',
    error: 'fetch failed',
    status: 0,
  };
  const UNAVAILABLE_503: Failure = { ok: false, kind: 'http', error: 'unavailable', status: 503 };
  const SERVER_ERROR_500: Failure = { ok: false, kind: 'http', error: 'boom', status: 500 };

  const SUCCESS_NO_PROMOTIONS = {
    ok: true,
    data: {
      enabled: true,
      evaluated: 0,
      promoted: [],
      skipped: { notReady: 0, optedOut: 0, alreadyListed: 0, conflicted: 0 },
    },
  };

  const FIVE_MINUTES_MS = 5 * 60 * 1000;
  const TEN_MINUTES_MS = 10 * 60 * 1000;

  beforeEach(() => {
    mockMemoryArchivePromote.mockReset();
  });

  /** Runs the module's real `run` wrapper as a scheduler-triggered startup run. */
  async function startupRun(): Promise<void> {
    startArchivePromotionScheduler(FAKE_CLIENT);
    if (capturedRun.current === null) {
      throw new Error('createIntervalScheduler mock never captured a run option');
    }
    await capturedRun.current(FAKE_CLIENT);
  }

  /** Runs the module's real `run` wrapper as a non-startup (interval) run. */
  async function intervalRun(): Promise<void> {
    if (capturedRun.current === null) {
      throw new Error('createIntervalScheduler mock never captured a run option');
    }
    await capturedRun.current(FAKE_CLIENT);
  }

  it('startup-run 404 then successful retry posts no embed', async () => {
    mockMemoryArchivePromote.mockResolvedValueOnce(NOT_FOUND_404);
    mockMemoryArchivePromote.mockResolvedValueOnce(SUCCESS_NO_PROMOTIONS);

    await startupRun();
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(FIVE_MINUTES_MS);

    expect(mockMemoryArchivePromote).toHaveBeenCalledTimes(2);
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('startup-run transport error (fetch failed) retries once', async () => {
    mockMemoryArchivePromote.mockResolvedValueOnce(NETWORK_FAILURE);
    mockMemoryArchivePromote.mockResolvedValueOnce(SUCCESS_NO_PROMOTIONS);

    await startupRun();
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES_MS);

    expect(mockMemoryArchivePromote).toHaveBeenCalledTimes(2);
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('startup-run 503 retries once', async () => {
    mockMemoryArchivePromote.mockResolvedValueOnce(UNAVAILABLE_503);
    mockMemoryArchivePromote.mockResolvedValueOnce(SUCCESS_NO_PROMOTIONS);

    await startupRun();
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES_MS);

    expect(mockMemoryArchivePromote).toHaveBeenCalledTimes(2);
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('retry failure posts exactly one embed', async () => {
    mockMemoryArchivePromote.mockResolvedValueOnce(NOT_FOUND_404);
    mockMemoryArchivePromote.mockResolvedValueOnce(NOT_FOUND_404);

    await startupRun();
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES_MS);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    const [, embed] = mockPostOwnerChannelEmbed.mock.calls[0] as [
      Client,
      { toJSON: () => unknown },
    ];
    expect(JSON.stringify(embed.toJSON())).toContain('not found');

    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(mockMemoryArchivePromote).toHaveBeenCalledTimes(2);
  });

  it('interval-run 404 posts immediately', async () => {
    mockMemoryArchivePromote.mockResolvedValueOnce(SUCCESS_NO_PROMOTIONS);
    mockMemoryArchivePromote.mockResolvedValueOnce(NOT_FOUND_404);

    // Consumes the startup flag with a success — the next captured-run call
    // is therefore an ordinary interval run.
    await startupRun();
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();

    await intervalRun();

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop clears the pending retry', async () => {
    mockMemoryArchivePromote.mockResolvedValueOnce(NOT_FOUND_404);

    await startupRun();
    stopArchivePromotionScheduler();

    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS);

    expect(mockMemoryArchivePromote).toHaveBeenCalledTimes(1);
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('non-not-ready startup failure posts immediately', async () => {
    mockMemoryArchivePromote.mockResolvedValueOnce(SERVER_ERROR_500);

    await startupRun();

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(mockMemoryArchivePromote).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(mockMemoryArchivePromote).toHaveBeenCalledTimes(1);
  });

  it('a startup-run thrown error posts immediately', async () => {
    mockMemoryArchivePromote.mockRejectedValueOnce(new Error('boom'));

    await startupRun();

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('double-start does not re-arm the startup flag for the next run', async () => {
    mockMemoryArchivePromote.mockResolvedValueOnce(SUCCESS_NO_PROMOTIONS);
    mockMemoryArchivePromote.mockResolvedValueOnce(NOT_FOUND_404);

    await startupRun();
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();

    // A second start call must not re-arm startupRunPending: the next captured
    // run should be treated as an ordinary (non-startup) check.
    startArchivePromotionScheduler(FAKE_CLIENT);

    await intervalRun();

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
