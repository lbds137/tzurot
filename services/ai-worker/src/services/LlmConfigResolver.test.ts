/**
 * LLM Config Resolver Tests
 *
 * Tests the config resolution hierarchy:
 * 1. User per-personality override
 * 2. User global default
 * 3. Personality default
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LlmConfigResolver } from './LlmConfigResolver.js';
import type { LoadedPersonality, PrismaClient } from '@tzurot/common-types';

// Mock logger
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

describe('LlmConfigResolver', () => {
  let resolver: LlmConfigResolver;
  let mockPrisma: {
    user: {
      findFirst: ReturnType<typeof vi.fn>;
    };
    userPersonalityConfig: {
      findFirst: ReturnType<typeof vi.fn>;
    };
    llmConfig: {
      findFirst: ReturnType<typeof vi.fn>;
    };
  };

  const mockPersonality: LoadedPersonality = {
    id: 'test-personality',
    name: 'Test Personality',
    displayName: 'Test',
    webhookId: null,
    model: 'anthropic/claude-sonnet-4',
    visionModel: 'anthropic/claude-sonnet-4',
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    frequencyPenalty: 0.0,
    presencePenalty: 0.0,
    maxTokens: 4096,
    memoryScoreThreshold: 0.7,
    memoryLimit: 10,
    contextWindowTokens: 128000,
    systemPrompt: 'Test system prompt',
    avatar: null,
    maxReferencedMessages: 20,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mockPrisma = {
      user: {
        findFirst: vi.fn(),
      },
      userPersonalityConfig: {
        findFirst: vi.fn(),
      },
      llmConfig: {
        findFirst: vi.fn(),
      },
    };
    // Disable cleanup interval in tests to avoid timer issues
    resolver = new LlmConfigResolver(mockPrisma as unknown as PrismaClient, {
      cacheTtlMs: 60000,
      enableCleanup: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('resolveConfig', () => {
    it('should return personality default when no userId provided', async () => {
      const result = await resolver.resolveConfig(undefined, 'personality-id', mockPersonality);

      expect(result.source).toBe('personality');
      expect(result.config.model).toBe('anthropic/claude-sonnet-4');
      expect(result.configName).toBeUndefined();
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('should return personality default when userId is empty string', async () => {
      const result = await resolver.resolveConfig('', 'personality-id', mockPersonality);

      expect(result.source).toBe('personality');
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('should return personality default when user not found in DB', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const result = await resolver.resolveConfig('user-123', 'personality-id', mockPersonality);

      expect(result.source).toBe('personality');
      expect(result.config.model).toBe('anthropic/claude-sonnet-4');
    });

    it('should return per-personality override when available', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-user-id',
        defaultLlmConfigId: null,
        defaultLlmConfig: null,
      });

      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue({
        llmConfig: {
          name: 'User Override Config',
          model: 'google/gemini-2.0-flash',
          visionModel: null,
          advancedParameters: {
            temperature: 0.5,
            max_tokens: 2048,
          },
          memoryScoreThreshold: null,
          memoryLimit: null,
          contextWindowTokens: 100000,
        },
      });

      const result = await resolver.resolveConfig('user-123', 'personality-id', mockPersonality);

      expect(result.source).toBe('user-personality');
      expect(result.configName).toBe('User Override Config');
      expect(result.config.model).toBe('google/gemini-2.0-flash');
      expect(result.config.temperature).toBe(0.5);
      expect(result.config.maxTokens).toBe(2048);
      // Personality defaults used for null override values
      expect(result.config.visionModel).toBe('anthropic/claude-sonnet-4');
      expect(result.config.topP).toBe(0.9);
    });

    it('should return user global default when no per-personality override', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-user-id',
        defaultLlmConfigId: 'global-config-id',
        defaultLlmConfig: {
          name: 'User Global Config',
          model: 'openai/gpt-4o',
          visionModel: 'openai/gpt-4o',
          advancedParameters: {
            temperature: 0.3,
          },
          memoryScoreThreshold: null,
          memoryLimit: null,
          contextWindowTokens: null,
        },
      });

      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);

      const result = await resolver.resolveConfig('user-123', 'personality-id', mockPersonality);

      expect(result.source).toBe('user-default');
      expect(result.configName).toBe('User Global Config');
      expect(result.config.model).toBe('openai/gpt-4o');
      expect(result.config.temperature).toBe(0.3);
      // Personality defaults used for null override values
      expect(result.config.maxTokens).toBe(4096);
    });

    it('should return personality default when user has no overrides', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-user-id',
        defaultLlmConfigId: null,
        defaultLlmConfig: null,
      });

      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);

      const result = await resolver.resolveConfig('user-123', 'personality-id', mockPersonality);

      expect(result.source).toBe('personality');
      expect(result.config.model).toBe('anthropic/claude-sonnet-4');
    });

    it('should handle advancedParameters JSONB with snake_case keys', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-user-id',
        defaultLlmConfigId: 'config-id',
        defaultLlmConfig: {
          name: 'JSONB Config',
          model: 'anthropic/claude-sonnet-4',
          visionModel: null,
          advancedParameters: {
            temperature: 0.42,
            top_p: 0.85,
            top_k: 50,
            frequency_penalty: 0.3,
            presence_penalty: 0.2,
            repetition_penalty: 1.1,
            max_tokens: 8000,
          },
          memoryScoreThreshold: { toNumber: () => 0.75 }, // Prisma Decimal for non-JSONB field
          memoryLimit: null,
          contextWindowTokens: null,
        },
      });

      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);

      const result = await resolver.resolveConfig('user-123', 'personality-id', mockPersonality);

      // JSONB values converted from snake_case to camelCase
      expect(result.config.temperature).toBe(0.42);
      expect(result.config.topP).toBe(0.85);
      expect(result.config.topK).toBe(50);
      expect(result.config.frequencyPenalty).toBe(0.3);
      expect(result.config.presencePenalty).toBe(0.2);
      expect(result.config.repetitionPenalty).toBe(1.1);
      expect(result.config.maxTokens).toBe(8000);
      // Non-JSONB field still uses Prisma Decimal conversion
      expect(result.config.memoryScoreThreshold).toBe(0.75);
    });

    it('should fall back to personality default on database error', async () => {
      mockPrisma.user.findFirst.mockRejectedValue(new Error('Database error'));

      const result = await resolver.resolveConfig('user-123', 'personality-id', mockPersonality);

      expect(result.source).toBe('personality');
      expect(result.config.model).toBe('anthropic/claude-sonnet-4');
    });
  });

  describe('caching', () => {
    it('should cache resolution results', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-user-id',
        defaultLlmConfigId: null,
        defaultLlmConfig: null,
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);

      // First call
      await resolver.resolveConfig('user-123', 'personality-id', mockPersonality);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      await resolver.resolveConfig('user-123', 'personality-id', mockPersonality);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(1);
    });

    it('should respect cache TTL', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-user-id',
        defaultLlmConfigId: null,
        defaultLlmConfig: null,
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);

      // First call
      await resolver.resolveConfig('user-123', 'personality-id', mockPersonality);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(1);

      // Advance time past TTL
      vi.advanceTimersByTime(61000);

      // Third call - cache expired, should query again
      await resolver.resolveConfig('user-123', 'personality-id', mockPersonality);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(2);
    });

    it('should use different cache keys for different personalities', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-user-id',
        defaultLlmConfigId: null,
        defaultLlmConfig: null,
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);

      // Call with personality-1
      await resolver.resolveConfig('user-123', 'personality-1', mockPersonality);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(1);

      // Call with personality-2 - different personality, should query again
      await resolver.resolveConfig('user-123', 'personality-2', mockPersonality);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalidateUserCache', () => {
    it('should invalidate all cache entries for a user', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-user-id',
        defaultLlmConfigId: null,
        defaultLlmConfig: null,
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);

      // Cache entries for two personalities
      await resolver.resolveConfig('user-123', 'personality-1', mockPersonality);
      await resolver.resolveConfig('user-123', 'personality-2', mockPersonality);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(2);

      // Invalidate user cache
      resolver.invalidateUserCache('user-123');

      // Both should query again
      await resolver.resolveConfig('user-123', 'personality-1', mockPersonality);
      await resolver.resolveConfig('user-123', 'personality-2', mockPersonality);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(4);
    });

    it('should not invalidate cache for other users', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-user-id',
        defaultLlmConfigId: null,
        defaultLlmConfig: null,
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);

      // Cache entries for two users
      await resolver.resolveConfig('user-123', 'personality-1', mockPersonality);
      await resolver.resolveConfig('user-456', 'personality-1', mockPersonality);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(2);

      // Invalidate only user-123
      resolver.invalidateUserCache('user-123');

      // user-123 should query again
      await resolver.resolveConfig('user-123', 'personality-1', mockPersonality);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(3);

      // user-456 should still use cache
      await resolver.resolveConfig('user-456', 'personality-1', mockPersonality);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(3);
    });
  });

  describe('clearCache', () => {
    it('should clear all cache entries', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-user-id',
        defaultLlmConfigId: null,
        defaultLlmConfig: null,
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);

      // Cache entries for multiple users
      await resolver.resolveConfig('user-123', 'personality-1', mockPersonality);
      await resolver.resolveConfig('user-456', 'personality-1', mockPersonality);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(2);

      // Clear all cache
      resolver.clearCache();

      // Both should query again
      await resolver.resolveConfig('user-123', 'personality-1', mockPersonality);
      await resolver.resolveConfig('user-456', 'personality-1', mockPersonality);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(4);
    });
  });

  describe('config merging', () => {
    it('should merge override values with personality defaults', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-user-id',
        defaultLlmConfigId: 'config-id',
        defaultLlmConfig: {
          name: 'Partial Override',
          model: 'google/gemini-2.0-flash',
          visionModel: null, // null - should use personality default
          advancedParameters: {
            temperature: 0.5,
            top_k: 50,
            // top_p, max_tokens not set - should use personality defaults
          },
          memoryScoreThreshold: null,
          memoryLimit: 5,
          contextWindowTokens: null,
        },
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);

      const result = await resolver.resolveConfig('user-123', 'personality-id', mockPersonality);

      // Overridden values
      expect(result.config.model).toBe('google/gemini-2.0-flash');
      expect(result.config.temperature).toBe(0.5);
      expect(result.config.topK).toBe(50);
      expect(result.config.memoryLimit).toBe(5);

      // Personality defaults for null/undefined values
      expect(result.config.visionModel).toBe('anthropic/claude-sonnet-4');
      expect(result.config.topP).toBe(0.9);
      expect(result.config.maxTokens).toBe(4096);
      expect(result.config.contextWindowTokens).toBe(128000);
    });

    it('should handle null advancedParameters gracefully', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-user-id',
        defaultLlmConfigId: 'config-id',
        defaultLlmConfig: {
          name: 'No Params Config',
          model: 'google/gemini-2.0-flash',
          visionModel: null,
          advancedParameters: null, // No JSONB params set
          memoryScoreThreshold: null,
          memoryLimit: null,
          contextWindowTokens: null,
        },
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);

      const result = await resolver.resolveConfig('user-123', 'personality-id', mockPersonality);

      // Model overridden
      expect(result.config.model).toBe('google/gemini-2.0-flash');
      // All sampling params fall back to personality defaults
      expect(result.config.temperature).toBe(0.7);
      expect(result.config.topP).toBe(0.9);
      expect(result.config.topK).toBe(40);
      expect(result.config.maxTokens).toBe(4096);
    });
  });

  describe('cache cleanup', () => {
    it('should not start cleanup interval when enableCleanup is false', () => {
      // Resolver created in beforeEach with enableCleanup: false
      // No interval should be running, so advancing timers shouldn't cause issues
      vi.advanceTimersByTime(10 * 60 * 1000); // 10 minutes
      // If this doesn't throw, the test passes
      expect(true).toBe(true);
    });

    it('should clean up expired cache entries when cleanup runs', async () => {
      // Create a new resolver with cleanup enabled
      const cleanupResolver = new LlmConfigResolver(mockPrisma as unknown as PrismaClient, {
        cacheTtlMs: 1000, // 1 second TTL
        enableCleanup: true,
      });

      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-user-id',
        defaultLlmConfigId: null,
        defaultLlmConfig: null,
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);

      // Cache an entry
      await cleanupResolver.resolveConfig('user-123', 'personality-1', mockPersonality);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(1);

      // Entry is still valid - should use cache
      await cleanupResolver.resolveConfig('user-123', 'personality-1', mockPersonality);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(1);

      // Advance time past TTL
      vi.advanceTimersByTime(2000); // 2 seconds - past the 1 second TTL

      // Advance time to trigger cleanup interval (5 minutes)
      vi.advanceTimersByTime(5 * 60 * 1000);

      // Entry should be expired and cleaned up, new query should happen
      await cleanupResolver.resolveConfig('user-123', 'personality-1', mockPersonality);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(2);

      // Clean up
      cleanupResolver.stopCleanup();
    });

    it('should stop cleanup interval when stopCleanup is called', () => {
      const cleanupResolver = new LlmConfigResolver(mockPrisma as unknown as PrismaClient, {
        cacheTtlMs: 1000,
        enableCleanup: true,
      });

      // Stop the cleanup
      cleanupResolver.stopCleanup();

      // Advancing timers should not cause issues
      vi.advanceTimersByTime(10 * 60 * 1000);
      expect(true).toBe(true);
    });
  });

  describe('toNumber edge cases', () => {
    it('should handle Prisma Decimal for memoryScoreThreshold', async () => {
      // memoryScoreThreshold is still a Prisma Decimal (not in JSONB)
      const mockDecimal = {
        toNumber: () => 0.85,
      };

      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-user-id',
        defaultLlmConfigId: 'config-id',
        defaultLlmConfig: {
          name: 'Decimal Config',
          model: 'test/model',
          visionModel: null,
          advancedParameters: null,
          memoryScoreThreshold: mockDecimal, // Prisma Decimal
          memoryLimit: null,
          contextWindowTokens: null,
        },
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);

      const result = await resolver.resolveConfig('user-123', 'personality-1', mockPersonality);

      expect(result.config.memoryScoreThreshold).toBe(0.85);
    });

    it('should handle invalid advancedParameters gracefully', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-user-id',
        defaultLlmConfigId: 'config-id',
        defaultLlmConfig: {
          name: 'Bad Config',
          model: 'test/model',
          visionModel: null,
          advancedParameters: 'not-an-object', // Invalid JSONB
          memoryScoreThreshold: null,
          memoryLimit: null,
          contextWindowTokens: null,
        },
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);

      const result = await resolver.resolveConfig('user-123', 'personality-1', mockPersonality);

      // Should fall back to personality defaults when JSONB is invalid
      expect(result.config.temperature).toBe(0.7);
      expect(result.config.topP).toBe(0.9);
    });
  });

  describe('getFreeDefaultConfig', () => {
    it('should return null when no free default config exists', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue(null);

      const result = await resolver.getFreeDefaultConfig();

      expect(result).toBeNull();
      expect(mockPrisma.llmConfig.findFirst).toHaveBeenCalledWith({
        where: { isFreeDefault: true },
        select: expect.any(Object),
      });
    });

    it('should return config when isFreeDefault config exists', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue({
        name: 'Free Default Config',
        model: 'google/gemini-2.0-flash:free',
        visionModel: null,
        advancedParameters: {
          temperature: 0.7,
          top_p: 0.9,
          top_k: 40,
          frequency_penalty: 0.0,
          presence_penalty: 0.0,
          max_tokens: 4096,
        },
        memoryScoreThreshold: 0.7,
        memoryLimit: 10,
        contextWindowTokens: 131072,
      });

      const result = await resolver.getFreeDefaultConfig();

      expect(result).not.toBeNull();
      expect(result!.model).toBe('google/gemini-2.0-flash:free');
      expect(result!.temperature).toBe(0.7);
      expect(result!.topP).toBe(0.9);
      expect(result!.maxTokens).toBe(4096);
    });

    it('should cache the free default config result', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue({
        name: 'Free Default Config',
        model: 'google/gemini-2.0-flash:free',
        visionModel: null,
        advancedParameters: {
          temperature: 0.7,
        },
        memoryScoreThreshold: null,
        memoryLimit: null,
        contextWindowTokens: 128000,
      });

      // First call
      await resolver.getFreeDefaultConfig();
      expect(mockPrisma.llmConfig.findFirst).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      await resolver.getFreeDefaultConfig();
      expect(mockPrisma.llmConfig.findFirst).toHaveBeenCalledTimes(1);
    });

    it('should respect cache TTL for free default config', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue({
        name: 'Free Default Config',
        model: 'google/gemini-2.0-flash:free',
        visionModel: null,
        advancedParameters: {
          temperature: 0.7,
        },
        memoryScoreThreshold: null,
        memoryLimit: null,
        contextWindowTokens: 128000,
      });

      // First call
      await resolver.getFreeDefaultConfig();
      expect(mockPrisma.llmConfig.findFirst).toHaveBeenCalledTimes(1);

      // Advance time past TTL
      vi.advanceTimersByTime(61000);

      // Third call - cache expired, should query again
      await resolver.getFreeDefaultConfig();
      expect(mockPrisma.llmConfig.findFirst).toHaveBeenCalledTimes(2);
    });

    it('should handle database errors gracefully', async () => {
      mockPrisma.llmConfig.findFirst.mockRejectedValue(new Error('Database error'));

      const result = await resolver.getFreeDefaultConfig();

      expect(result).toBeNull();
    });

    it('should handle Prisma Decimal values for memoryScoreThreshold', async () => {
      const mockDecimal = {
        toNumber: () => 0.85,
      };

      mockPrisma.llmConfig.findFirst.mockResolvedValue({
        name: 'Free Default Config',
        model: 'google/gemini-2.0-flash:free',
        visionModel: null,
        advancedParameters: {
          temperature: 0.7,
          top_p: 0.9,
          top_k: 40,
          frequency_penalty: 0.3,
          presence_penalty: 0.2,
          max_tokens: 4096,
        },
        memoryScoreThreshold: mockDecimal, // Prisma Decimal - only this uses toNumber()
        memoryLimit: 10,
        contextWindowTokens: 131072,
      });

      const result = await resolver.getFreeDefaultConfig();

      expect(result).not.toBeNull();
      // JSONB values - native numbers
      expect(result!.temperature).toBe(0.7);
      expect(result!.topP).toBe(0.9);
      expect(result!.frequencyPenalty).toBe(0.3);
      expect(result!.presencePenalty).toBe(0.2);
      // Prisma Decimal - uses toNumber()
      expect(result!.memoryScoreThreshold).toBe(0.85);
    });

    it('should be invalidated when clearCache is called', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue({
        name: 'Free Default Config',
        model: 'google/gemini-2.0-flash:free',
        visionModel: null,
        advancedParameters: {
          temperature: 0.7,
        },
        memoryScoreThreshold: null,
        memoryLimit: null,
        contextWindowTokens: 128000,
      });

      // First call - caches result
      await resolver.getFreeDefaultConfig();
      expect(mockPrisma.llmConfig.findFirst).toHaveBeenCalledTimes(1);

      // Clear cache
      resolver.clearCache();

      // Should query again
      await resolver.getFreeDefaultConfig();
      expect(mockPrisma.llmConfig.findFirst).toHaveBeenCalledTimes(2);
    });
  });
});
