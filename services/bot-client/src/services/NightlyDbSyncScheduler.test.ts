/**
 * Tests for the nightly db-sync scheduler's run cycle.
 *
 * The seam that matters most here is the dbSync call itself: this scheduler
 * writes to prod, so the options it forwards (real sync, no schema-skew
 * override — the manual command's defaults) are asserted directly rather than
 * inferred from the embed it produces.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Client } from 'discord.js';
import type { Redis } from 'ioredis';
import type { GatewayFailure } from '../utils/gatewayNotReady.js';
import { API_ERROR_SUBCODE } from '@tzurot/common-types/constants/error';

const mockDbSync = vi.fn();
const mockGetSystemSettings = vi.fn();
vi.mock('../utils/gatewayClients.js', () => ({
  getOwnerClient: () => ({ dbSync: mockDbSync, getSystemSettings: mockGetSystemSettings }),
}));

// vi.hoisted: the module under test calls createIntervalScheduler at import
// time, so plain consts would not be initialized when the factory runs. The
// mock also captures the `run` option so tests can invoke the real wrapper
// (the startup-flag/trigger logic lives there, not in the mocked scheduler).
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

// Mutable so the boot-guard tests can vary the configured owner id / env per case.
let mockOwnerId: string | undefined = '123456789012345678';
let mockNodeEnv = 'production';
vi.mock('@tzurot/common-types/config/config', () => ({
  getConfig: () => ({ BOT_OWNER_ID: mockOwnerId, NODE_ENV: mockNodeEnv }),
}));

const mockPostOwnerChannelEmbed = vi.fn();
vi.mock('../utils/ownerChannel.js', () => ({
  postOwnerChannelEmbed: (...args: unknown[]) => mockPostOwnerChannelEmbed(...args),
}));

import {
  runNightlyDbSync,
  startNightlyDbSyncScheduler,
  stopNightlyDbSyncScheduler,
} from './NightlyDbSyncScheduler.js';

const QUIET_STATS = { users: { devToProd: 0, prodToDev: 0, conflicts: 0, deleted: 0 } };
const BUSY_STATS = {
  users: { devToProd: 3, prodToDev: 1, conflicts: 0, deleted: 0 },
  personas: { devToProd: 0, prodToDev: 0, conflicts: 2, deleted: 5 },
};

function okResult(stats: Record<string, Record<string, number>>, warnings: string[] = []): unknown {
  return {
    ok: true,
    data: {
      success: true,
      timestamp: '2026-07-11T00:00:00.000Z',
      schemaVersion: '20260710230428_add_sync_tombstones',
      stats,
      warnings,
      info: [],
      deletions: [],
      deletionsTruncated: false,
    },
  };
}

/** A settings read that succeeded, carrying the given (partial) stored bag. */
function okSettings(bag: Record<string, unknown> = {}): unknown {
  return { ok: true, data: { systemSettings: bag, updatedAt: '2026-07-11T00:00:00.000Z' } };
}

/**
 * Inside the DEFAULT sync window: the registry fallback hour is 7 UTC, and the
 * run tests exercise the flow with an empty bag (fallbacks apply).
 */
const INSIDE_DEFAULT_HOUR = new Date('2026-07-15T07:30:00.000Z');

function makeRedis(cooldownValue: string | null): Redis {
  return {
    get: vi.fn().mockResolvedValue(cooldownValue),
    setex: vi.fn().mockResolvedValue('OK'),
  } as unknown as Redis;
}

/** The rendered description of the single posted embed. */
function postedDescription(): string {
  const [, embed] = mockPostOwnerChannelEmbed.mock.calls[0] as [Client, { data: unknown }];
  const { description } = embed.data as { description?: string };
  return description ?? '';
}

function postedTitle(): string {
  const [, embed] = mockPostOwnerChannelEmbed.mock.calls[0] as [Client, { data: unknown }];
  const { title } = embed.data as { title?: string };
  return title ?? '';
}

/** The attachments third argument of the Nth postOwnerChannelEmbed call. */
function postedFiles(index = 0): { attachment: Buffer; name?: string }[] | undefined {
  const call = mockPostOwnerChannelEmbed.mock.calls[index] as unknown[];
  return call[2] as { attachment: Buffer; name?: string }[] | undefined;
}

