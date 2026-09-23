/**
 * Tests for the export-smoke scheduler's check cycle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Client } from 'discord.js';
import type { Redis } from 'ioredis';
import type { GatewayFailure } from '../utils/gatewayNotReady.js';

const mockStartExportSmoke = vi.fn();
const mockGetExportSmokeStatus = vi.fn();
vi.mock('../utils/gatewayClients.js', () => ({
  getServiceClient: () => ({
    startExportSmoke: mockStartExportSmoke,
    getExportSmokeStatus: mockGetExportSmokeStatus,
  }),
}));

const mockPostOwnerChannelEmbed = vi.fn();
vi.mock('../utils/ownerChannel.js', () => ({
  postOwnerChannelEmbed: (...args: unknown[]) => mockPostOwnerChannelEmbed(...args),
}));

const mockValidateExportArtifact = vi.fn();
vi.mock('./exportSmokeValidator.js', () => ({
  validateExportArtifact: (...args: unknown[]) => mockValidateExportArtifact(...args),
}));

// vi.hoisted: the module under test calls createIntervalScheduler at import
// time, so plain consts would not be initialized when the factory runs. The
// mock also captures the `run` option so tests can invoke the real wrapper
// (the startup-flag logic lives there, not in the mocked scheduler).
const { mockSchedulerStart, mockSchedulerStop, capturedRun } = vi.hoisted(() => ({
  mockSchedulerStart: vi.fn(),
  mockSchedulerStop: vi.fn(),
  capturedRun: {
    current: null as
      | null
      | ((client: import('discord.js').Client, redis: import('ioredis').Redis) => Promise<void>),
  },
}));
vi.mock('@tzurot/common-types/utils/intervalScheduler', () => ({
  createIntervalScheduler: (opts: {
    run: (client: import('discord.js').Client, redis: import('ioredis').Redis) => Promise<void>;
  }) => {
    capturedRun.current = opts.run;
    return { start: mockSchedulerStart, stop: mockSchedulerStop };
  },
}));

import {
  runExportSmokeCheck,
  startExportSmokeScheduler,
  stopExportSmokeScheduler,
} from './ExportSmokeScheduler.js';

const EXPECTED_COUNTS = {
  personas: [],
  characters: [],
  conversationCountsByPersonalityId: {},
  memoryCountsByPersonalityId: {},
  factCountsByPersonalityId: {},
  totals: { personas: 0, characters: 0, conversations: 0, memories: 0, facts: 0 },
  isSuperuser: false,
};

const JOB_ID = 'job-1';
const DOWNLOAD_URL = 'https://gateway.example/exports/token-1';

function makeRedis(cooldownValue: string | null): Redis {
  return {
    get: vi.fn().mockResolvedValue(cooldownValue),
    setex: vi.fn().mockResolvedValue('OK'),
  } as unknown as Redis;
}

const client = {} as Client;

/** Runs the check under fake timers, advancing past every pending poll tick. */
async function runWithFakeTimers(redis: Redis): Promise<void> {
  const promise = runExportSmokeCheck(client, redis);
  await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
  await promise;
}

