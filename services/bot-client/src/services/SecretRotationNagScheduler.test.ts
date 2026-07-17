/**
 * Tests for the secret-rotation nag scheduler's check cycle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Client } from 'discord.js';
import type { Redis } from 'ioredis';

const mockSecretRotationStatus = vi.fn();
vi.mock('../utils/gatewayClients.js', () => ({
  getServiceClient: () => ({ secretRotationStatus: mockSecretRotationStatus }),
}));

const mockPostOwnerChannelEmbed = vi.fn();
vi.mock('../utils/ownerChannel.js', () => ({
  postOwnerChannelEmbed: (...args: unknown[]) => mockPostOwnerChannelEmbed(...args),
}));

import { runCheck } from './SecretRotationNagScheduler.js';

const OVERDUE_ENTRY = {
  name: 'byok-encryption-key',
  rotatedAt: '2025-12-01T00:00:00.000Z',
  intervalDays: 180,
  overdueDays: 20,
};

function makeRedis(cooldownValue: string | null): Redis {
  return {
    get: vi.fn().mockResolvedValue(cooldownValue),
    setex: vi.fn().mockResolvedValue('OK'),
  } as unknown as Redis;
}

const client = {} as Client;

describe('SecretRotationNagScheduler runCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPostOwnerChannelEmbed.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts the owner embed and arms the weekly cooldown when secrets are overdue', async () => {
    mockSecretRotationStatus.mockResolvedValue({
      ok: true,
      data: { entries: [OVERDUE_ENTRY], overdueCount: 1 },
    });
    const redis = makeRedis(null);

    await runCheck(client, redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    // Seam assertion: the cooldown key is what makes the nag at-most-weekly
    // across restarts — its TTL is the contract.
    expect(redis.setex).toHaveBeenCalledWith(
      'secret-rotation-nag:cooldown',
      7 * 24 * 60 * 60,
      expect.any(String)
    );
  });

  it('does NOT post while the cooldown key exists (at most one nag per week)', async () => {
    mockSecretRotationStatus.mockResolvedValue({
      ok: true,
      data: { entries: [OVERDUE_ENTRY], overdueCount: 1 },
    });
    const redis = makeRedis('2026-07-15T00:00:00.000Z');

    await runCheck(client, redis);

    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
    expect(redis.setex).not.toHaveBeenCalled();
  });

  it('does nothing when no secret is overdue (quiet week costs no Redis read)', async () => {
    mockSecretRotationStatus.mockResolvedValue({
      ok: true,
      data: {
        entries: [{ ...OVERDUE_ENTRY, overdueDays: 0 }],
        overdueCount: 0,
      },
    });
    const redis = makeRedis(null);

    await runCheck(client, redis);

    expect(redis.get).not.toHaveBeenCalled();
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('swallows a failed status fetch (next daily tick retries)', async () => {
    mockSecretRotationStatus.mockResolvedValue({ ok: false, error: 'gateway down' });
    const redis = makeRedis(null);

    await expect(runCheck(client, redis)).resolves.toBeUndefined();
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('swallows a thrown error entirely (nag must never affect anything else)', async () => {
    mockSecretRotationStatus.mockRejectedValue(new Error('network'));
    const redis = makeRedis(null);

    await expect(runCheck(client, redis)).resolves.toBeUndefined();
  });
});
