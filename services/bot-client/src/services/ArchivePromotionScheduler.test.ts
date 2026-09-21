/**
 * Tests for the memory-archive auto-promotion check scheduler's run cycle.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Client } from 'discord.js';
import type { MemoryArchivePromotion } from '@tzurot/common-types/schemas/api/memoryArchive';

const mockMemoryArchivePromote = vi.fn();
vi.mock('../utils/gatewayClients.js', () => ({
  getOwnerClient: () => ({ memoryArchivePromote: mockMemoryArchivePromote }),
}));

// vi.hoisted: the module under test calls createIntervalScheduler at import
// time, so plain consts would not be initialized when the factory runs.
const { mockSchedulerStart, mockSchedulerStop } = vi.hoisted(() => ({
  mockSchedulerStart: vi.fn(),
  mockSchedulerStop: vi.fn(),
}));
vi.mock('@tzurot/common-types/utils/intervalScheduler', () => ({
  createIntervalScheduler: () => ({ start: mockSchedulerStart, stop: mockSchedulerStop }),
}));

const mockPostOwnerChannelEmbed = vi.fn().mockResolvedValue(true);
vi.mock('../utils/ownerChannel.js', () => ({
  postOwnerChannelEmbed: (...args: unknown[]) => mockPostOwnerChannelEmbed(...args),
}));

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return { ...actual, createLogger: () => mockLogger };
});

import {
  runArchivePromotionCheck,
  startArchivePromotionScheduler,
  stopArchivePromotionScheduler,
} from './ArchivePromotionScheduler.js';

const FAKE_CLIENT = {} as Client;

function promotion(overrides: Partial<MemoryArchivePromotion> = {}): MemoryArchivePromotion {
  return {
    personalityId: '550e8400-e29b-41d4-a716-446655440001',
    slug: 'my-persona',
    coverage: 0.97,
    writes: { archiveSplitRender: true, recentDaysDigest: true, renderMode: true },
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('runArchivePromotionCheck', () => {
  it('posts nothing when no promotions happened', async () => {
    mockMemoryArchivePromote.mockResolvedValue({
      ok: true,
      data: {
        enabled: true,
        evaluated: 5,
        promoted: [],
        skipped: { notReady: 5, optedOut: 0, alreadyListed: 0, conflicted: 0 },
      },
    });

    await runArchivePromotionCheck(FAKE_CLIENT);

    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('posts one embed carrying the slug and coverage percentage when something was promoted', async () => {
    mockMemoryArchivePromote.mockResolvedValue({
      ok: true,
      data: {
        enabled: true,
        evaluated: 5,
        promoted: [promotion()],
        skipped: { notReady: 4, optedOut: 0, alreadyListed: 0, conflicted: 0 },
      },
    });

    await runArchivePromotionCheck(FAKE_CLIENT);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    const [, embed] = mockPostOwnerChannelEmbed.mock.calls[0] as [
      Client,
      { toJSON: () => unknown },
    ];
    const json = JSON.stringify(embed.toJSON());
    expect(json).toContain('my-persona');
    expect(json).toContain('97.0%');
  });

  it('caps the embed at MAX_PROMOTION_FIELDS (25) and names the remainder', async () => {
    const promoted = Array.from({ length: 30 }, (_, i) =>
      promotion({ slug: `persona-${String(i)}` })
    );
    mockMemoryArchivePromote.mockResolvedValue({
      ok: true,
      data: {
        enabled: true,
        evaluated: 30,
        promoted,
        skipped: { notReady: 0, optedOut: 0, alreadyListed: 0, conflicted: 0 },
      },
    });

    await runArchivePromotionCheck(FAKE_CLIENT);

    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    const [, embed] = mockPostOwnerChannelEmbed.mock.calls[0] as [
      Client,
      { toJSON: () => { fields?: unknown[]; description?: string | null } },
    ];
    const data = embed.toJSON();
    expect(data.fields).toHaveLength(25);
    expect(data.description).toContain('5 more');
  });

  it('does nothing when promotion is disabled', async () => {
    mockMemoryArchivePromote.mockResolvedValue({
      ok: true,
      data: {
        enabled: false,
        evaluated: 0,
        promoted: [],
        skipped: { notReady: 0, optedOut: 0, alreadyListed: 0, conflicted: 0 },
      },
    });

    await runArchivePromotionCheck(FAKE_CLIENT);

    expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
  });

  it('posts a failure embed and logs a warning when the gateway call fails', async () => {
    mockMemoryArchivePromote.mockResolvedValue({
      ok: false,
      error: 'gateway unreachable',
      status: 502,
    });

    await runArchivePromotionCheck(FAKE_CLIENT);

    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
  });

  it('a thrown client error is caught: one warn, one failure embed, no rethrow', async () => {
    mockMemoryArchivePromote.mockRejectedValue(new Error('network exploded'));

    await expect(runArchivePromotionCheck(FAKE_CLIENT)).resolves.toBeUndefined();

    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
  });
});

describe('startArchivePromotionScheduler / stopArchivePromotionScheduler', () => {
  it('starts and stops the underlying interval scheduler', () => {
    startArchivePromotionScheduler(FAKE_CLIENT);
    expect(mockSchedulerStart).toHaveBeenCalledWith(FAKE_CLIENT);

    stopArchivePromotionScheduler();
    expect(mockSchedulerStop).toHaveBeenCalled();
  });
});
