/**
 * ConfigCascadeResolver Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigCascadeResolver } from './ConfigCascadeResolver.js';
import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import { HARDCODED_CONFIG_DEFAULTS } from '@tzurot/common-types/schemas/api/configOverrides';

// Shared logger instance so tests can assert on (absence of) warnings — the
// resolver's module-level logger is created once at import time, so the mock
// must hand back a capturable singleton rather than a fresh object per call.
const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@tzurot/common-types/utils/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/utils/logger')>();
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

function createMockPrisma() {
  return {
    adminSettings: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    personality: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    channelSettings: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    user: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
}

describe('ConfigCascadeResolver', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let resolver: ConfigCascadeResolver;

  beforeEach(() => {
    // The shared mockLogger outlives individual tests (module-level logger);
    // clear its call history so warn-absence assertions see only this test.
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockPrisma = createMockPrisma();
    // `now: () => Date.now()` makes TTLCache's TTL respect vi.useFakeTimers
    // (lru-cache's default `performance.now()` is NOT mocked by fake timers).
    resolver = new ConfigCascadeResolver(mockPrisma as any, {
      enableCleanup: false,
      now: () => Date.now(),
    });
  });

  afterEach(() => {
    resolver.stopCleanup();
    vi.restoreAllMocks();
  });

  describe('resolveOverrides', () => {
    it('should return hardcoded defaults when all JSONB columns are NULL', async () => {
      const result = await resolver.resolveOverrides('user-123', 'personality-456');

      expect(result.maxMessages).toBe(HARDCODED_CONFIG_DEFAULTS.maxMessages);
      expect(result.maxAge).toBe(HARDCODED_CONFIG_DEFAULTS.maxAge);
      expect(result.maxImages).toBe(HARDCODED_CONFIG_DEFAULTS.maxImages);
      expect(result.memoryScoreThreshold).toBe(HARDCODED_CONFIG_DEFAULTS.memoryScoreThreshold);
      expect(result.memoryLimit).toBe(HARDCODED_CONFIG_DEFAULTS.memoryLimit);
      expect(result.crossChannelHistoryEnabled).toBe(
        HARDCODED_CONFIG_DEFAULTS.crossChannelHistoryEnabled
      );
      expect(result.shareLtmAcrossPersonalities).toBe(
        HARDCODED_CONFIG_DEFAULTS.shareLtmAcrossPersonalities
      );
      expect(result.showModelFooter).toBe(HARDCODED_CONFIG_DEFAULTS.showModelFooter);
      expect(result.shareHistoryAcrossPersonalities).toBe(
        HARDCODED_CONFIG_DEFAULTS.shareHistoryAcrossPersonalities
      );

      // All sources should be 'hardcoded'
      for (const source of Object.values(result.sources)) {
        expect(source).toBe('hardcoded');
      }
    });

    it('applies a personality-tier shareHistoryAcrossPersonalities override with correct source', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        configDefaults: { shareHistoryAcrossPersonalities: 'guilds-only' },
      });

      const result = await resolver.resolveOverrides('user-123', 'personality-456');

      expect(result.shareHistoryAcrossPersonalities).toBe('guilds-only');
      expect(result.sources.shareHistoryAcrossPersonalities).toBe('personality');
    });

    it('should apply admin tier override with correct source', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        configDefaults: { maxMessages: 75 },
      });

      const result = await resolver.resolveOverrides('user-123', 'personality-456');

      expect(result.maxMessages).toBe(75);
      expect(result.sources.maxMessages).toBe('admin');
      // Other fields remain hardcoded
      expect(result.maxImages).toBe(HARDCODED_CONFIG_DEFAULTS.maxImages);
      expect(result.sources.maxImages).toBe('hardcoded');
    });

    it('should apply personality tier override (overrides admin)', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        configDefaults: { maxMessages: 75 },
      });
      mockPrisma.personality.findUnique.mockResolvedValue({
        configDefaults: { maxMessages: 30, maxImages: 5 },
      });

      const result = await resolver.resolveOverrides('user-123', 'personality-456');

      expect(result.maxMessages).toBe(30);
      expect(result.sources.maxMessages).toBe('personality');
      expect(result.maxImages).toBe(5);
      expect(result.sources.maxImages).toBe('personality');
    });

    it('should apply channel tier override (overrides personality)', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        configDefaults: { maxMessages: 30 },
      });
      mockPrisma.channelSettings.findUnique.mockResolvedValue({
        configOverrides: { maxMessages: 40, maxImages: 8 },
      });

      const result = await resolver.resolveOverrides('user-123', 'personality-456', 'channel-789');

      expect(result.maxMessages).toBe(40);
      expect(result.sources.maxMessages).toBe('channel');
      expect(result.maxImages).toBe(8);
      expect(result.sources.maxImages).toBe('channel');
    });

    it('should not load channel tier when channelId is not provided', async () => {
      const result = await resolver.resolveOverrides('user-123', 'personality-456');

      expect(mockPrisma.channelSettings.findUnique).not.toHaveBeenCalled();
      expect(result.maxMessages).toBe(HARDCODED_CONFIG_DEFAULTS.maxMessages);
    });

    it('should apply user-default tier override (overrides channel)', async () => {
      mockPrisma.channelSettings.findUnique.mockResolvedValue({
        configOverrides: { maxMessages: 40 },
      });
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-id',
        configDefaults: { maxMessages: 60 },
        personalityConfigs: [],
      });

      const result = await resolver.resolveOverrides('user-123', 'personality-456', 'channel-789');

      expect(result.maxMessages).toBe(60);
      expect(result.sources.maxMessages).toBe('user-default');
    });

    it('should apply user-default tier override (overrides personality)', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        configDefaults: { maxMessages: 30 },
      });
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-id',
        configDefaults: { maxMessages: 60 },
        personalityConfigs: [],
      });

      const result = await resolver.resolveOverrides('user-123', 'personality-456');

      expect(result.maxMessages).toBe(60);
      expect(result.sources.maxMessages).toBe('user-default');
    });

    it('should apply user-personality tier (highest priority)', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        configDefaults: { maxMessages: 75, memoryLimit: 30 },
      });
      mockPrisma.personality.findUnique.mockResolvedValue({
        configDefaults: { maxMessages: 30 },
      });
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-id',
        configDefaults: { maxMessages: 60 },
        personalityConfigs: [
          {
            configOverrides: { maxMessages: 10, crossChannelHistoryEnabled: true },
          },
        ],
      });

      const result = await resolver.resolveOverrides('user-123', 'personality-456');

      expect(result.maxMessages).toBe(10);
      expect(result.sources.maxMessages).toBe('user-personality');
      expect(result.crossChannelHistoryEnabled).toBe(true);
      expect(result.sources.crossChannelHistoryEnabled).toBe('user-personality');
      // Admin memoryLimit persists (not overridden by higher tiers)
      expect(result.memoryLimit).toBe(30);
      expect(result.sources.memoryLimit).toBe('admin');
    });

    it('should apply full 5-tier cascade with channel tier', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        configDefaults: { maxMessages: 75, memoryLimit: 30 },
      });
      mockPrisma.personality.findUnique.mockResolvedValue({
        configDefaults: { maxMessages: 50 },
      });
      mockPrisma.channelSettings.findUnique.mockResolvedValue({
        configOverrides: { maxMessages: 40, maxImages: 8 },
      });
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-id',
        configDefaults: { maxMessages: 60 },
        personalityConfigs: [
          {
            configOverrides: { maxMessages: 10 },
          },
        ],
      });

      const result = await resolver.resolveOverrides('user-123', 'personality-456', 'channel-789');

      // user-personality wins for maxMessages (10)
      expect(result.maxMessages).toBe(10);
      expect(result.sources.maxMessages).toBe('user-personality');
      // channel wins for maxImages (8) — no higher tier overrides it
      expect(result.maxImages).toBe(8);
      expect(result.sources.maxImages).toBe('channel');
      // admin wins for memoryLimit (30) — no higher tier overrides it
      expect(result.memoryLimit).toBe(30);
      expect(result.sources.memoryLimit).toBe('admin');
    });

    it('should apply showModelFooter override from user-default tier', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-id',
        configDefaults: { showModelFooter: false },
        personalityConfigs: [],
      });

      const result = await resolver.resolveOverrides('user-123', 'personality-456');

      expect(result.showModelFooter).toBe(false);
      expect(result.sources.showModelFooter).toBe('user-default');
    });

    it('should handle DB error gracefully (channel tier)', async () => {
      mockPrisma.channelSettings.findUnique.mockRejectedValue(new Error('DB error'));

      const result = await resolver.resolveOverrides('user-123', 'personality-456', 'channel-789');

      // Should still return hardcoded defaults
      expect(result.maxMessages).toBe(HARDCODED_CONFIG_DEFAULTS.maxMessages);
      // The degraded tier must be visible to operators, not swallowed silently.
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Failed to load channel config overrides'
      );
    });

    it('should skip invalid JSONB with warning', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        configDefaults: { maxMessages: 'not-a-number', unknownField: true },
      });

      const result = await resolver.resolveOverrides('user-123', 'personality-456');

      // Invalid JSONB skipped, falls back to hardcoded
      expect(result.maxMessages).toBe(HARDCODED_CONFIG_DEFAULTS.maxMessages);
      expect(result.sources.maxMessages).toBe('hardcoded');
    });

    it('should strip unknown fields and preserve valid fields (.strip() mode)', async () => {
      // .strip() discards unknown keys, valid fields still parse successfully
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        configDefaults: { maxMessages: 75, unknownField: 'bad' },
      });

      const result = await resolver.resolveOverrides('user-123', 'personality-456');

      // Valid field preserved, unknown key silently discarded
      expect(result.maxMessages).toBe(75);
      expect(result.sources.maxMessages).toBe('admin');
    });

    it('should handle anonymous user (no userId)', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        configDefaults: { maxMessages: 75 },
      });

      const result = await resolver.resolveOverrides(undefined, 'personality-456');

      expect(result.maxMessages).toBe(75);
      expect(result.sources.maxMessages).toBe('admin');
      // No user queries should be made
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('should handle no personality (no personalityId)', async () => {
      const result = await resolver.resolveOverrides('user-123');

      // No personality queries should be made
      expect(mockPrisma.personality.findUnique).not.toHaveBeenCalled();
      expect(result.maxMessages).toBe(HARDCODED_CONFIG_DEFAULTS.maxMessages);
    });

    it('should query admin with singleton ID', async () => {
      await resolver.resolveOverrides('user-123', 'personality-456');

      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledWith({
        where: { id: ADMIN_SETTINGS_SINGLETON_ID },
        select: { configDefaults: true },
      });
    });

    it('should handle DB error gracefully (admin tier)', async () => {
      mockPrisma.adminSettings.findUnique.mockRejectedValue(new Error('DB error'));

      const result = await resolver.resolveOverrides('user-123', 'personality-456');

      // Should still return hardcoded defaults
      expect(result.maxMessages).toBe(HARDCODED_CONFIG_DEFAULTS.maxMessages);
      // The degraded tier must be visible to operators, not swallowed silently.
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Failed to load admin config defaults'
      );
    });

    it('should handle DB error gracefully (user tier)', async () => {
      mockPrisma.user.findFirst.mockRejectedValue(new Error('DB error'));

      const result = await resolver.resolveOverrides('user-123', 'personality-456');

      expect(result.maxMessages).toBe(HARDCODED_CONFIG_DEFAULTS.maxMessages);
      // Same operator-visibility requirement as the admin tier.
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Failed to load user config defaults'
      );
    });
  });

  describe('tier query shapes (the Prisma seam)', () => {
    // With Prisma mocked, a wrong `select`/`where` shape is invisible to the
    // value-flow tests above — the mock returns whatever it's programmed to
    // regardless. These assert the exact arguments crossing the seam.

    it('queries the personality tier with the exact select shape', async () => {
      await resolver.resolveOverrides('user-123', 'personality-456');

      expect(mockPrisma.personality.findUnique).toHaveBeenCalledWith({
        where: { id: 'personality-456' },
        select: { configDefaults: true },
      });
    });

    it('queries the channel tier with the exact select shape', async () => {
      await resolver.resolveOverrides('user-123', 'personality-456', 'channel-789');

      expect(mockPrisma.channelSettings.findUnique).toHaveBeenCalledWith({
        where: { channelId: 'channel-789' },
        select: { configOverrides: true },
      });
    });

    it('queries the user tiers with the nested per-personality sub-select', async () => {
      await resolver.resolveOverrides('user-123', 'personality-456');

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { discordId: 'user-123' },
        select: {
          id: true,
          configDefaults: true,
          personalityConfigs: {
            where: { personalityId: 'personality-456' },
            select: { configOverrides: true },
            take: 1,
          },
        },
      });
    });

    it('omits the per-personality sub-select when no personalityId is given', async () => {
      await resolver.resolveOverrides('user-123');

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { discordId: 'user-123' },
        select: {
          id: true,
          configDefaults: true,
          personalityConfigs: undefined,
        },
      });
    });
  });

  describe('absent rows stay silent (no spurious warnings)', () => {
    // Every tier loader guards its row/JSONB access; a broken guard degrades
    // to the catch path, which produces the SAME empty-tier result but emits
    // a spurious warning. The warn channel is the only observable — and it
    // matters, because operators alert on it.

    it('does not warn when every tier row is absent', async () => {
      // createMockPrisma defaults: all lookups resolve null.
      await resolver.resolveOverrides('user-123', 'personality-456', 'channel-789');

      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('does not warn for a user row with null overrides and no per-personality key', async () => {
      // No personalityId → the select omits personalityConfigs entirely, so
      // the row comes back without that key; configDefaults NULL in the DB.
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'u1', configDefaults: null });

      await resolver.resolveOverrides('user-123');

      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('does not warn for a user row with an empty per-personality result', async () => {
      // personalityId present but the user has no override row → empty array.
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'u1',
        configDefaults: null,
        personalityConfigs: [],
      });

      await resolver.resolveOverrides('user-123', 'personality-456');

      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });

  describe('constructor options', () => {
    it('constructs without an options argument and still resolves', async () => {
      const bare = new ConfigCascadeResolver(mockPrisma as any);

      const result = await bare.resolveOverrides('user-123');

      expect(result.maxMessages).toBe(HARDCODED_CONFIG_DEFAULTS.maxMessages);
    });
  });

  describe('caching', () => {
    it('should return cached result on second call', async () => {
      const result1 = await resolver.resolveOverrides('user-123', 'personality-456');
      const result2 = await resolver.resolveOverrides('user-123', 'personality-456');

      expect(result1).toBe(result2);
      // DB should only be queried once
      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(1);
    });

    it('should query DB again after cache expires', async () => {
      await resolver.resolveOverrides('user-123', 'personality-456');

      // Advance past TTL
      vi.advanceTimersByTime(15_000);

      await resolver.resolveOverrides('user-123', 'personality-456');

      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(2);
    });

    it('should invalidate user cache entries', async () => {
      await resolver.resolveOverrides('user-123', 'personality-456');
      await resolver.resolveOverrides('user-123', 'personality-789');

      resolver.invalidateUserCache('user-123');

      await resolver.resolveOverrides('user-123', 'personality-456');

      // Should re-query after invalidation
      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(3);
    });

    it('should invalidate personality cache entries', async () => {
      await resolver.resolveOverrides('user-111', 'personality-456');
      await resolver.resolveOverrides('user-222', 'personality-456');

      resolver.invalidatePersonalityCache('personality-456');

      await resolver.resolveOverrides('user-111', 'personality-456');

      // Should re-query after invalidation
      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(3);
    });

    it('should invalidate personality cache entries with channelId in key', async () => {
      // Exercises pipe-separated key format: userId|personalityId|channelId
      await resolver.resolveOverrides('user-111', 'personality-456', 'channel-A');
      await resolver.resolveOverrides('user-222', 'personality-456', 'channel-B');
      await resolver.resolveOverrides('user-333', 'personality-999', 'channel-A');

      resolver.invalidatePersonalityCache('personality-456');

      // personality-456 entries re-query; personality-999 stays cached
      await resolver.resolveOverrides('user-111', 'personality-456', 'channel-A');
      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(4);

      await resolver.resolveOverrides('user-333', 'personality-999', 'channel-A');
      // Still cached — not invalidated
      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(4);
    });

    it('should use different cache keys for different channelIds', async () => {
      await resolver.resolveOverrides('user-123', 'personality-456', 'channel-A');
      await resolver.resolveOverrides('user-123', 'personality-456', 'channel-B');

      // Two separate queries — different cache keys
      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(2);
    });

    it('should invalidate channel cache entries', async () => {
      await resolver.resolveOverrides('user-111', 'personality-456', 'channel-789');
      await resolver.resolveOverrides('user-222', 'personality-456', 'channel-789');

      resolver.invalidateChannelCache('channel-789');

      await resolver.resolveOverrides('user-111', 'personality-456', 'channel-789');

      // Should re-query after invalidation
      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(3);
    });

    it('should not invalidate entries for different channels', async () => {
      await resolver.resolveOverrides('user-111', 'personality-456', 'channel-AAA');
      await resolver.resolveOverrides('user-222', 'personality-456', 'channel-BBB');

      resolver.invalidateChannelCache('channel-AAA');

      // channel-BBB should still be cached
      await resolver.resolveOverrides('user-222', 'personality-456', 'channel-BBB');
      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(2);
    });

    it('should clear all cache entries', async () => {
      await resolver.resolveOverrides('user-111', 'personality-456');
      await resolver.resolveOverrides('user-222', 'personality-789');

      resolver.clearCache();

      await resolver.resolveOverrides('user-111', 'personality-456');
      await resolver.resolveOverrides('user-222', 'personality-789');

      // All re-queried
      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(4);
    });

    it('treats an empty-string userId as a distinct cache key from an undefined userId', async () => {
      // The cache key uses `?? 'anon'` for a missing userId, which does NOT
      // coalesce an empty string — '' and undefined must produce DIFFERENT
      // cache keys. If the 'anon' sentinel were emptied, both would collide
      // on the same key and the second call would be wrongly served from cache.
      await resolver.resolveOverrides(undefined, undefined, undefined);
      mockPrisma.user.findFirst.mockClear();

      await resolver.resolveOverrides('', undefined, undefined);

      expect(mockPrisma.user.findFirst).toHaveBeenCalled();
    });

    it('treats an empty-string personalityId as a distinct cache key from an undefined personalityId', async () => {
      // Same sentinel-collision guard as above, for the 'none' personalityId sentinel.
      await resolver.resolveOverrides('u1', undefined, 'c1');
      mockPrisma.personality.findUnique.mockClear();

      await resolver.resolveOverrides('u1', '', 'c1');

      expect(mockPrisma.personality.findUnique).toHaveBeenCalled();
    });

    it('treats an empty-string channelId as a distinct cache key from an undefined channelId', async () => {
      // Same sentinel-collision guard as above, for the 'no-ch' channelId sentinel.
      await resolver.resolveOverrides('u1', 'p1', undefined);
      mockPrisma.channelSettings.findUnique.mockClear();

      await resolver.resolveOverrides('u1', 'p1', '');

      expect(mockPrisma.channelSettings.findUnique).toHaveBeenCalled();
    });

    it('invalidateUserCache does not evict a DIFFERENT user whose id is a superstring (no separator collapse)', async () => {
      // The invalidation prefix is `${userId}|` — without the '|' separator,
      // invalidating 'u1' would also match keys starting with 'u12'.
      await resolver.resolveOverrides('u1', 'p1');
      await resolver.resolveOverrides('u12', 'p2');

      resolver.invalidateUserCache('u1');

      mockPrisma.adminSettings.findUnique.mockClear();
      await resolver.resolveOverrides('u12', 'p2');

      // u12's entry must have survived the u1 invalidation — no re-query.
      expect(mockPrisma.adminSettings.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('parentValues (what the field resolves to with the winning tier removed)', () => {
    it('defaults to the hardcoded value when no tier sets the field', async () => {
      const result = await resolver.resolveOverrides('user-123', 'personality-456');

      expect(result.parentValues.maxMessages).toBe(HARDCODED_CONFIG_DEFAULTS.maxMessages);
    });

    it('is the hardcoded default when exactly one tier sets the field', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        configDefaults: { maxMessages: 75 },
      });

      const result = await resolver.resolveOverrides('user-123', 'personality-456');

      expect(result.maxMessages).toBe(75);
      expect(result.sources.maxMessages).toBe('admin');
      expect(result.parentValues.maxMessages).toBe(HARDCODED_CONFIG_DEFAULTS.maxMessages);
    });

    it('is the admin value when admin AND user-default both set the field', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        configDefaults: { maxMessages: 75 },
      });
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-id',
        configDefaults: { maxMessages: 60 },
        personalityConfigs: [],
      });

      const result = await resolver.resolveOverrides('user-123', 'personality-456');

      // Effective = user-default value; parent = the value one tier down (admin's).
      expect(result.maxMessages).toBe(60);
      expect(result.sources.maxMessages).toBe('user-default');
      expect(result.parentValues.maxMessages).toBe(75);
    });
  });

  describe('personality tier load failure', () => {
    it('logs a warning and degrades to hardcoded defaults when the personality query throws', async () => {
      mockPrisma.personality.findUnique.mockRejectedValue(new Error('boom'));

      const result = await resolver.resolveOverrides('user-123', 'personality-456');

      expect(result.maxMessages).toBe(HARDCODED_CONFIG_DEFAULTS.maxMessages);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error), personalityId: 'personality-456' }),
        'Failed to load personality config defaults'
      );
    });
  });

  describe('channel-scoped resolve (userId omitted — channel dashboard shape)', () => {
    // The channel settings dashboard resolves with userId=undefined so every
    // viewing moderator sees the same channel state, never their own
    // user-default/user-personality tiers. A user-tier row that WOULD win if
    // loaded proves the omission actually skips the query, not just that the
    // (empty) user tier happens not to contribute.

    it('never draws from the user tier when userId is undefined, even when a winning user row exists', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        configDefaults: { maxMessages: 50 },
      });
      mockPrisma.channelSettings.findUnique.mockResolvedValue({
        configOverrides: { maxMessages: 40 },
      });
      // This row would win (user-personality > channel) if the user tier were
      // loaded — proving the test isn't vacuously passing on an empty tier.
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-id',
        configDefaults: { maxMessages: 60 },
        personalityConfigs: [{ configOverrides: { maxMessages: 10 } }],
      });

      const result = await resolver.resolveOverrides(undefined, 'personality-456', 'channel-789');

      expect(result.maxMessages).toBe(40);
      expect(result.sources.maxMessages).toBe('channel');
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('resolves through personality when no channel override applies, still never touching the user tier', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        configDefaults: { maxMessages: 50 },
      });
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-id',
        configDefaults: { maxMessages: 60 },
        personalityConfigs: [{ configOverrides: { maxMessages: 10 } }],
      });

      const result = await resolver.resolveOverrides(undefined, 'personality-456');

      expect(result.maxMessages).toBe(50);
      expect(result.sources.maxMessages).toBe('personality');
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    });
  });
});

describe('stored null as explicit OFF (terminal)', () => {
  it('a tier-stored null overrides lower tiers and carries its source', async () => {
    const mockPrisma = createMockPrisma();
    // Admin tier sets a real value; user tier stores explicit OFF (null).
    mockPrisma.adminSettings.findUnique.mockResolvedValue({
      configDefaults: { maxAge: 3600 },
    });
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'u1',
      configDefaults: { maxAge: null },
      personalityConfigs: [],
    });

    const resolver = new ConfigCascadeResolver(mockPrisma as never, { enableCleanup: false });
    const result = await resolver.resolveOverrides('user-1');

    // Stored null is terminal OFF — it must NOT fall through to admin's 3600.
    expect(result.maxAge).toBeNull();
    expect(result.sources.maxAge).toBe('user-default');
  });
});