describe('ExportSmokeScheduler runExportSmokeCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockPostOwnerChannelEmbed.mockResolvedValue(true);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    stopExportSmokeScheduler();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does NOT start an export while the cooldown key exists (cooldown gates the WORK)', async () => {
    const redis = makeRedis('2026-08-01T00:00:00.000Z');
    await runExportSmokeCheck(client, redis);
    expect(mockStartExportSmoke).not.toHaveBeenCalled();
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('CANARY: alerts and arms the cooldown when startExportSmoke fails', async () => {
    const redis = makeRedis(null);
    mockStartExportSmoke.mockResolvedValue({ ok: false, error: 'gateway down' });

    await runExportSmokeCheck(client, redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(redis.setex).toHaveBeenCalledWith(
      'export-smoke:cooldown',
      7 * 24 * 60 * 60,
      expect.any(String)
    );
  });

  it('alerts and arms the cooldown on poll timeout', async () => {
    const redis = makeRedis(null);
    mockStartExportSmoke.mockResolvedValue({
      ok: true,
      data: { exportJobId: JOB_ID, expectedCounts: EXPECTED_COUNTS },
    });
    mockGetExportSmokeStatus.mockResolvedValue({
      ok: true,
      data: { status: 'running', downloadUrl: null },
    });

    await runWithFakeTimers(redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(redis.setex).toHaveBeenCalledWith(
      'export-smoke:cooldown',
      7 * 24 * 60 * 60,
      expect.any(String)
    );
  });

  it('alerts when the job reports status=failed', async () => {
    const redis = makeRedis(null);
    mockStartExportSmoke.mockResolvedValue({
      ok: true,
      data: { exportJobId: JOB_ID, expectedCounts: EXPECTED_COUNTS },
    });
    mockGetExportSmokeStatus.mockResolvedValue({
      ok: true,
      data: { status: 'failed', downloadUrl: null },
    });

    await runWithFakeTimers(redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(redis.setex).toHaveBeenCalledTimes(1);
  });

  it('alerts after repeated poll failures without aborting on the first one', async () => {
    const redis = makeRedis(null);
    mockStartExportSmoke.mockResolvedValue({
      ok: true,
      data: { exportJobId: JOB_ID, expectedCounts: EXPECTED_COUNTS },
    });
    mockGetExportSmokeStatus.mockResolvedValue({ ok: false, error: 'transient' });

    await runWithFakeTimers(redis);

    expect(mockGetExportSmokeStatus.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
  });

  it('alerts when the job completes with a null downloadUrl', async () => {
    const redis = makeRedis(null);
    mockStartExportSmoke.mockResolvedValue({
      ok: true,
      data: { exportJobId: JOB_ID, expectedCounts: EXPECTED_COUNTS },
    });
    mockGetExportSmokeStatus.mockResolvedValue({
      ok: true,
      data: { status: 'completed', downloadUrl: null },
    });

    await runWithFakeTimers(redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
  });

  it('alerts when the artifact download responds non-2xx', async () => {
    const redis = makeRedis(null);
    mockStartExportSmoke.mockResolvedValue({
      ok: true,
      data: { exportJobId: JOB_ID, expectedCounts: EXPECTED_COUNTS },
    });
    mockGetExportSmokeStatus.mockResolvedValue({
      ok: true,
      data: { status: 'completed', downloadUrl: DOWNLOAD_URL },
    });
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404 } as Response);

    await runWithFakeTimers(redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(mockValidateExportArtifact).not.toHaveBeenCalled();
  });

  it('SEAM: forwards the downloaded bytes and expectedCounts to validateExportArtifact, and alerts on its findings', async () => {
    const redis = makeRedis(null);
    mockStartExportSmoke.mockResolvedValue({
      ok: true,
      data: { exportJobId: JOB_ID, expectedCounts: EXPECTED_COUNTS },
    });
    mockGetExportSmokeStatus.mockResolvedValue({
      ok: true,
      data: { status: 'completed', downloadUrl: DOWNLOAD_URL },
    });
    const bytes = new Uint8Array([1, 2, 3]);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(bytes.buffer),
    } as Response);
    mockValidateExportArtifact.mockReturnValue({
      ok: false,
      findings: ['manifest: required path missing — x'],
    });

    await runWithFakeTimers(redis);

    expect(mockValidateExportArtifact).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      EXPECTED_COUNTS
    );
    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    const embed = mockPostOwnerChannelEmbed.mock.calls[0]?.[1] as {
      data: { description?: string };
    };
    expect(embed.data.description).toContain('manifest: required path missing — x');
  });

  it('CANARY: does NOT post to the owner channel and DOES arm the cooldown on a clean pass', async () => {
    const redis = makeRedis(null);
    mockStartExportSmoke.mockResolvedValue({
      ok: true,
      data: { exportJobId: JOB_ID, expectedCounts: EXPECTED_COUNTS },
    });
    mockGetExportSmokeStatus.mockResolvedValue({
      ok: true,
      data: { status: 'completed', downloadUrl: DOWNLOAD_URL },
    });
    const bytes = new Uint8Array([1, 2, 3]);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(bytes.buffer),
    } as Response);
    mockValidateExportArtifact.mockReturnValue({ ok: true, findings: [] });

    await runWithFakeTimers(redis);

    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
    expect(redis.setex).toHaveBeenCalledWith(
      'export-smoke:cooldown',
      7 * 24 * 60 * 60,
      expect.any(String)
    );
  });

  it('swallows a thrown error entirely (the smoke must never affect bot operation)', async () => {
    const redis = makeRedis(null);
    mockStartExportSmoke.mockRejectedValue(new Error('network'));

    await expect(runExportSmokeCheck(client, redis)).resolves.toBeUndefined();
  });
});

