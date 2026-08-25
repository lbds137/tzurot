/**
 * Tests for the export-smoke scheduler's check cycle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Client } from 'discord.js';
import type { Redis } from 'ioredis';

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

import { runExportSmokeCheck } from './ExportSmokeScheduler.js';

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
