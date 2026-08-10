/**
 * Tests for the release-flag nag scheduler's check cycle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Client } from 'discord.js';
import type { Redis } from 'ioredis';

const configMock = vi.hoisted(() => ({
  value: { GITHUB_API_TOKEN: undefined as string | undefined },
}));
vi.mock('@tzurot/common-types/config/config', () => ({
  getConfig: () => configMock.value,
}));

const mockPostOwnerChannelEmbed = vi.fn();
vi.mock('../utils/ownerChannel.js', () => ({
  postOwnerChannelEmbed: (...args: unknown[]) => mockPostOwnerChannelEmbed(...args),
}));

import { runReleaseFlagNagCheck } from './ReleaseFlagNagScheduler.js';

function makeRelease(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    tag_name: 'v3.0.0-beta.197',
    name: null,
    body: null,
    draft: false,
    prerelease: false,
    html_url: 'https://github.com/lbds137/tzurot/releases/tag/v3.0.0-beta.197',
    published_at: '2026-08-08T00:00:00Z',
    ...overrides,
  };
}

function makeFetchImpl(response: { ok: boolean; status?: number; json?: unknown }) {
  return vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? 200,
    json: () => Promise.resolve(response.json),
  }) as unknown as typeof fetch;
}

function makeRedis(cooldownValue: string | null): Redis {
  return {
    get: vi.fn().mockResolvedValue(cooldownValue),
    setex: vi.fn().mockResolvedValue('OK'),
  } as unknown as Redis;
}

const client = {} as Client;

describe('ReleaseFlagNagScheduler runReleaseFlagNagCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMock.value = { GITHUB_API_TOKEN: undefined };
    mockPostOwnerChannelEmbed.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('posts the owner embed and arms the weekly cooldown when the newest release is prerelease-flagged', async () => {
    // The prerelease release is NOT the array's first element — an
    // array-order-picking implementation would miss it.
    const older = makeRelease({
      id: 1,
      tag_name: 'v-older',
      published_at: '2026-08-01T00:00:00Z',
    });
    const newerPrerelease = makeRelease({
      id: 2,
      tag_name: 'v-newer',
      published_at: '2026-08-08T00:00:00Z',
      prerelease: true,
    });
    vi.stubGlobal('fetch', makeFetchImpl({ ok: true, json: [older, newerPrerelease] }));
    const redis = makeRedis(null);

    await runReleaseFlagNagCheck(client, redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    // Seam assertion: the embed content names the flagged tag.
    const embed = mockPostOwnerChannelEmbed.mock.calls[0][1] as {
      data: { description?: string };
    };
    expect(embed.data.description).toContain('v-newer');
    // The cooldown value is the nagged TAG (not a timestamp) — that is what
    // scopes the suppression to this release.
    expect(redis.setex).toHaveBeenCalledWith(
      'release-flag-nag:cooldown',
      7 * 24 * 60 * 60,
      'v-newer'
    );
  });

  it('does NOT post when the newest release is healthy (non-prerelease)', async () => {
    const healthy = makeRelease({ tag_name: 'v-healthy', prerelease: false });
    vi.stubGlobal('fetch', makeFetchImpl({ ok: true, json: [healthy] }));
    const redis = makeRedis(null);

    await runReleaseFlagNagCheck(client, redis);

    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
    expect(redis.setex).not.toHaveBeenCalled();
  });

  it('does NOT post while the cooldown holds the SAME tag (at most one nag per week per release)', async () => {
    const prerelease = makeRelease({ tag_name: 'v-flagged', prerelease: true });
    vi.stubGlobal('fetch', makeFetchImpl({ ok: true, json: [prerelease] }));
    const redis = makeRedis('v-flagged');

    await runReleaseFlagNagCheck(client, redis);

    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
    expect(redis.setex).not.toHaveBeenCalled();
  });

  it('DOES post when the cooldown holds a DIFFERENT tag — a new flagged release is a new incident', async () => {
    const prerelease = makeRelease({ tag_name: 'v-second-incident', prerelease: true });
    vi.stubGlobal('fetch', makeFetchImpl({ ok: true, json: [prerelease] }));
    const redis = makeRedis('v-first-incident');

    await runReleaseFlagNagCheck(client, redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(redis.setex).toHaveBeenCalledWith(
      'release-flag-nag:cooldown',
      7 * 24 * 60 * 60,
      'v-second-incident'
    );
  });

  it('does NOT arm the cooldown when the embed post reports non-delivery — the next tick retries', async () => {
    const prerelease = makeRelease({ prerelease: true });
    vi.stubGlobal('fetch', makeFetchImpl({ ok: true, json: [prerelease] }));
    mockPostOwnerChannelEmbed.mockResolvedValue(false);
    const redis = makeRedis(null);

    await runReleaseFlagNagCheck(client, redis);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    expect(redis.setex).not.toHaveBeenCalled();
  });

  it('swallows a fetch rejection entirely (no throw, no embed)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch
    );
    const redis = makeRedis(null);

    await expect(runReleaseFlagNagCheck(client, redis)).resolves.toBeUndefined();
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('swallows a non-2xx response (no throw, no embed)', async () => {
    vi.stubGlobal('fetch', makeFetchImpl({ ok: false, status: 500 }));
    const redis = makeRedis(null);

    await expect(runReleaseFlagNagCheck(client, redis)).resolves.toBeUndefined();
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('swallows a schema-invalid payload (no throw, no embed)', async () => {
    vi.stubGlobal('fetch', makeFetchImpl({ ok: true, json: [{ nope: true }] }));
    const redis = makeRedis(null);

    await expect(runReleaseFlagNagCheck(client, redis)).resolves.toBeUndefined();
    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });
});
