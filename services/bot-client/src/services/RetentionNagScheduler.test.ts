/**
 * Tests for the retention nag scheduler's check cycle and embed content.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Client } from 'discord.js';
import type { Redis } from 'ioredis';
import type { RetentionPreviewResponse } from '@tzurot/common-types/schemas/api/internal';

const mockRetentionPreview = vi.fn();
vi.mock('../utils/gatewayClients.js', () => ({
  getServiceClient: () => ({ retentionPreview: mockRetentionPreview }),
}));

const mockPostOwnerChannelEmbed = vi.fn();
vi.mock('../utils/ownerChannel.js', () => ({
  postOwnerChannelEmbed: (...args: unknown[]) => mockPostOwnerChannelEmbed(...args),
}));

vi.mock('@tzurot/common-types/config/config', () => ({
  getConfig: () => ({ NODE_ENV: 'production' }),
}));

import { runRetentionNagCheck, buildRetentionNagEmbed } from './RetentionNagScheduler.js';

function makePreview(overrides: {
  eligibleCount?: number;
  breakerWarning?: boolean;
  userCount?: number;
}): RetentionPreviewResponse {
  const eligibleCount = overrides.eligibleCount ?? 1;
  const listedUsers = overrides.userCount ?? eligibleCount;
  return {
    users: Array.from({ length: listedUsers }, (_, i) => ({
      discordId: `99000000000000${String(i).padStart(4, '0')}`,
      inactiveSince: '2025-09-01T00:00:00.000Z',
      reason: i === 0 ? ('unreachable' as const) : ('account_gone' as const),
      ownedCharacters: { toDelete: 1, toReHome: 0 },
    })),
    totals: {
      eligibleCount,
      userbaseCount: 300,
      percentOfUserbase: Math.round((eligibleCount / 300) * 1000) / 10,
      charactersToDelete: listedUsers,
      charactersToReHome: 0,
      breakerWarning: overrides.breakerWarning ?? false,
    },
  } satisfies RetentionPreviewResponse;
}

function makeRedis(cooldownValue: string | null): Redis {
  return {
    get: vi.fn().mockResolvedValue(cooldownValue),
    setex: vi.fn().mockResolvedValue('OK'),
  } as unknown as Redis;
}

const client = {} as Client;

describe('RetentionNagScheduler runRetentionNagCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPostOwnerChannelEmbed.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts the owner embed and arms the weekly cooldown when accounts are eligible', async () => {
    mockRetentionPreview.mockResolvedValue({ ok: true, data: makePreview({ eligibleCount: 2 }) });
    const redis = makeRedis(null);

    await runRetentionNagCheck(client, redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    // Seam assertion: the cooldown key is what makes the nag at-most-weekly
    // across restarts — its TTL is the contract.
    expect(redis.setex).toHaveBeenCalledWith(
      'retention-nag:cooldown',
      7 * 24 * 60 * 60,
      expect.any(String)
    );
  });

  it('does NOT post while the cooldown key exists (at most one nag per week)', async () => {
    mockRetentionPreview.mockResolvedValue({ ok: true, data: makePreview({}) });
    const redis = makeRedis('2026-07-20T00:00:00.000Z');

    await runRetentionNagCheck(client, redis);

    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
    expect(redis.setex).not.toHaveBeenCalled();
  });

  it('stays silent when nobody is eligible (quiet week costs no Redis read)', async () => {
    mockRetentionPreview.mockResolvedValue({
      ok: true,
      data: makePreview({ eligibleCount: 0, userCount: 0 }),
    });
    const redis = makeRedis(null);

    await runRetentionNagCheck(client, redis);

    expect(redis.get).not.toHaveBeenCalled();
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('swallows a failed preview fetch (next daily tick retries)', async () => {
    mockRetentionPreview.mockResolvedValue({ ok: false, error: 'gateway down' });
    const redis = makeRedis(null);

    await expect(runRetentionNagCheck(client, redis)).resolves.toBeUndefined();
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('swallows a thrown error entirely (nag must never affect anything else)', async () => {
    mockRetentionPreview.mockRejectedValue(new Error('network'));
    const redis = makeRedis(null);

    await expect(runRetentionNagCheck(client, redis)).resolves.toBeUndefined();
  });
});

describe('buildRetentionNagEmbed', () => {
  it('carries the counts, the reason labels, and the exact CLI commands with this env', () => {
    const embed = buildRetentionNagEmbed(makePreview({ eligibleCount: 2 })).toJSON();

    expect(embed.description).toContain('**2** of 300 users');
    expect(embed.description).toContain('unreachable)');
    expect(embed.description).toContain('account deleted)');
    // The footer is the operator's handoff — both commands, env included
    // (mocked config says production).
    expect(embed.footer?.text).toContain('pnpm ops retention:preview --env prod');
    expect(embed.footer?.text).toContain('pnpm ops retention:purge --env prod');
  });

  it('includes the breaker warning line only when the totals flag it', () => {
    const calm = buildRetentionNagEmbed(makePreview({})).toJSON();
    const warned = buildRetentionNagEmbed(makePreview({ breakerWarning: true })).toJSON();

    expect(calm.description).not.toContain('breaker warning');
    expect(warned.description).toContain('breaker warning');
  });

  it('caps the listed users and reports the overflow', () => {
    const embed = buildRetentionNagEmbed(
      makePreview({ eligibleCount: 14, userCount: 14 })
    ).toJSON();

    // 10 listed + the overflow line, never the full cohort.
    expect(embed.description?.match(/inactive since/g)).toHaveLength(10);
    expect(embed.description).toContain('and 4 more');
  });
});