const client = {} as Client;

describe('startNightlyDbSyncScheduler boot guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOwnerId = '123456789012345678';
    mockNodeEnv = 'production';
  });

  afterEach(() => {
    stopNightlyDbSyncScheduler();
  });

  it('starts the interval scheduler when an owner id is configured', () => {
    startNightlyDbSyncScheduler(client, makeRedis(null));

    expect(mockSchedulerStart).toHaveBeenCalledTimes(1);
  });

  it('refuses to start when BOT_OWNER_ID is unset (warn once, not a daily failure post)', () => {
    mockOwnerId = undefined;

    startNightlyDbSyncScheduler(client, makeRedis(null));

    expect(mockSchedulerStart).not.toHaveBeenCalled();
  });

  it('refuses to start when BOT_OWNER_ID is an empty string (same emptiness test as getOwnerClient)', () => {
    mockOwnerId = '';

    startNightlyDbSyncScheduler(client, makeRedis(null));

    expect(mockSchedulerStart).not.toHaveBeenCalled();
  });

  it.each(['development', 'test', 'staging'])(
    'refuses to start outside production (NODE_ENV=%s) — the pair must sync from ONE side',
    env => {
      mockNodeEnv = env;

      startNightlyDbSyncScheduler(client, makeRedis(null));

      expect(mockSchedulerStart).not.toHaveBeenCalled();
    }
  );

  it('stop delegates to the interval scheduler', () => {
    stopNightlyDbSyncScheduler();

    expect(mockSchedulerStop).toHaveBeenCalledTimes(1);
  });
});

