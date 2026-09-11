/**
 * Tests for the undelivered-live-run-report stash: write shape, replay,
 * delivery/non-delivery handling, and corrupt-payload discard.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmbedBuilder, type Client } from 'discord.js';
import type { Redis } from 'ioredis';
import type { LiveRunOutcome } from './types.js';

const mockPostOwnerChannelEmbed = vi.fn();
vi.mock('../../utils/ownerChannel.js', () => ({
  postOwnerChannelEmbed: (...args: unknown[]) => mockPostOwnerChannelEmbed(...args),
}));

import {
  stashUndeliveredReport,
  replayPendingReport,
  PENDING_REPORT_KEY,
  PENDING_REPORT_TTL_SECONDS,
} from './retentionPendingReport.js';

const client = {} as Client;

function makeRedis(getValue: string | null = null): Redis & {
  get: ReturnType<typeof vi.fn>;
  setex: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
} {
  return {
    get: vi.fn().mockResolvedValue(getValue),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  } as unknown as Redis & {
    get: ReturnType<typeof vi.fn>;
    setex: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
  };
}

function makeOutcome(): LiveRunOutcome {
  return {
    runId: 'run-1',
    runContext: 'job:retention-daily',
    preview: {
      users: [],
      totals: {
        eligibleCount: 0,
        userbaseCount: 300,
        percentOfUserbase: 0,
        charactersToDelete: 0,
        charactersToReHome: 0,
        breakerWarning: false,
        reachableToNotify: 0,
        inGrace: 0,
        graceExpired: 0,
        bystander: 0,
        reminderDue: 0,
        scope: { kind: 'unrestricted', excludedEligibleCount: 0 },
      },
    },
    notify: {
      kind: 'ok',
      status: 'empty',
      cohortSize: 0,
      batchesEnqueued: 0,
      breakerWarning: false,
      reminderCohortSize: 0,
      reminderBatchesEnqueued: 0,
    },
    purge: {
      attempted: 0,
      purged: [],
      charactersDeleted: 0,
      charactersReHomed: 0,
      skippedByReason: {},
      failed: 0,
      failureKinds: {},
      halt: null,
    },
    reconcile: { kind: 'ok', settled: 0, stillFailing: 0, remaining: 0, iterations: 0 },
  };
}

function makeEmbed(title = 'Test Title', description = 'Test Description'): EmbedBuilder {
  return new EmbedBuilder().setTitle(title).setDescription(description);
}

describe('stashUndeliveredReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes setex with the pending key, the 7-day TTL, and a payload that round-trips the embed', async () => {
    const redis = makeRedis();
    const embed = makeEmbed('Daily retention run', 'Purged 3');

    await stashUndeliveredReport(redis, embed, makeOutcome());

    expect(redis.setex).toHaveBeenCalledTimes(1);
    const [key, ttl, payload] = redis.setex.mock.calls[0] as [string, number, string];
    expect(key).toBe(PENDING_REPORT_KEY);
    expect(ttl).toBe(PENDING_REPORT_TTL_SECONDS);
    expect(ttl).toBe(7 * 24 * 60 * 60);

    const parsed = JSON.parse(payload) as {
      storedAt: string;
      embed: { title?: string; description?: string };
    };
    expect(typeof parsed.storedAt).toBe('string');
    expect(new Date(parsed.storedAt).toISOString()).toBe(parsed.storedAt);
    expect(parsed.embed.title).toBe('Daily retention run');
    expect(parsed.embed.description).toBe('Purged 3');
  });
});

describe('replayPendingReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('with no stashed key: returns false, posts nothing, deletes nothing', async () => {
    const redis = makeRedis(null);

    const result = await replayPendingReport(client, redis);

    expect(result).toBe(false);
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('posts and deletes the key on successful delivery', async () => {
    const embed = makeEmbed('Stashed report', 'Body');
    const payload = JSON.stringify({ storedAt: '2026-09-01T00:00:00.000Z', embed: embed.toJSON() });
    const redis = makeRedis(payload);
    mockPostOwnerChannelEmbed.mockResolvedValue(true);

    const result = await replayPendingReport(client, redis);

    expect(result).toBe(true);
    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    const postedEmbed = mockPostOwnerChannelEmbed.mock.calls[0]?.[1] as EmbedBuilder;
    expect(postedEmbed.toJSON().title).toBe('Stashed report');
    expect(redis.del).toHaveBeenCalledWith(PENDING_REPORT_KEY);
  });

  it('keeps the key on non-delivery', async () => {
    const embed = makeEmbed('Stashed report', 'Body');
    const payload = JSON.stringify({ storedAt: '2026-09-01T00:00:00.000Z', embed: embed.toJSON() });
    const redis = makeRedis(payload);
    mockPostOwnerChannelEmbed.mockResolvedValue(false);

    const result = await replayPendingReport(client, redis);

    expect(result).toBe(false);
    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('discards a corrupt (non-JSON) payload without posting', async () => {
    const redis = makeRedis('not json{');

    const result = await replayPendingReport(client, redis);

    expect(result).toBe(false);
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith(PENDING_REPORT_KEY);
  });

  it('discards a structurally-invalid payload without posting', async () => {
    const redis = makeRedis('{"storedAt":123}');

    const result = await replayPendingReport(client, redis);

    expect(result).toBe(false);
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith(PENDING_REPORT_KEY);
  });
});
