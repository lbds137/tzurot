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

const mockDbSync = vi.fn();
vi.mock('../utils/gatewayClients.js', () => ({
  getOwnerClient: () => ({ dbSync: mockDbSync }),
}));

// vi.hoisted: the module under test calls createIntervalScheduler at import
// time, so plain consts would not be initialized when the factory runs.
const { mockSchedulerStart, mockSchedulerStop } = vi.hoisted(() => ({
  mockSchedulerStart: vi.fn(),
  mockSchedulerStop: vi.fn(),
}));
vi.mock('../utils/intervalScheduler.js', () => ({
  createIntervalScheduler: () => ({ start: mockSchedulerStart, stop: mockSchedulerStop }),
}));

// Mutable so the boot-guard tests can vary the configured owner id per case.
let mockOwnerId: string | undefined = '123456789012345678';
vi.mock('@tzurot/common-types/config/config', () => ({
  getConfig: () => ({ BOT_OWNER_ID: mockOwnerId }),
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

const client = {} as Client;

describe('startNightlyDbSyncScheduler boot guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOwnerId = '123456789012345678';
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

  it('stop delegates to the interval scheduler', () => {
    stopNightlyDbSyncScheduler();

    expect(mockSchedulerStop).toHaveBeenCalledTimes(1);
  });
});

describe('NightlyDbSyncScheduler runNightlyDbSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockPostOwnerChannelEmbed.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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