describe('NightlyDbSyncScheduler runNightlyDbSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(INSIDE_DEFAULT_HOUR);
    vi.clearAllMocks();
    mockPostOwnerChannelEmbed.mockResolvedValue(undefined);
    // Default: settings readable, nothing stored — the registry fallbacks
    // (enabled, 07:00 UTC) apply, and the clock sits inside that hour.
    mockGetSystemSettings.mockResolvedValue(okSettings());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('syncs when the stored bag is empty — the registry fallbacks are enabled at 07:00 UTC', async () => {
    mockDbSync.mockResolvedValue(okResult(QUIET_STATS));
    const redis = makeRedis(null);

    await runNightlyDbSync(client, redis);

    expect(mockDbSync).toHaveBeenCalledTimes(1);
    expect(redis.setex).toHaveBeenCalledTimes(1);
  });

  it('does NOTHING when the nightly sync is switched off', async () => {
    mockGetSystemSettings.mockResolvedValue(okSettings({ nightlySyncEnabled: false }));
    const redis = makeRedis(null);

    await runNightlyDbSync(client, redis);

    expect(mockDbSync).not.toHaveBeenCalled();
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.setex).not.toHaveBeenCalled();
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('does NOTHING on a tick outside the configured hour (and must not arm the cooldown)', async () => {
    // 07:30 UTC on the clock, 3 UTC configured — the boot-anchored bug this
    // gate replaces would have synced here, burning the day's run at deploy
    // time. Arming the cooldown on a skipped tick would be the same bug.
    mockGetSystemSettings.mockResolvedValue(okSettings({ nightlySyncHourUtc: 3 }));
    const redis = makeRedis(null);

    await runNightlyDbSync(client, redis);

    expect(mockDbSync).not.toHaveBeenCalled();
    expect(redis.setex).not.toHaveBeenCalled();
  });

  it('syncs in a NON-default configured hour when the clock matches it', async () => {
    vi.setSystemTime(new Date('2026-07-15T03:05:00.000Z'));
    mockGetSystemSettings.mockResolvedValue(okSettings({ nightlySyncHourUtc: 3 }));
    mockDbSync.mockResolvedValue(okResult(QUIET_STATS));

    await runNightlyDbSync(client, makeRedis(null));

    expect(mockDbSync).toHaveBeenCalledTimes(1);
  });

  it('accepts midnight (hour 0) as a configured hour — a falsy hour is still a real one', async () => {
    vi.setSystemTime(new Date('2026-07-15T00:45:00.000Z'));
    mockGetSystemSettings.mockResolvedValue(okSettings({ nightlySyncHourUtc: 0 }));
    mockDbSync.mockResolvedValue(okResult(QUIET_STATS));

    await runNightlyDbSync(client, makeRedis(null));

    expect(mockDbSync).toHaveBeenCalledTimes(1);
  });

  it('skips the tick when the settings read fails — never syncs on unknown config', async () => {
    mockGetSystemSettings.mockResolvedValue({
      ok: false,
      kind: 'http',
      status: 503,
      error: 'gateway unavailable',
    });
    const redis = makeRedis(null);

    await runNightlyDbSync(client, redis);

    expect(mockDbSync).not.toHaveBeenCalled();
    // The cooldown must stay unarmed: an unreadable-settings tick has to be a
    // no-op, not a silent consumption of the day's single run.
    expect(redis.setex).not.toHaveBeenCalled();
    // And it stays quiet — this runs every 15 minutes; a post per tick would
    // turn a gateway blip into ~96 owner-channel messages.
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('reads settings BEFORE touching the cooldown key', async () => {
    mockDbSync.mockResolvedValue(okResult(QUIET_STATS));
    const redis = makeRedis(null);

    await runNightlyDbSync(client, redis);

    const settingsOrder = mockGetSystemSettings.mock.invocationCallOrder[0];
    const getOrder = (redis.get as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(settingsOrder).toBeLessThan(getOrder);
  });

  it('runs a REAL sync with the manual command defaults', async () => {
    mockDbSync.mockResolvedValue(okResult(QUIET_STATS));

    await runNightlyDbSync(client, makeRedis(null));

    // Seam assertion: dryRun MUST be false (a dry run would report work it
    // never did) and the skew override MUST stay off, matching /admin db-sync.
    expect(mockDbSync).toHaveBeenCalledWith({ dryRun: false, allowSchemaSkew: false });
  });

  it('arms the daily cooldown before calling the gateway (deploys must not re-sync)', async () => {
    mockDbSync.mockResolvedValue(okResult(QUIET_STATS));
    const redis = makeRedis(null);

    await runNightlyDbSync(client, redis);

    expect(redis.setex).toHaveBeenCalledWith(
      'nightly-db-sync:cooldown',
      23 * 60 * 60,
      expect.any(String)
    );
    const setexOrder = (redis.setex as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(setexOrder).toBeLessThan(mockDbSync.mock.invocationCallOrder[0]);
  });

  it('does NOT sync at all while the cooldown key exists', async () => {
    const redis = makeRedis('2026-07-15T00:00:00.000Z');

    await runNightlyDbSync(client, redis);

    expect(mockDbSync).not.toHaveBeenCalled();
    expect(redis.setex).not.toHaveBeenCalled();
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('posts NOTHING when the sync moved no rows', async () => {
    mockDbSync.mockResolvedValue(okResult(QUIET_STATS));

    await runNightlyDbSync(client, makeRedis(null));

    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('posts a warning embed when a zero-change sync carries warnings (quiet-failure shape)', async () => {
    mockDbSync.mockResolvedValue(okResult(QUIET_STATS, ['deletion propagation skipped: users']));

    await runNightlyDbSync(client, makeRedis(null));

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(postedTitle()).toContain('completed with warnings');
    expect(postedDescription()).toContain('1 warning(s)');
  });

  it('attaches the full report, carrying the warning TEXT the embed only counts', async () => {
    mockDbSync.mockResolvedValue(okResult(QUIET_STATS, ['deletion propagation skipped: users']));

    await runNightlyDbSync(client, makeRedis(null));

    // The embed promises an attached report — the promise is only true if the
    // warning body actually reaches the file.
    expect(postedDescription()).toContain('full list in the attached report');
    const files = postedFiles();
    expect(files).toHaveLength(1);
    const body = files?.[0].attachment.toString('utf-8') ?? '';
    expect(body).toContain('# Database Sync Report');
    expect(body).toContain('- deletion propagation skipped: users');
    expect(files?.[0].name).toBe('nightly-db-sync-report.md');
  });

  it('sends the failure posts without an attachment (no report exists)', async () => {
    mockDbSync.mockResolvedValue({
      ok: false,
      kind: 'http',
      status: 503,
      error: 'schema version mismatch',
    });

    await runNightlyDbSync(client, makeRedis(null));

    expect(postedFiles()).toBeUndefined();

    // The throw path is the second failure post shape.
    vi.clearAllMocks();
    mockGetSystemSettings.mockResolvedValue(okSettings());
    mockDbSync.mockRejectedValue(new Error('gateway unreachable'));

    await runNightlyDbSync(client, makeRedis(null));

    expect(postedFiles()).toBeUndefined();
  });

  it('posts an owner-channel summary carrying the per-table counts when rows moved', async () => {
    mockDbSync.mockResolvedValue(okResult(BUSY_STATS));

    await runNightlyDbSync(client, makeRedis(null));

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(postedTitle()).toContain('Nightly database sync applied changes');
    const description = postedDescription();
    expect(description).toContain(
      '**2 tables** · 3 dev→prod · 1 prod→dev · 2 conflicts · 5 deleted'
    );
    expect(description).toContain('`users`: 3 dev→prod, 1 prod→dev');
    expect(description).toContain('`personas`: 0 dev→prod, 0 prod→dev, 2 conflicts, 5 deleted');
    // A real run must never render the dry-run disclaimer.
    expect(description).not.toContain('Dry run');
  });

  it('posts a failure embed on an error result, carrying status and message', async () => {
    mockDbSync.mockResolvedValue({
      ok: false,
      kind: 'http',
      status: 503,
      error: 'schema version mismatch',
    });

    await runNightlyDbSync(client, makeRedis(null));

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(postedTitle()).toContain('Nightly database sync failed');
    expect(postedDescription()).toContain('HTTP 503');
    expect(postedDescription()).toContain('schema version mismatch');
  });

  it('posts a failure embed when the call throws, and never rethrows', async () => {
    mockDbSync.mockRejectedValue(new Error('gateway unreachable'));

    await expect(runNightlyDbSync(client, makeRedis(null))).resolves.toBeUndefined();

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(postedTitle()).toContain('Nightly database sync failed');
    expect(postedDescription()).toContain('gateway unreachable');
  });

  it('neutralizes fence breaks in provider error text before embedding it', async () => {
    mockDbSync.mockResolvedValue({
      ok: false,
      kind: 'http',
      status: 500,
      error: 'broke the fence ``` and spilled',
    });

    await runNightlyDbSync(client, makeRedis(null));

    // The raw triple-backtick run must not survive into the description —
    // Discord closes a fence at ANY ``` occurrence, mid-line included.
    // escapeFenceBreaks interleaves zero-width spaces, written as explicit
    // escapes because the character is invisible in source.
    expect(postedDescription()).toContain('broke the fence `\u200b`\u200b` and spilled');
  });

  it('posts a failure embed when the cooldown read itself throws', async () => {
    const redis = {
      get: vi.fn().mockRejectedValue(new Error('redis down')),
      setex: vi.fn(),
    } as unknown as Redis;

    await expect(runNightlyDbSync(client, redis)).resolves.toBeUndefined();

    expect(mockDbSync).not.toHaveBeenCalled();
    expect(postedDescription()).toContain('redis down');
  });
});

describe('startup-run gateway-not-ready retry', () => {
  const NOT_FOUND_404: GatewayFailure = {
    ok: false,
    kind: 'http',
    error: 'not found',
    status: 404,
  };
  const NETWORK_FAILURE: GatewayFailure = {
    ok: false,
    kind: 'network',
    error: 'fetch failed',
    status: 0,
  };
  const UNAVAILABLE_503: GatewayFailure = {
    ok: false,
    kind: 'http',
    error: 'unavailable',
    status: 503,
  };
  const GATEWAY_TIMEOUT_504: GatewayFailure = {
    ok: false,
    kind: 'http',
    error: 'gateway timeout',
    status: 504,
  };
  const CLIENT_TIMEOUT: GatewayFailure = {
    ok: false,
    kind: 'timeout',
    error: 'client timed out',
    status: 0,
  };
  const SERVER_ERROR_500: GatewayFailure = { ok: false, kind: 'http', error: 'boom', status: 500 };

  const FIVE_MINUTES_MS = 5 * 60 * 1000;
  const TEN_MINUTES_MS = 10 * 60 * 1000;
  const COOLDOWN_KEY = 'nightly-db-sync:cooldown';

  /** Inside the default configured hour (registry fallback: 07:00 UTC). */
  const INSIDE_HOUR = new Date('2026-07-15T07:30:00.000Z');

  /** A stateful in-memory redis fake: get/setex/del all mutate one cooldown slot. */
  function makeStatefulRedis(initial: string | null = null): Redis {
    let cooldown = initial;
    return {
      get: vi.fn().mockImplementation(() => Promise.resolve(cooldown)),
      setex: vi.fn().mockImplementation((_key: string, _ttl: number, value: string) => {
        cooldown = value;
        return Promise.resolve('OK');
      }),
      del: vi.fn().mockImplementation(() => {
        cooldown = null;
        return Promise.resolve(1);
      }),
    } as unknown as Redis;
  }

  /** Same shape as makeStatefulRedis, but `del` rejects — cooldown-release-failure case. */
  function makeStatefulRedisWithFailingDel(initial: string | null = null): Redis {
    let cooldown = initial;
    return {
      get: vi.fn().mockImplementation(() => Promise.resolve(cooldown)),
      setex: vi.fn().mockImplementation((_key: string, _ttl: number, value: string) => {
        cooldown = value;
        return Promise.resolve('OK');
      }),
      del: vi.fn().mockRejectedValue(new Error('redis connection reset')),
    } as unknown as Redis;
  }

  /** Runs the module's real `run` wrapper as a scheduler-triggered startup run. */
  async function startupRun(redis: Redis): Promise<void> {
    startNightlyDbSyncScheduler(client, redis);
    if (capturedRun.current === null) {
      throw new Error('createIntervalScheduler mock never captured a run option');
    }
    await capturedRun.current(client, redis);
  }

  /** Runs the module's real `run` wrapper as a non-startup (interval) run. */
  async function intervalRun(redis: Redis): Promise<void> {
    if (capturedRun.current === null) {
      throw new Error('createIntervalScheduler mock never captured a run option');
    }
    await capturedRun.current(client, redis);
  }

  function lastPostedTitle(): string {
    const call = mockPostOwnerChannelEmbed.mock.calls.at(-1) as [Client, { data: unknown }];
    const { title } = call[1].data as { title?: string };
    return title ?? '';
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(INSIDE_HOUR);
    mockDbSync.mockReset();
    mockPostOwnerChannelEmbed.mockReset().mockResolvedValue(undefined);
    mockGetSystemSettings.mockReset().mockResolvedValue(okSettings());
    mockOwnerId = '123456789012345678';
    mockNodeEnv = 'production';
  });

  afterEach(() => {
    stopNightlyDbSyncScheduler();
    vi.useRealTimers();
  });

  it('startup not-ready then successful retry performs the sync', async () => {
    const redis = makeStatefulRedis(null);
    mockDbSync.mockResolvedValueOnce(NETWORK_FAILURE);
    mockDbSync.mockResolvedValueOnce(okResult(BUSY_STATS));

    await startupRun(redis);

    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
    expect(await redis.get(COOLDOWN_KEY)).toBeNull();

    await vi.advanceTimersByTimeAsync(FIVE_MINUTES_MS);

    expect(mockDbSync).toHaveBeenCalledTimes(2);
    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(lastPostedTitle()).toContain('applied changes');
    expect(await redis.get(COOLDOWN_KEY)).not.toBeNull();
  });

  it('startup 404 retry lands past the hour boundary and still syncs', async () => {
    vi.setSystemTime(new Date('2026-07-15T07:58:00.000Z'));
    const redis = makeStatefulRedis(null);
    mockDbSync.mockResolvedValueOnce(NOT_FOUND_404);
    mockDbSync.mockResolvedValueOnce(okResult(BUSY_STATS));

    await startupRun(redis);
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES_MS);

    expect(mockDbSync).toHaveBeenCalledTimes(2);
    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(lastPostedTitle()).toContain('applied changes');
  });

  it('retry honours the enabled switch', async () => {
    const redis = makeStatefulRedis(null);
    mockDbSync.mockResolvedValueOnce(NOT_FOUND_404);

    await startupRun(redis);
    mockGetSystemSettings.mockResolvedValue(okSettings({ nightlySyncEnabled: false }));

    await vi.advanceTimersByTimeAsync(FIVE_MINUTES_MS);

    expect(mockDbSync).toHaveBeenCalledTimes(1);
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('retry failure posts exactly once and keeps the cooldown armed', async () => {
    const redis = makeStatefulRedis(null);
    mockDbSync.mockResolvedValueOnce(UNAVAILABLE_503);
    mockDbSync.mockResolvedValueOnce(UNAVAILABLE_503);

    await startupRun(redis);
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES_MS);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(await redis.get(COOLDOWN_KEY)).not.toBeNull();

    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(mockDbSync).toHaveBeenCalledTimes(2);
  });

  it('interval-run not-ready failure posts immediately and keeps the cooldown', async () => {
    vi.setSystemTime(new Date('2026-07-15T03:00:00.000Z'));
    const redis = makeStatefulRedis(null);

    // Consumes the startup flag while outside the configured hour — dbSync
    // is never called, so the next captured-run call is an ordinary
    // interval run.
    await startupRun(redis);
    expect(mockDbSync).not.toHaveBeenCalled();

    vi.setSystemTime(INSIDE_HOUR);
    mockDbSync.mockResolvedValueOnce(NETWORK_FAILURE);
    const timerCountBefore = vi.getTimerCount();

    await intervalRun(redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(redis.del).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(timerCountBefore);
  });

  it('startup timeout is not retried — posts and keeps the cooldown', async () => {
    const redis = makeStatefulRedis(null);
    mockDbSync.mockResolvedValueOnce(CLIENT_TIMEOUT);

    await startupRun(redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(redis.del).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS);

    expect(mockDbSync).toHaveBeenCalledTimes(1);
    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
  });

  it('startup 504 is not retried', async () => {
    const redis = makeStatefulRedis(null);
    mockDbSync.mockResolvedValueOnce(GATEWAY_TIMEOUT_504);

    await startupRun(redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(redis.del).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS);

    expect(mockDbSync).toHaveBeenCalledTimes(1);
    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
  });

  it('startup 500 posts immediately', async () => {
    const redis = makeStatefulRedis(null);
    mockDbSync.mockResolvedValueOnce(SERVER_ERROR_500);

    await startupRun(redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(mockDbSync).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop clears the pending retry', async () => {
    const redis = makeStatefulRedis(null);
    mockDbSync.mockResolvedValueOnce(NOT_FOUND_404);

    await startupRun(redis);
    stopNightlyDbSyncScheduler();

    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS);

    expect(mockDbSync).toHaveBeenCalledTimes(1);
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('double start does not re-arm the startup flag', async () => {
    const redis = makeStatefulRedis(null);
    // Outside the configured hour, so the startup run consumes the flag
    // without ever calling dbSync.
    mockGetSystemSettings.mockResolvedValue(okSettings({ nightlySyncHourUtc: 3 }));

    await startupRun(redis);
    expect(mockDbSync).not.toHaveBeenCalled();

    // A second start call must not re-arm the flag: the next captured run
    // should be treated as an ordinary (non-startup) check.
    startNightlyDbSyncScheduler(client, redis);

    mockGetSystemSettings.mockResolvedValue(okSettings());
    mockDbSync.mockResolvedValueOnce(NETWORK_FAILURE);

    await intervalRun(redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
  });

  it('a tick overlapping the retry skips on the cooldown', async () => {
    const redis = makeStatefulRedis(null);
    let resolveRetryDbSync: (value: unknown) => void = () => {
      /* replaced below */
    };
    const deferredDbSync = new Promise(resolve => {
      resolveRetryDbSync = resolve;
    });
    mockDbSync.mockResolvedValueOnce(NOT_FOUND_404);
    mockDbSync.mockImplementationOnce(() => deferredDbSync);

    await startupRun(redis);
    expect(mockDbSync).toHaveBeenCalledTimes(1);

    // Fire the retry timer. Its dbSync call is now in flight (deferred) —
    // by this point it has already re-armed the cooldown, since setex runs
    // before the dbSync call. Fully awaiting the advance is safe: nothing
    // left pending is a TIMER (the deferred dbSync promise isn't one), so
    // the advance settles once the retry's chain blocks on it.
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES_MS);

    expect(mockDbSync).toHaveBeenCalledTimes(2);
    expect(await redis.get(COOLDOWN_KEY)).not.toBeNull();

    // A concurrent interval tick must see the cooldown the in-flight retry
    // already armed, and skip rather than starting a third sync.
    await intervalRun(redis);

    expect(mockDbSync).toHaveBeenCalledTimes(2);

    resolveRetryDbSync(okResult(QUIET_STATS));
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(mockDbSync).toHaveBeenCalledTimes(2);
  });

  it('a stop that lands while the startup dbSync call is still in flight wins — no retry arms after', async () => {
    const redis = makeStatefulRedis(null);
    let resolveDbSync: (value: unknown) => void = () => {
      /* replaced below */
    };
    const deferredDbSync = new Promise(resolve => {
      resolveDbSync = resolve;
    });
    mockDbSync.mockImplementationOnce(() => deferredDbSync);

    const startupRunPromise = startupRun(redis);
    stopNightlyDbSyncScheduler();
    resolveDbSync(UNAVAILABLE_503);
    await startupRunPromise;

    await vi.advanceTimersByTimeAsync(FIVE_MINUTES_MS);

    expect(mockDbSync).toHaveBeenCalledTimes(1);
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('a cooldown release failure reports the not-ready failure now instead of retrying', async () => {
    const redis = makeStatefulRedisWithFailingDel(null);
    mockDbSync.mockResolvedValueOnce(UNAVAILABLE_503);

    await startupRun(redis);

    // Exactly one failure post, and it's the ordinary failure embed for the
    // gateway result — NOT the "threw before completing" catch-all text.
    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(lastPostedTitle()).toContain('Nightly database sync failed');
    const [, embed] = mockPostOwnerChannelEmbed.mock.calls[0] as [Client, { data: unknown }];
    const { description } = embed.data as { description?: string };
    expect(description).not.toContain('threw before completing');
    expect(description).toContain('503');

    // No retry was scheduled: dbSync stays at one call past the retry delay.
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES_MS);

    expect(mockDbSync).toHaveBeenCalledTimes(1);
  });

  it('a 409 DB_SYNC_IN_PROGRESS on the startup-retry trigger posts nothing, cooldown untouched', async () => {
    const redis = makeStatefulRedis(null);
    mockDbSync.mockResolvedValueOnce({
      ok: false,
      kind: 'http',
      status: 409,
      error: 'A database sync is already running. Wait for it to finish.',
      code: API_ERROR_SUBCODE.DB_SYNC_IN_PROGRESS,
    });

    await runNightlyDbSync(client, redis, 'startup-retry');

    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
    expect(await redis.get(COOLDOWN_KEY)).not.toBeNull();
  });

  it('a 409 DB_SYNC_IN_PROGRESS on an interval trigger posts nothing, cooldown untouched', async () => {
    const redis = makeStatefulRedis(null);
    mockDbSync.mockResolvedValueOnce({
      ok: false,
      kind: 'http',
      status: 409,
      error: 'A database sync is already running (interval trigger fixture).',
      code: API_ERROR_SUBCODE.DB_SYNC_IN_PROGRESS,
    });

    await runNightlyDbSync(client, redis, 'interval');
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
    expect(await redis.get(COOLDOWN_KEY)).not.toBeNull();
  });

  it('a 409 DB_SYNC_IN_PROGRESS on the startup trigger posts nothing, keeps the cooldown and arms no retry', async () => {
    const redis = makeStatefulRedis(null);
    mockDbSync.mockResolvedValueOnce({
      ok: false,
      kind: 'http',
      status: 409,
      error: 'A database sync is already running (startup trigger fixture).',
      code: API_ERROR_SUBCODE.DB_SYNC_IN_PROGRESS,
    });

    await startupRun(redis);

    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
    expect(await redis.get(COOLDOWN_KEY)).not.toBeNull();

    // No retry was scheduled: dbSync stays at one call past the retry delay.
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES_MS);

    expect(mockDbSync).toHaveBeenCalledTimes(1);
  });

  it('a plain 409 without the DB_SYNC_IN_PROGRESS subcode still posts the failure embed', async () => {
    const redis = makeStatefulRedis(null);
    mockDbSync.mockResolvedValueOnce({
      ok: false,
      kind: 'http',
      status: 409,
      error: 'conflict without a subcode',
    });
    await runNightlyDbSync(client, redis, 'interval');
    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(lastPostedTitle()).toContain('Nightly database sync failed');
  });
});
