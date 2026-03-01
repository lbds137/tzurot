/**
 * ConfigCascadeResolver Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigCascadeResolver } from './ConfigCascadeResolver.js';
import { HARDCODED_CONFIG_DEFAULTS } from '../schemas/api/configOverrides.js';
import { ADMIN_SETTINGS_SINGLETON_ID } from '../schemas/api/adminSettings.js';

// Mock logger
vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

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
    vi.useFakeTimers();
    mockPrisma = createMockPrisma();
    resolver = new ConfigCascadeResolver(mockPrisma as any, { enableCleanup: false });
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
      expect(result.focusModeEnabled).toBe(HARDCODED_CONFIG_DEFAULTS.focusModeEnabled);
      expect(result.crossChannelHistoryEnabled).toBe(
        HARDCODED_CONFIG_DEFAULTS.crossChannelHistoryEnabled
      );
      expect(result.shareLtmAcrossPersonalities).toBe(
        HARDCODED_CONFIG_DEFAULTS.shareLtmAcrossPersonalities
      );

      // All sources should be 'hardcoded'
      for (const source of Object.values(result.sources)) {
        expect(source).toBe('hardcoded');
      }
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
            configOverrides: { maxMessages: 10, focusModeEnabled: true },
          },
        ],
      });

      const result = await resolver.resolveOverrides('user-123', 'personality-456');

      expect(result.maxMessages).toBe(10);
      expect(result.sources.maxMessages).toBe('user-personality');
      expect(result.focusModeEnabled).toBe(true);
      expect(result.sources.focusModeEnabled).toBe('user-personality');
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

    it('should handle DB error gracefully (channel tier)', async () => {
      mockPrisma.channelSettings.findUnique.mockRejectedValue(new Error('DB error'));

      const result = await resolver.resolveOverrides('user-123', 'personality-456', 'channel-789');

      // Should still return hardcoded defaults
      expect(result.maxMessages).toBe(HARDCODED_CONFIG_DEFAULTS.maxMessages);
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

    it('should reject entire JSONB when valid fields mixed with unknown fields (strict mode)', async () => {
      // .strict() rejects the whole object, not just the unknown fields
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        configDefaults: { maxMessages: 75, unknownField: 'bad' },
      });

      const result = await resolver.resolveOverrides('user-123', 'personality-456');

      // Entire admin tier rejected — falls back to hardcoded
      expect(result.maxMessages).toBe(HARDCODED_CONFIG_DEFAULTS.maxMessages);
      expect(result.sources.maxMessages).toBe('hardcoded');
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
    });

    it('should handle DB error gracefully (user tier)', async () => {
      mockPrisma.user.findFirst.mockRejectedValue(new Error('DB error'));

      const result = await resolver.resolveOverrides('user-123', 'personality-456');

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
  });
});
