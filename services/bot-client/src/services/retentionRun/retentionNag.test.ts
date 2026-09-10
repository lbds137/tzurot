/**
 * Tests for the retention job's report-only nag mode: check cycle and embed
 * content. Row-level formatting (identity tokens, escaping, empty username,
 * cap + overflow) is covered in retentionRows.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Client } from 'discord.js';
import type { Redis } from 'ioredis';
import type { RetentionPreviewResponse } from '@tzurot/common-types/schemas/api/internal';

const mockRetentionPreview = vi.fn();
vi.mock('../../utils/gatewayClients.js', () => ({
  getServiceClient: () => ({ retentionPreview: mockRetentionPreview }),
}));

const mockPostOwnerChannelEmbed = vi.fn();
vi.mock('../../utils/ownerChannel.js', () => ({
  postOwnerChannelEmbed: (...args: unknown[]) => mockPostOwnerChannelEmbed(...args),
}));

import { runRetentionNagCheck, buildRetentionNagEmbed } from './retentionNag.js';

function makePreview(overrides: {
  eligibleCount?: number;
  breakerWarning?: boolean;
  userCount?: number;
  reachableToNotify?: number;
  inGrace?: number;
  graceExpired?: number;
  bystander?: number;
}): RetentionPreviewResponse {
  const eligibleCount = overrides.eligibleCount ?? 1;
  const listedUsers = overrides.userCount ?? eligibleCount;
  return {
    users: Array.from({ length: listedUsers }, (_, i) => ({
      discordId: `99000000000000${String(i).padStart(4, '0')}`,
      username: `inactive${String(i)}`,
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
      reachableToNotify: overrides.reachableToNotify ?? 0,
      inGrace: overrides.inGrace ?? 0,
      graceExpired: overrides.graceExpired ?? 0,
      bystander: overrides.bystander ?? 0,
      // The nag only ever runs in production, where the scope is unrestricted
      // as long as production's OUTBOUND_DM_ALLOWLIST stays unset — see
      // retentionNag.ts's render (no scope line).
      scope: { kind: 'unrestricted', excludedEligibleCount: 0 },
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

describe('retentionNag runRetentionNagCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPostOwnerChannelEmbed.mockResolvedValue(true);
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

  it('does NOT arm the cooldown when the embed post reports non-delivery — the next tick retries', async () => {
    mockRetentionPreview.mockResolvedValue({ ok: true, data: makePreview({ eligibleCount: 2 }) });
    mockPostOwnerChannelEmbed.mockResolvedValue(false);
    const redis = makeRedis(null);

    await runRetentionNagCheck(client, redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(redis.setex).not.toHaveBeenCalled();
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

  it('posts when reachable users await a warning even with zero purge-eligible', async () => {
    // The notify CLI is the operator's action for this state — a gate on
    // eligibleCount alone would hide the reachable branch until someone
    // separately became unreachable.
    const redis = makeRedis(null);
    mockRetentionPreview.mockResolvedValue({
      ok: true,
      data: makePreview({ eligibleCount: 0, userCount: 0, reachableToNotify: 51 }),
    });

    await runRetentionNagCheck(client, redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
  });

  it('swallows a failed preview fetch (next daily tick retries)', async () => {
    mockRetentionPreview.mockResolvedValue({ ok: false, error: 'gateway down' });
    const redis = makeRedis(null);

    await expect(runRetentionNagCheck(client, redis)).resolves.toBeUndefined();
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('propagates a thrown error rather than swallowing it — the scheduler tick wrapper is what swallows', async () => {
    mockRetentionPreview.mockRejectedValue(new Error('network'));
    const redis = makeRedis(null);

    await expect(runRetentionNagCheck(client, redis)).rejects.toThrow('network');
  });
});

describe('buildRetentionNagEmbed', () => {
  it('carries the counts, the reason labels, and the exact prod CLI commands', () => {
    const embed = buildRetentionNagEmbed(makePreview({ eligibleCount: 2 })).toJSON();

    expect(embed.description).toContain('**2** of 300 users');
    expect(embed.description).toContain('unreachable)');
    expect(embed.description).toContain('account deleted)');
    // The nag is production-only, so the footer always names the prod env.
    expect(embed.footer?.text).toContain('pnpm ops retention:preview --env prod');
    expect(embed.footer?.text).toContain('pnpm ops retention:purge --env prod');
  });

  it('renders the bystander reason label (silent-purge rows need a legible tag)', () => {
    const preview = makePreview({ eligibleCount: 1 });
    preview.users[0] = { ...preview.users[0], reason: 'bystander' };

    const embed = buildRetentionNagEmbed(preview).toJSON();

    expect(embed.description).toContain('never used directly');
  });

  it('appends the bystander tally to the summary only when the count is non-zero', () => {
    const silent = buildRetentionNagEmbed(makePreview({})).toJSON();
    const split = buildRetentionNagEmbed(
      makePreview({ eligibleCount: 33, bystander: 32 })
    ).toJSON();

    expect(silent.description).not.toContain('no notice owed');
    expect(split.description).toContain('(32 never used the bot directly — no notice owed)');
  });

  it('includes the breaker warning line only when the totals flag it', () => {
    const calm = buildRetentionNagEmbed(makePreview({})).toJSON();
    const warned = buildRetentionNagEmbed(makePreview({ breakerWarning: true })).toJSON();

    expect(calm.description).not.toContain('breaker warning');
    expect(warned.description).toContain('breaker warning');
  });

  it('shows the reachable-branch pipeline line only when that pipeline has anyone in it', () => {
    const quiet = buildRetentionNagEmbed(makePreview({})).toJSON();
    const active = buildRetentionNagEmbed(
      makePreview({ reachableToNotify: 51, inGrace: 4, graceExpired: 1 })
    ).toJSON();

    expect(quiet.description).not.toContain('Reachable branch');
    expect(active.description).toContain('**51** awaiting a warning DM');
    expect(active.description).toContain('**4** in grace');
    expect(active.description).toContain('**1** grace-expired');
  });

  it('still shows the pipeline line in the graceExpired-only steady state', () => {
    // Grace-expired users have LEFT the other two counts (window passed,
    // already warned), so everyone-warned-and-expired is a real steady state —
    // a guard that checks only the two upstream counts silently drops the
    // aggregate line exactly when the operator needs it.
    const expiredOnly = buildRetentionNagEmbed(makePreview({ graceExpired: 2 })).toJSON();

    expect(expiredOnly.description).toContain('Reachable branch');
    expect(expiredOnly.description).toContain('**2** grace-expired');
  });

  it('renders a formatted row for a purge-eligible user', () => {
    const embed = buildRetentionNagEmbed(makePreview({ eligibleCount: 1 })).toJSON();

    expect(embed.description).toContain('<@990000000000000000>');
    expect(embed.description).toContain('`990000000000000000`');
    expect(embed.description).toContain('inactive since');
  });
});