describe('startup-run gateway-not-ready retry', () => {
  const NOT_READY_NETWORK = {
    ok: false,
    error: 'fetch failed',
    kind: 'network',
    status: 0,
  } satisfies GatewayFailure;
  const NOT_READY_404 = {
    ok: false,
    error: 'not found',
    kind: 'http',
    status: 404,
  } satisfies GatewayFailure;
  const NOT_READY_503 = {
    ok: false,
    error: 'unavailable',
    kind: 'http',
    status: 503,
  } satisfies GatewayFailure;
  const SERVER_ERROR_500 = {
    ok: false,
    error: 'boom',
    kind: 'http',
    status: 500,
  } satisfies GatewayFailure;
  const NOT_READY_TIMEOUT = {
    ok: false,
    error: 'timed out',
    kind: 'timeout',
    status: 0,
  } satisfies GatewayFailure;
  const NOT_READY_504 = {
    ok: false,
    error: 'gateway timeout',
    kind: 'http',
    status: 504,
  } satisfies GatewayFailure;

  const FIVE_MINUTES_MS = 5 * 60 * 1000;
  const TEN_MINUTES_MS = 10 * 60 * 1000;
  const ELEVEN_MINUTES_MS = 11 * 60 * 1000;

  /** A stateful in-memory redis fake — get/setex mutate one cooldown slot. */
  function makeStatefulRedis(initial: string | null = null): Redis {
    let cooldown = initial;
    return {
      get: vi.fn().mockImplementation(() => Promise.resolve(cooldown)),
      setex: vi.fn().mockImplementation((_key: string, _ttl: number, value: string) => {
        cooldown = value;
        return Promise.resolve('OK');
      }),
    } as unknown as Redis;
  }

  function requireCapturedRun(): (client: Client, redis: Redis) => Promise<void> {
    if (capturedRun.current === null) {
      throw new Error('createIntervalScheduler mock never captured a run option');
    }
    return capturedRun.current;
  }

  function lastPostedEmbedTitle(): string {
    const call = mockPostOwnerChannelEmbed.mock.calls.at(-1) as [Client, { data: unknown }];
    const { title } = call[1].data as { title?: string };
    return title ?? '';
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn());
    mockStartExportSmoke.mockReset();
    mockGetExportSmokeStatus.mockReset();
    mockValidateExportArtifact.mockReset();
    mockPostOwnerChannelEmbed.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    stopExportSmokeScheduler();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('startup not-ready then successful retry runs the smoke normally', async () => {
    const redis = makeStatefulRedis(null);
    mockStartExportSmoke.mockResolvedValueOnce(NOT_READY_NETWORK);
    mockStartExportSmoke.mockResolvedValueOnce({
      ok: true,
      data: { exportJobId: JOB_ID, expectedCounts: EXPECTED_COUNTS },
    });
    mockGetExportSmokeStatus.mockResolvedValue({
      ok: true,
      data: { status: 'completed', downloadUrl: DOWNLOAD_URL },
    });
    const bytes = new Uint8Array([1, 2, 3]);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(bytes.buffer),
    } as Response);
    mockValidateExportArtifact.mockReturnValue({ ok: true, findings: [] });

    startExportSmokeScheduler(client, redis);
    const run = requireCapturedRun();
    await run(client, redis);

    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
    expect(redis.setex).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(FIVE_MINUTES_MS + ELEVEN_MINUTES_MS);

    expect(mockStartExportSmoke).toHaveBeenCalledTimes(2);
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
    expect(redis.setex).toHaveBeenCalledTimes(1);
  });

  it('retry failure alerts once and arms the cooldown', async () => {
    const redis = makeStatefulRedis(null);
    mockStartExportSmoke.mockResolvedValueOnce(NOT_READY_404);
    mockStartExportSmoke.mockResolvedValueOnce(NOT_READY_404);

    startExportSmokeScheduler(client, redis);
    const run = requireCapturedRun();
    await run(client, redis);

    await vi.advanceTimersByTimeAsync(FIVE_MINUTES_MS);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(lastPostedEmbedTitle()).toBe('🧯 Weekly export-path smoke failed');
    const call = mockPostOwnerChannelEmbed.mock.calls[0] as [
      Client,
      { data: { description?: string } },
    ];
    expect(call[1].data.description).toContain('Could not start');
    expect(redis.setex).toHaveBeenCalledTimes(1);
  });

  it('interval-run not-ready failure alerts immediately and arms the cooldown', async () => {
    const cooledRedis = makeStatefulRedis('existing-cooldown');

    startExportSmokeScheduler(client, cooledRedis);
    const run = requireCapturedRun();
    // Cooldown present — the flag is consumed regardless (it's read before
    // runExportSmokeCheck's own cooldown check), but the run itself returns
    // early without ever calling startExportSmoke.
    await run(client, cooledRedis);
    expect(mockStartExportSmoke).not.toHaveBeenCalled();

    const freshRedis = makeStatefulRedis(null);
    mockStartExportSmoke.mockResolvedValueOnce(NOT_READY_503);

    await run(client, freshRedis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(freshRedis.setex).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS);

    expect(mockStartExportSmoke).toHaveBeenCalledTimes(1);
  });

  it('startup 500 alerts immediately', async () => {
    const redis = makeStatefulRedis(null);
    mockStartExportSmoke.mockResolvedValueOnce(SERVER_ERROR_500);

    startExportSmokeScheduler(client, redis);
    const run = requireCapturedRun();
    await run(client, redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(redis.setex).toHaveBeenCalledTimes(1);
  });

  it('startup timeout is not retried', async () => {
    const redis = makeStatefulRedis(null);
    mockStartExportSmoke.mockResolvedValueOnce(NOT_READY_TIMEOUT);

    startExportSmokeScheduler(client, redis);
    const run = requireCapturedRun();
    await run(client, redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(redis.setex).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(FIVE_MINUTES_MS);

    expect(mockStartExportSmoke).toHaveBeenCalledTimes(1);
  });

  it('startup 504 is not retried', async () => {
    const redis = makeStatefulRedis(null);
    mockStartExportSmoke.mockResolvedValueOnce(NOT_READY_504);

    startExportSmokeScheduler(client, redis);
    const run = requireCapturedRun();
    await run(client, redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(redis.setex).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(FIVE_MINUTES_MS);

    expect(mockStartExportSmoke).toHaveBeenCalledTimes(1);
  });

  it('stop clears the pending retry', async () => {
    const redis = makeStatefulRedis(null);
    mockStartExportSmoke.mockResolvedValueOnce(NOT_READY_404);

    startExportSmokeScheduler(client, redis);
    const run = requireCapturedRun();
    await run(client, redis);

    stopExportSmokeScheduler();

    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS);

    expect(mockStartExportSmoke).toHaveBeenCalledTimes(1);
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('double start does not re-arm', async () => {
    const cooledRedis = makeStatefulRedis('existing-cooldown');

    startExportSmokeScheduler(client, cooledRedis);
    const run = requireCapturedRun();
    await run(client, cooledRedis);
    expect(mockStartExportSmoke).not.toHaveBeenCalled();

    // A second start call must not re-arm the flag.
    startExportSmokeScheduler(client, cooledRedis);

    const freshRedis = makeStatefulRedis(null);
    mockStartExportSmoke.mockResolvedValueOnce(NOT_READY_503);

    await run(client, freshRedis);

    // Not treated as a startup run (the flag was already consumed), so a
    // not-ready failure alerts immediately instead of retrying.
    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
  });
});
