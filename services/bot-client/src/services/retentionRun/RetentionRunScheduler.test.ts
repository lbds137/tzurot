/**
 * Wiring test for the retention job scheduler. Runs the REAL
 * retentionLiveRun / retentionRunLease / retentionRunReport / retentionNag /
 * retentionRehearsal modules end-to-end; mocks only the external boundary
 * (the gateway client, the owner-channel poster, config, the interval
 * scheduler, and Redis).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Client } from 'discord.js';
import type { Redis } from 'ioredis';
import type { RetentionPreviewResponse } from '@tzurot/common-types/schemas/api/internal';
import type { RetentionPreviewUser } from './types.js';
import { PENDING_REPORT_KEY } from './retentionPendingReport.js';

let mockNodeEnv: 'production' | 'development' | 'test' = 'production';
let mockAutorunEnabled = true;
vi.mock('@tzurot/common-types/config/config', () => ({
  getConfig: () => ({ NODE_ENV: mockNodeEnv, RETENTION_AUTORUN_ENABLED: mockAutorunEnabled }),
}));

// vi.hoisted: the module under test calls createIntervalScheduler at import
// time, so plain consts would not be initialized when the factory runs.
// getCapturedRun exposes the real `run` option the module passed in, so a
// test can invoke it directly and prove it delegates to runRetentionTick
// rather than merely existing.
const { mockSchedulerStart, mockSchedulerStop, getCapturedRun, setCapturedRun } = vi.hoisted(() => {
  let capturedRun: ((client: Client, redis: Redis) => Promise<void>) | undefined;
  return {
    mockSchedulerStart: vi.fn(),
    mockSchedulerStop: vi.fn(),
    getCapturedRun: (): typeof capturedRun => capturedRun,
    setCapturedRun: (fn: typeof capturedRun): void => {
      capturedRun = fn;
    },
  };
});
vi.mock('@tzurot/common-types/utils/intervalScheduler', () => ({
  createIntervalScheduler: (options: { run: (client: Client, redis: Redis) => Promise<void> }) => {
    setCapturedRun(options.run);
    return { start: mockSchedulerStart, stop: mockSchedulerStop };
  },
}));

const mockServiceClient = {
  retentionPreview: vi.fn(),
  retentionRunBegin: vi.fn(),
  retentionRunEnd: vi.fn(),
  retentionNotify: vi.fn(),
  retentionPurge: vi.fn(),
  retentionReconcileOffDb: vi.fn(),
};
vi.mock('../../utils/gatewayClients.js', () => ({
  getServiceClient: () => mockServiceClient,
}));

const mockPostOwnerChannelEmbed = vi.fn();
vi.mock('../../utils/ownerChannel.js', () => ({
  postOwnerChannelEmbed: (...args: unknown[]) => mockPostOwnerChannelEmbed(...args),
}));

import {
  resolveRetentionRunMode,
  startRetentionRunScheduler,
  stopRetentionRunScheduler,
  runRetentionTick,
} from './RetentionRunScheduler.js';

const RUN_ID = '3f2b8c1e-9d4a-4c5b-8e7f-1a2b3c4d5e6f';

function makeUser(id: string): RetentionPreviewUser {
  return {
    discordId: id,
    username: `user-${id}`,
    inactiveSince: '2025-09-01T00:00:00.000Z',
    reason: 'unreachable',
    ownedCharacters: { toDelete: 1, toReHome: 0 },
  };
}

function makePreview(
  users: RetentionPreviewUser[],
  overrides: { breakerWarning?: boolean } = {}
): RetentionPreviewResponse {
  return {
    users,
    totals: {
      eligibleCount: users.length,
      userbaseCount: 300,
      percentOfUserbase: 1,
      charactersToDelete: users.length,
      charactersToReHome: 0,
      breakerWarning: overrides.breakerWarning ?? false,
      reachableToNotify: 0,
      inGrace: 0,
      graceExpired: 0,
      bystander: 0,
      scope: { kind: 'unrestricted', excludedEligibleCount: 0 },
    },
  } satisfies RetentionPreviewResponse;
}

const quietNotifyData = {
  status: 'empty' as const,
  cohortSize: 0,
  userbaseCount: 300,
  percentOfUserbase: 0,
  breakerWarning: false,
  batchesEnqueued: 0,
  recipients: [],
};

function purgedResponse(discordId: string) {
  return {
    ok: true,
    data: { discordId, status: 'purged' as const, charactersDeleted: 1, charactersReHomed: 0 },
  };
}

function makeRedis(
  cooldownValue: string | null,
  pendingReportValue: string | null = null
): Redis & {
  get: ReturnType<typeof vi.fn>;
  setex: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
} {
  return {
    get: vi.fn(async (key: string) =>
      key === PENDING_REPORT_KEY ? pendingReportValue : cooldownValue
    ),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  } as unknown as Redis & {
    get: ReturnType<typeof vi.fn>;
    setex: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
  };
}

const client = {} as Client;

function neverCalledLiveRoutes(): void {
  expect(mockServiceClient.retentionRunBegin).not.toHaveBeenCalled();
  expect(mockServiceClient.retentionPurge).not.toHaveBeenCalled();
  expect(mockServiceClient.retentionRunEnd).not.toHaveBeenCalled();
  expect(mockServiceClient.retentionReconcileOffDb).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockNodeEnv = 'production';
  mockAutorunEnabled = true;
  mockPostOwnerChannelEmbed.mockResolvedValue(true);
  mockServiceClient.retentionNotify.mockResolvedValue({ ok: true, data: quietNotifyData });
  mockServiceClient.retentionReconcileOffDb.mockResolvedValue({
    ok: true,
    data: { settled: 0, stillFailing: 0, remaining: 0 },
  });
  mockServiceClient.retentionRunEnd.mockResolvedValue({ ok: true, data: { released: true } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveRetentionRunMode', () => {
  it.each([
    ['production', true, 'live'],
    ['production', false, 'nag'],
    ['development', true, 'rehearsal'],
    ['development', false, 'rehearsal'],
    ['test', true, 'rehearsal'],
    ['test', false, 'rehearsal'],
  ] as const)('NODE_ENV=%s, RETENTION_AUTORUN_ENABLED=%s → %s', (env, enabled, expected) => {
    mockNodeEnv = env;
    mockAutorunEnabled = enabled;
    expect(resolveRetentionRunMode()).toBe(expected);
  });
});

describe('start/stop', () => {
  it('starts the interval scheduler in production', () => {
    mockNodeEnv = 'production';
    startRetentionRunScheduler(client, makeRedis(null));
    expect(mockSchedulerStart).toHaveBeenCalledTimes(1);
  });

  it('starts the interval scheduler in development too (rehearsal mode still ticks)', () => {
    mockNodeEnv = 'development';
    startRetentionRunScheduler(client, makeRedis(null));
    expect(mockSchedulerStart).toHaveBeenCalledTimes(1);
  });

  it('stop delegates to the interval scheduler', () => {
    stopRetentionRunScheduler();
    expect(mockSchedulerStop).toHaveBeenCalledTimes(1);
  });
});

describe('the scheduler run option', () => {
  it('delegates to runRetentionTick rather than re-implementing the dispatch', async () => {
    mockNodeEnv = 'development';
    mockServiceClient.retentionPreview.mockResolvedValue({ ok: true, data: makePreview([]) });
    const redis = makeRedis(null);
    const run = getCapturedRun();

    expect(run).toBeDefined();
    await run?.(client, redis);

    // Only runRetentionTick's rehearsal branch calls notify with dryRun:
    // true — reaching that call proves the captured option is the real
    // dispatcher, not a stand-in.
    expect(mockServiceClient.retentionNotify).toHaveBeenCalledWith({
      dryRun: true,
      runContext: 'job:retention-rehearsal',
    });
  });
});

describe('runRetentionTick — non-production (rehearsal mode)', () => {
  it('calls preview and notify ONLY with dryRun: true, never touches live-run routes', async () => {
    mockNodeEnv = 'development';
    mockAutorunEnabled = true;
    mockServiceClient.retentionPreview.mockResolvedValue({ ok: true, data: makePreview([]) });
    const redis = makeRedis(null);

    await runRetentionTick(client, redis);

    expect(mockServiceClient.retentionPreview).toHaveBeenCalledTimes(1);
    expect(mockServiceClient.retentionNotify).toHaveBeenCalledWith({
      dryRun: true,
      runContext: 'job:retention-rehearsal',
    });
    neverCalledLiveRoutes();
  });
});

describe('runRetentionTick — production, kill switch OFF (nag mode)', () => {
  it('posts the nag embed and never calls begin/purge/notify', async () => {
    mockAutorunEnabled = false;
    mockServiceClient.retentionPreview.mockResolvedValue({
      ok: true,
      data: makePreview([makeUser('1')]),
    });
    const redis = makeRedis(null);

    await runRetentionTick(client, redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    const embed = mockPostOwnerChannelEmbed.mock.calls[0]?.[1] as {
      toJSON: () => { title?: string };
    };
    expect(embed.toJSON().title).toBe('🗑️ Accounts eligible for retention purge');
    expect(mockServiceClient.retentionNotify).not.toHaveBeenCalled();
    neverCalledLiveRoutes();
  });

  it('replays a stashed live report before the nag check, so a kill-switch flip does not strand it', async () => {
    mockAutorunEnabled = false;
    const stashedPayload = JSON.stringify({
      storedAt: '2026-07-19T00:00:00.000Z',
      embed: { title: '🗑️ Daily retention run', description: 'Purged 1' },
    });
    const redis = makeRedis(null, stashedPayload);
    mockServiceClient.retentionPreview.mockResolvedValue({
      ok: true,
      data: makePreview([makeUser('1')]),
    });
    mockPostOwnerChannelEmbed.mockResolvedValue(true);

    await runRetentionTick(client, redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(2);
    expect(redis.del).toHaveBeenCalledWith(PENDING_REPORT_KEY);
    const replayedEmbed = mockPostOwnerChannelEmbed.mock.calls[0]?.[1] as {
      toJSON: () => { title?: string };
    };
    expect(replayedEmbed.toJSON().title).toBe('🗑️ Daily retention run');
    expect(mockServiceClient.retentionRunBegin).not.toHaveBeenCalled();
    expect(mockServiceClient.retentionPurge).not.toHaveBeenCalled();
  });
});

describe('runRetentionTick — production, kill switch ON (live mode)', () => {
  it('runs the happy path in order and posts the report; begin/end carry the right payloads', async () => {
    const order: string[] = [];
    const redis = makeRedis(null);
    redis.get.mockImplementation(async (key: string) => {
      order.push(key === PENDING_REPORT_KEY ? 'pending-read' : 'cooldown-read');
      return null;
    });
    redis.setex.mockImplementation(async () => {
      order.push('cooldown-arm');
      return 'OK';
    });
    mockServiceClient.retentionPreview.mockImplementation(async () => {
      order.push('preview');
      return { ok: true, data: makePreview([makeUser('1'), makeUser('2')]) };
    });
    mockServiceClient.retentionRunBegin.mockImplementation(async () => {
      order.push('begin');
      return { ok: true, data: { runId: RUN_ID, leaseTtlMs: 600000 } };
    });
    mockServiceClient.retentionNotify.mockImplementation(async () => {
      order.push('notify');
      return { ok: true, data: quietNotifyData };
    });
    mockServiceClient.retentionPurge.mockImplementation(async (input: { discordId: string }) => {
      order.push('purge');
      return purgedResponse(input.discordId);
    });
    mockServiceClient.retentionReconcileOffDb.mockImplementation(async () => {
      order.push('reconcile');
      return { ok: true, data: { settled: 0, stillFailing: 0, remaining: 0 } };
    });
    mockServiceClient.retentionRunEnd.mockImplementation(async () => {
      order.push('end');
      return { ok: true, data: { released: true } };
    });

    await runRetentionTick(client, redis);

    expect(order).toEqual([
      'pending-read',
      'cooldown-read',
      'preview',
      'begin',
      'cooldown-arm',
      'notify',
      'purge',
      'purge',
      'reconcile',
      'end',
    ]);
    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(mockServiceClient.retentionRunBegin).toHaveBeenCalledWith({
      runContext: 'job:retention-daily',
    });
    expect(mockServiceClient.retentionRunEnd).toHaveBeenCalledWith({ runId: RUN_ID });
  });

  it('lease busy: no notify/purge/end calls, cooldown NOT armed, nothing posted', async () => {
    mockServiceClient.retentionPreview.mockResolvedValue({
      ok: true,
      data: makePreview([makeUser('1')]),
    });
    mockServiceClient.retentionRunBegin.mockResolvedValue({
      ok: false,
      kind: 'http',
      error: 'Another retention run is in progress: "cli" (since 2026-01-01T00:00:00.000Z).',
      status: 409,
      code: 'RUN_IN_PROGRESS',
    });
    const redis = makeRedis(null);

    await runRetentionTick(client, redis);

    expect(mockServiceClient.retentionNotify).not.toHaveBeenCalled();
    expect(mockServiceClient.retentionPurge).not.toHaveBeenCalled();
    expect(mockServiceClient.retentionRunEnd).not.toHaveBeenCalled();
    expect(redis.setex).not.toHaveBeenCalled();
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('begin failing otherwise (network): same as busy — no cooldown, nothing posted', async () => {
    mockServiceClient.retentionPreview.mockResolvedValue({
      ok: true,
      data: makePreview([makeUser('1')]),
    });
    mockServiceClient.retentionRunBegin.mockResolvedValue({
      ok: false,
      kind: 'network',
      error: 'ECONNREFUSED',
      status: 0,
    });
    const redis = makeRedis(null);

    await runRetentionTick(client, redis);

    expect(mockServiceClient.retentionNotify).not.toHaveBeenCalled();
    expect(redis.setex).not.toHaveBeenCalled();
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('pre-run preview failure: no begin, no cooldown, no post', async () => {
    mockServiceClient.retentionPreview.mockResolvedValue({
      ok: false,
      kind: 'network',
      error: 'gateway down',
      status: 0,
    });
    const redis = makeRedis(null);

    await runRetentionTick(client, redis);

    expect(mockServiceClient.retentionRunBegin).not.toHaveBeenCalled();
    expect(redis.setex).not.toHaveBeenCalled();
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('cooldown present: reads the pending report and the cooldown, nothing else', async () => {
    const redis = makeRedis('2026-07-20T00:00:00.000Z');

    await runRetentionTick(client, redis);

    expect(redis.get).toHaveBeenCalledTimes(2);
    expect(redis.get).toHaveBeenNthCalledWith(1, PENDING_REPORT_KEY);
    expect(redis.get).toHaveBeenNthCalledWith(2, 'retention-run:cooldown');
    expect(mockServiceClient.retentionPreview).not.toHaveBeenCalled();
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('every purge failing: cooldown IS armed, end IS called, report posted (failed > 0)', async () => {
    mockServiceClient.retentionPreview.mockResolvedValue({
      ok: true,
      data: makePreview([makeUser('1'), makeUser('2')]),
    });
    mockServiceClient.retentionRunBegin.mockResolvedValue({
      ok: true,
      data: { runId: RUN_ID, leaseTtlMs: 600000 },
    });
    mockServiceClient.retentionPurge.mockResolvedValue({
      ok: false,
      kind: 'http',
      error: 'boom',
      status: 500,
    });
    const redis = makeRedis(null);

    await runRetentionTick(client, redis);

    expect(redis.setex).toHaveBeenCalledWith(
      'retention-run:cooldown',
      23 * 60 * 60,
      expect.any(String)
    );
    expect(mockServiceClient.retentionRunEnd).toHaveBeenCalledWith({ runId: RUN_ID });
    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
  });

  it('a throw escaping the run body still releases the lease, and the tick resolves', async () => {
    mockServiceClient.retentionPreview.mockResolvedValue({
      ok: true,
      data: makePreview([makeUser('1')]),
    });
    mockServiceClient.retentionRunBegin.mockResolvedValue({
      ok: true,
      data: { runId: RUN_ID, leaseTtlMs: 600000 },
    });
    const redis = makeRedis(null);
    redis.setex.mockRejectedValue(new Error('redis down'));

    await expect(runRetentionTick(client, redis)).resolves.toBeUndefined();

    expect(mockServiceClient.retentionRunEnd).toHaveBeenCalledWith({ runId: RUN_ID });
  });

  it('quiet run (0 eligible, notify empty): cooldown armed, end called, nothing posted', async () => {
    mockServiceClient.retentionPreview.mockResolvedValue({ ok: true, data: makePreview([]) });
    mockServiceClient.retentionRunBegin.mockResolvedValue({
      ok: true,
      data: { runId: RUN_ID, leaseTtlMs: 600000 },
    });
    const redis = makeRedis(null);

    await runRetentionTick(client, redis);

    expect(redis.setex).toHaveBeenCalledTimes(1);
    expect(mockServiceClient.retentionRunEnd).toHaveBeenCalledWith({ runId: RUN_ID });
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('quiet purges/notify but reconcile stillFailing > 0 → report posted', async () => {
    mockServiceClient.retentionPreview.mockResolvedValue({ ok: true, data: makePreview([]) });
    mockServiceClient.retentionRunBegin.mockResolvedValue({
      ok: true,
      data: { runId: RUN_ID, leaseTtlMs: 600000 },
    });
    mockServiceClient.retentionReconcileOffDb.mockResolvedValue({
      ok: true,
      data: { settled: 0, stillFailing: 1, remaining: 0 },
    });
    const redis = makeRedis(null);

    await runRetentionTick(client, redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
  });

  it('reconcile hit the cap with rows not yet attempted → report posted', async () => {
    mockServiceClient.retentionPreview.mockResolvedValue({ ok: true, data: makePreview([]) });
    mockServiceClient.retentionRunBegin.mockResolvedValue({
      ok: true,
      data: { runId: RUN_ID, leaseTtlMs: 600000 },
    });
    // Never settles to remaining: 0, so the loop runs every iteration and
    // exits at MAX_RECONCILE_ITERATIONS with rows still unattempted.
    mockServiceClient.retentionReconcileOffDb.mockResolvedValue({
      ok: true,
      data: { settled: 0, stillFailing: 0, remaining: 1 },
    });
    const redis = makeRedis(null);

    await runRetentionTick(client, redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
  });

  it('one purge → posted', async () => {
    mockServiceClient.retentionPreview.mockResolvedValue({
      ok: true,
      data: makePreview([makeUser('1')]),
    });
    mockServiceClient.retentionRunBegin.mockResolvedValue({
      ok: true,
      data: { runId: RUN_ID, leaseTtlMs: 600000 },
    });
    mockServiceClient.retentionPurge.mockResolvedValue(purgedResponse('1'));
    const redis = makeRedis(null);

    await runRetentionTick(client, redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
  });

  it('breaker warning alone (otherwise quiet): report posted', async () => {
    mockServiceClient.retentionPreview.mockResolvedValue({
      ok: true,
      data: makePreview([], { breakerWarning: true }),
    });
    mockServiceClient.retentionRunBegin.mockResolvedValue({
      ok: true,
      data: { runId: RUN_ID, leaseTtlMs: 600000 },
    });
    const redis = makeRedis(null);

    await runRetentionTick(client, redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
  });

  it('a tick during cooldown with a stashed report replays it, without touching the preview', async () => {
    const stashedPayload = JSON.stringify({
      storedAt: '2026-07-19T00:00:00.000Z',
      embed: { title: '🗑️ Daily retention run', description: 'Purged 1' },
    });
    const redis = makeRedis('2026-07-20T00:00:00.000Z', stashedPayload);

    await runRetentionTick(client, redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(redis.del).toHaveBeenCalledWith(PENDING_REPORT_KEY);
    expect(mockServiceClient.retentionPreview).not.toHaveBeenCalled();
    expect(redis.setex).not.toHaveBeenCalled();
  });

  it('a delivered live report stashes nothing', async () => {
    mockServiceClient.retentionPreview.mockResolvedValue({
      ok: true,
      data: makePreview([makeUser('1')]),
    });
    mockServiceClient.retentionRunBegin.mockResolvedValue({
      ok: true,
      data: { runId: RUN_ID, leaseTtlMs: 600000 },
    });
    mockServiceClient.retentionPurge.mockResolvedValue(purgedResponse('1'));
    mockPostOwnerChannelEmbed.mockResolvedValue(true);
    const redis = makeRedis(null);

    await runRetentionTick(client, redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    const pendingReportCalls = redis.setex.mock.calls.filter(
      call => call[0] === PENDING_REPORT_KEY
    );
    expect(pendingReportCalls).toHaveLength(0);
  });

  it('an undelivered live report stashes it, and still arms the cooldown', async () => {
    mockServiceClient.retentionPreview.mockResolvedValue({
      ok: true,
      data: makePreview([makeUser('1')]),
    });
    mockServiceClient.retentionRunBegin.mockResolvedValue({
      ok: true,
      data: { runId: RUN_ID, leaseTtlMs: 600000 },
    });
    mockServiceClient.retentionPurge.mockResolvedValue(purgedResponse('1'));
    mockPostOwnerChannelEmbed.mockResolvedValue(false);
    const redis = makeRedis(null);

    await runRetentionTick(client, redis);

    expect(redis.setex).toHaveBeenCalledWith(
      PENDING_REPORT_KEY,
      7 * 24 * 60 * 60,
      expect.any(String)
    );
    expect(redis.setex).toHaveBeenCalledWith(
      'retention-run:cooldown',
      23 * 60 * 60,
      expect.any(String)
    );
  });

  it('a stashed report whose cooldown has expired is replayed first, then the fresh run proceeds and re-stashes on non-delivery', async () => {
    const stashedPayload = JSON.stringify({
      storedAt: '2026-07-19T00:00:00.000Z',
      embed: { title: '🗑️ Daily retention run', description: 'Purged 1' },
    });
    const redis = makeRedis(null, stashedPayload);
    mockServiceClient.retentionPreview.mockResolvedValue({
      ok: true,
      data: makePreview([makeUser('1')]),
    });
    mockServiceClient.retentionRunBegin.mockResolvedValue({
      ok: true,
      data: { runId: RUN_ID, leaseTtlMs: 600000 },
    });
    mockServiceClient.retentionPurge.mockResolvedValue(purgedResponse('1'));
    mockPostOwnerChannelEmbed.mockResolvedValue(false);

    await runRetentionTick(client, redis);

    // Two posts: the replay of the stashed report, then the fresh report —
    // both fail to deliver, so neither is the other in disguise.
    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(2);
    expect(redis.del).not.toHaveBeenCalled();
    expect(mockServiceClient.retentionPurge).toHaveBeenCalledTimes(1);
    const pendingReportCalls = redis.setex.mock.calls.filter(
      call => call[0] === PENDING_REPORT_KEY
    );
    expect(pendingReportCalls).toHaveLength(1);
    const cooldownCalls = redis.setex.mock.calls.filter(
      call => call[0] === 'retention-run:cooldown'
    );
    expect(cooldownCalls).toHaveLength(1);
  });
});

describe('runRetentionTick — never rejects', () => {
  it('resolves even when the service client throws', async () => {
    mockServiceClient.retentionPreview.mockRejectedValue(new Error('boom'));
    const redis = makeRedis(null);

    await expect(runRetentionTick(client, redis)).resolves.toBeUndefined();
  });

  it('nag mode: resolves and logs even when the preview call throws (the nag itself no longer swallows)', async () => {
    mockAutorunEnabled = false;
    mockServiceClient.retentionPreview.mockRejectedValue(new Error('network'));
    const redis = makeRedis(null);

    await expect(runRetentionTick(client, redis)).resolves.toBeUndefined();
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });
});
