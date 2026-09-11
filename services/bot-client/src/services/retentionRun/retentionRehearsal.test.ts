/**
 * Tests for the retention job's rehearsal mode.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Client, EmbedBuilder } from 'discord.js';
import type { Redis } from 'ioredis';

const mockClient = {
  retentionPreview: vi.fn(),
  retentionNotify: vi.fn(),
  retentionRunBegin: vi.fn(),
  retentionRunEnd: vi.fn(),
  retentionPurge: vi.fn(),
  retentionReconcileOffDb: vi.fn(),
};
vi.mock('../../utils/gatewayClients.js', () => ({
  getServiceClient: () => mockClient,
}));

const mockPostOwnerChannelEmbed = vi.fn();
vi.mock('../../utils/ownerChannel.js', () => ({
  postOwnerChannelEmbed: (...args: unknown[]) => mockPostOwnerChannelEmbed(...args),
}));

import { runRetentionRehearsal, REHEARSAL_RUN_CONTEXT } from './retentionRehearsal.js';

function makePreview(eligibleCount: number) {
  return {
    users: [],
    totals: {
      eligibleCount,
      userbaseCount: 300,
      percentOfUserbase: 1,
      charactersToDelete: eligibleCount,
      charactersToReHome: 0,
      breakerWarning: false,
      reachableToNotify: 0,
      inGrace: 0,
      graceExpired: 0,
      bystander: 0,
      reminderDue: 0,
      scope: { kind: 'unrestricted' as const, excludedEligibleCount: 0 },
    },
  };
}

function makeRedis(cooldownValue: string | null): Redis {
  return {
    get: vi.fn().mockResolvedValue(cooldownValue),
    setex: vi.fn().mockResolvedValue('OK'),
  } as unknown as Redis;
}

const client = {} as Client;

function neverTouched(): void {
  expect(mockClient.retentionRunBegin).not.toHaveBeenCalled();
  expect(mockClient.retentionRunEnd).not.toHaveBeenCalled();
  expect(mockClient.retentionPurge).not.toHaveBeenCalled();
  expect(mockClient.retentionReconcileOffDb).not.toHaveBeenCalled();
}

describe('runRetentionRehearsal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.retentionNotify.mockResolvedValue({
      ok: true,
      data: {
        status: 'empty',
        cohortSize: 0,
        userbaseCount: 300,
        percentOfUserbase: 0,
        breakerWarning: false,
        batchesEnqueued: 0,
        recipients: [],
        reminderCohortSize: 0,
        reminderBatchesEnqueued: 0,
        reminderRecipients: [],
      },
    });
    mockPostOwnerChannelEmbed.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing but the cooldown read while cooling', async () => {
    mockClient.retentionPreview.mockResolvedValue({ ok: true, data: makePreview(0) });
    const redis = makeRedis('2026-07-20T00:00:00.000Z');

    await runRetentionRehearsal(client, redis);

    expect(mockClient.retentionPreview).not.toHaveBeenCalled();
    expect(mockClient.retentionNotify).not.toHaveBeenCalled();
    expect(redis.setex).not.toHaveBeenCalled();
    neverTouched();
  });

  it('calls notify with exactly dryRun: true and the rehearsal run context', async () => {
    mockClient.retentionPreview.mockResolvedValue({ ok: true, data: makePreview(1) });
    const redis = makeRedis(null);

    await runRetentionRehearsal(client, redis);

    expect(mockClient.retentionNotify).toHaveBeenCalledWith({
      dryRun: true,
      runContext: REHEARSAL_RUN_CONTEXT,
    });
    neverTouched();
  });

  it('does not arm the cooldown and returns when the preview fetch fails', async () => {
    mockClient.retentionPreview.mockResolvedValue({ ok: false, kind: 'network', error: 'down' });
    const redis = makeRedis(null);

    await runRetentionRehearsal(client, redis);

    expect(mockClient.retentionNotify).not.toHaveBeenCalled();
    expect(redis.setex).not.toHaveBeenCalled();
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('arms the cooldown and does not post for a quiet rehearsal', async () => {
    mockClient.retentionPreview.mockResolvedValue({ ok: true, data: makePreview(0) });
    const redis = makeRedis(null);

    await runRetentionRehearsal(client, redis);

    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
    expect(redis.setex).toHaveBeenCalledWith(
      'retention-rehearsal:cooldown',
      7 * 24 * 60 * 60,
      expect.any(String)
    );
  });

  it('posts on a reminders-only rehearsal (reminderCohortSize > 0, no warning cohort)', async () => {
    mockClient.retentionPreview.mockResolvedValue({ ok: true, data: makePreview(0) });
    mockClient.retentionNotify.mockResolvedValue({
      ok: true,
      data: {
        status: 'dry_run',
        cohortSize: 0,
        userbaseCount: 300,
        percentOfUserbase: 0,
        breakerWarning: false,
        batchesEnqueued: 0,
        recipients: [],
        reminderCohortSize: 4,
        reminderBatchesEnqueued: 0,
        reminderRecipients: [],
      },
    });
    const redis = makeRedis(null);

    await runRetentionRehearsal(client, redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    const embed = mockPostOwnerChannelEmbed.mock.calls[0]?.[1] as EmbedBuilder;
    expect(embed.toJSON().description).toContain('**Would remind:** 4 users');
  });

  it('posts and arms the cooldown when the rehearsal is worth reporting and delivered', async () => {
    mockClient.retentionPreview.mockResolvedValue({ ok: true, data: makePreview(2) });
    const redis = makeRedis(null);

    await runRetentionRehearsal(client, redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(redis.setex).toHaveBeenCalledTimes(1);
  });

  it('does NOT arm the cooldown when delivery fails — the next tick retries', async () => {
    mockClient.retentionPreview.mockResolvedValue({ ok: true, data: makePreview(2) });
    mockPostOwnerChannelEmbed.mockResolvedValue(false);
    const redis = makeRedis(null);

    await runRetentionRehearsal(client, redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(redis.setex).not.toHaveBeenCalled();
  });

  it('renders REHEARSAL_RUN_CONTEXT in the posted embed footer', async () => {
    mockClient.retentionPreview.mockResolvedValue({ ok: true, data: makePreview(2) });
    const redis = makeRedis(null);

    await runRetentionRehearsal(client, redis);

    const embed = mockPostOwnerChannelEmbed.mock.calls[0]?.[1] as EmbedBuilder;
    expect(embed.toJSON().footer?.text).toBe(`Rehearsal: ${REHEARSAL_RUN_CONTEXT}`);
  });

  it('records a thrown notify call as a failure and still reports (never calls purge/lease routes)', async () => {
    mockClient.retentionPreview.mockResolvedValue({ ok: true, data: makePreview(0) });
    mockClient.retentionNotify.mockRejectedValue(new Error('network down'));
    const redis = makeRedis(null);

    await runRetentionRehearsal(client, redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    neverTouched();
  });
});
