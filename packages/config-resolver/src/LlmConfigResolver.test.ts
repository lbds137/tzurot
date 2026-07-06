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
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';

// Shared logger instance so tests can assert on (absence of) error logs — the
// resolver's logger is created once in the constructor, so the mock must hand
// back a capturable singleton rather than a fresh object per call.
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
    adminSettings: {
      findUnique: ReturnType<typeof vi.fn>;
    };
  };

  const mockPersonality: LoadedPersonality = {
    id: 'test-personality',
    name: 'Test Personality',
    displayName: 'Test',
    slug: 'test-personality',
    ownerId: 'owner-uuid-test',
    model: 'anthropic/claude-sonnet-4',
    provider: 'openrouter',
    visionModel: 'anthropic/claude-sonnet-4',
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    frequencyPenalty: 0.0,
    presencePenalty: 0.0,
    maxTokens: 4096,
    contextWindowTokens: 128000,
    systemPrompt: 'Test system prompt',
    characterInfo: 'A test personality',
    personalityTraits: 'Helpful',
    voiceEnabled: false,
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
      adminSettings: {
        findUnique: vi.fn(),
      },
    };
    // `now: () => Date.now()` makes TTLCache's TTL respect vi.useFakeTimers
    // (lru-cache's default `performance.now()` is NOT mocked by fake timers).
    resolver = new LlmConfigResolver(mockPrisma as unknown as PrismaClient, {
      cacheTtlMs: 60000,
      enableCleanup: false,
      now: () => Date.now(),
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
          provider: 'openrouter',
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
      expect(result.config.topP).toBe(0.9);
    });

    it('should return user global default when no per-personality override', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-user-id',
        defaultLlmConfigId: 'global-config-id',
        defaultLlmConfig: {
          name: 'User Global Config',
          model: 'openai/gpt-4o',
          provider: 'openrouter',
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
          provider: 'openrouter',
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
      // memoryScoreThreshold no longer copied from LlmConfig (moved to cascade)
      expect(result.config.memoryScoreThreshold).toBeUndefined();
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
          provider: 'openrouter',
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
      // memoryLimit no longer copied from LlmConfig (moved to cascade)
      expect(result.config.memoryLimit).toBeUndefined();

      // Personality defaults for null/undefined values
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
          provider: 'openrouter',
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

    it('should merge advanced params from override with personality fallbacks', async () => {
      const personalityWithAdvanced = {
        ...mockPersonality,
        reasoning: { effort: 'medium' as const, enabled: true },
        showThinking: true,
        minP: 0.05,
      };

      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-user-id',
        defaultLlmConfigId: 'config-id',
        defaultLlmConfig: {
          name: 'R1 Config',
          model: 'deepseek/deepseek-r1',
          provider: 'openrouter',
          advancedParameters: {
            reasoning: { effort: 'high', enabled: true }, // Override reasoning
            // showThinking not set - should use personality default
            min_p: 0.1, // Override minP
          },
          memoryScoreThreshold: null,
          memoryLimit: null,
          contextWindowTokens: null,
        },
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);

      const result = await resolver.resolveConfig(
        'user-123',
        'personality-id',
        personalityWithAdvanced
      );

      // Override takes precedence
      expect(result.config.reasoning).toEqual({ effort: 'high', enabled: true });
      expect(result.config.minP).toBe(0.1);
      // Personality fallback when not in override
      expect(result.config.showThinking).toBe(true);
    });

    it('should include advanced params when extracting personality defaults', async () => {
      const personalityWithAdvanced = {
        ...mockPersonality,
        reasoning: { effort: 'high' as const, enabled: true },
        showThinking: true,
        minP: 0.05,
        topA: 0.3,
        transforms: ['middle-out'],
        route: 'fallback' as const,
      };

      // No user - use personality defaults
      const result = await resolver.resolveConfig(
        undefined,
        'personality-id',
        personalityWithAdvanced
      );

      expect(result.source).toBe('personality');
      expect(result.config.reasoning).toEqual({ effort: 'high', enabled: true });
      expect(result.config.showThinking).toBe(true);
      expect(result.config.minP).toBe(0.05);
      expect(result.config.topA).toBe(0.3);
      expect(result.config.transforms).toEqual(['middle-out']);
      expect(result.config.route).toBe('fallback');
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
      // After the TTLCache refactor, eviction happens on access (lru-cache TTL semantics)
      // rather than via a periodic interval. The behavior tested here — that an expired
      // entry is no longer returned and the underlying query re-runs — still holds.
      const cleanupResolver = new LlmConfigResolver(mockPrisma as unknown as PrismaClient, {
        cacheTtlMs: 1000, // 1 second TTL
        enableCleanup: true,
        now: () => Date.now(),
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

      // Entry should be expired (lru-cache evicts on access), new query should happen
      await cleanupResolver.resolveConfig('user-123', 'personality-1', mockPersonality);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(2);

      // stopCleanup is now a no-op preserved for backwards compat; calling it shouldn't error
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
    it('should not copy memoryScoreThreshold from LlmConfig (moved to cascade)', async () => {
      // memoryScoreThreshold was a Prisma Decimal field, but is no longer copied
      // from LlmConfig — it now comes from the config cascade (ConfigCascadeResolver)
      const mockDecimal = {
        toNumber: () => 0.85,
      };

      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-user-id',
        defaultLlmConfigId: 'config-id',
        defaultLlmConfig: {
          name: 'Decimal Config',
          model: 'test/model',
          provider: 'openrouter',
          advancedParameters: null,
          memoryScoreThreshold: mockDecimal,
          memoryLimit: null,
          contextWindowTokens: null,
        },
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);

      const result = await resolver.resolveConfig('user-123', 'personality-1', mockPersonality);

      // No longer copied from LlmConfig — comes from cascade instead
      expect(result.config.memoryScoreThreshold).toBeUndefined();
    });

    it('should handle invalid advancedParameters gracefully', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-user-id',
        defaultLlmConfigId: 'config-id',
        defaultLlmConfig: {
          name: 'Bad Config',
          model: 'test/model',
          provider: 'openrouter',
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

  describe('getGlobalDefaultConfig', () => {
    it('should return null when no global default pointer is set', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({ globalDefaultLlmConfig: null });

      const result = await resolver.getGlobalDefaultConfig();

      expect(result).toBeNull();
      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledWith({
        where: { id: expect.any(String) },
        select: {
          freeDefaultLlmConfig: { select: expect.any(Object) },
          globalDefaultLlmConfig: { select: expect.any(Object) },
        },
      });
    });

    it('should return the full param set when the global default pointer is set', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        globalDefaultLlmConfig: {
          name: 'Global Default Config',
          model: 'anthropic/claude-sonnet-4',
          provider: 'openrouter',
          advancedParameters: {
            temperature: 0.4,
            top_p: 0.8,
            top_k: 50,
            frequency_penalty: 0.1,
            presence_penalty: 0.2,
            max_tokens: 8192,
          },
          memoryScoreThreshold: null,
          memoryLimit: null,
          contextWindowTokens: 200000,
        },
      });

      const result = await resolver.getGlobalDefaultConfig();

      expect(result).not.toBeNull();
      expect(result!.model).toBe('anthropic/claude-sonnet-4');
      expect(result!.temperature).toBe(0.4);
      expect(result!.topP).toBe(0.8);
      expect(result!.topK).toBe(50);
      expect(result!.frequencyPenalty).toBe(0.1);
      expect(result!.presencePenalty).toBe(0.2);
      expect(result!.maxTokens).toBe(8192);
      expect(result!.contextWindowTokens).toBe(200000);
      // Provider rides along so a quota-fallback retarget can rewrite the
      // personality's provider coherently with the target model.
      expect(result!.provider).toBe('openrouter');
    });

    it('should cache the global default config result', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        globalDefaultLlmConfig: {
          name: 'Global Default Config',
          model: 'anthropic/claude-sonnet-4',
          provider: 'openrouter',
          advancedParameters: { temperature: 0.4 },
          memoryScoreThreshold: null,
          memoryLimit: null,
          contextWindowTokens: 200000,
        },
      });

      await resolver.getGlobalDefaultConfig();
      await resolver.getGlobalDefaultConfig();

      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(1);
    });

    it('should NOT cache a null pointer', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({ globalDefaultLlmConfig: null });

      await resolver.getGlobalDefaultConfig();
      await resolver.getGlobalDefaultConfig();

      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(2);
    });

    it('should handle database errors gracefully', async () => {
      mockPrisma.adminSettings.findUnique.mockRejectedValue(new Error('Database error'));

      const result = await resolver.getGlobalDefaultConfig();

      expect(result).toBeNull();
    });
  });

  describe('getFreeDefaultConfig', () => {
    // The free chat default is now the AdminSettings.freeDefaultLlmConfig pointer
    // (a relation join), not an isFreeDefault+kind='text' flag query. The kind
    // filter (and its vision-leak guard) is obsolete: a pointer can only reference
    // the one config an admin set, so there's nothing to leak.
    it('should return null when no free default pointer is set', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({ freeDefaultLlmConfig: null });

      const result = await resolver.getFreeDefaultConfig();

      expect(result).toBeNull();
      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledWith({
        where: { id: expect.any(String) },
        select: {
          freeDefaultLlmConfig: { select: expect.any(Object) },
          globalDefaultLlmConfig: { select: expect.any(Object) },
        },
      });
    });

    it('should return config when the free default pointer is set', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        freeDefaultLlmConfig: {
          name: 'Free Default Config',
          model: 'google/gemini-2.0-flash:free',
          provider: 'openrouter',
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
        },
      });

      const result = await resolver.getFreeDefaultConfig();

      expect(result).not.toBeNull();
      expect(result!.model).toBe('google/gemini-2.0-flash:free');
      expect(result!.temperature).toBe(0.7);
      expect(result!.topP).toBe(0.9);
      expect(result!.maxTokens).toBe(4096);
    });

    it('should cache the free default config result', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        freeDefaultLlmConfig: {
          name: 'Free Default Config',
          model: 'google/gemini-2.0-flash:free',
          provider: 'openrouter',
          advancedParameters: {
            temperature: 0.7,
          },
          memoryScoreThreshold: null,
          memoryLimit: null,
          contextWindowTokens: 128000,
        },
      });

      // First call
      await resolver.getFreeDefaultConfig();
      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      await resolver.getFreeDefaultConfig();
      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(1);
    });

    it('should respect cache TTL for free default config', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        freeDefaultLlmConfig: {
          name: 'Free Default Config',
          model: 'google/gemini-2.0-flash:free',
          provider: 'openrouter',
          advancedParameters: {
            temperature: 0.7,
          },
          memoryScoreThreshold: null,
          memoryLimit: null,
          contextWindowTokens: 128000,
        },
      });

      // First call
      await resolver.getFreeDefaultConfig();
      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(1);

      // Advance time past TTL
      vi.advanceTimersByTime(61000);

      // Third call - cache expired, should query again
      await resolver.getFreeDefaultConfig();
      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(2);
    });

    it('should handle database errors gracefully', async () => {
      mockPrisma.adminSettings.findUnique.mockRejectedValue(new Error('Database error'));

      const result = await resolver.getFreeDefaultConfig();

      expect(result).toBeNull();
    });

    it('should NOT cache a null pointer (admin setting it takes effect without invalidation)', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({ freeDefaultLlmConfig: null });

      await resolver.getFreeDefaultConfig();
      await resolver.getFreeDefaultConfig();

      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(2);
    });

    it('caches free and global defaults under SEPARATE sentinel keys', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        freeDefaultLlmConfig: {
          name: 'Free',
          model: 'free/model',
          provider: 'openrouter',
          advancedParameters: { temperature: 0.7 },
          memoryScoreThreshold: null,
          memoryLimit: null,
          contextWindowTokens: 128000,
        },
        globalDefaultLlmConfig: {
          name: 'Global',
          model: 'paid/default',
          provider: 'openrouter',
          advancedParameters: { temperature: 0.4 },
          memoryScoreThreshold: null,
          memoryLimit: null,
          contextWindowTokens: 200000,
        },
      });

      const free = await resolver.getFreeDefaultConfig();
      const global = await resolver.getGlobalDefaultConfig();

      // Distinct results — one sentinel must not serve the other pointer.
      expect(free!.model).toBe('free/model');
      expect(global!.model).toBe('paid/default');
      // Both cached independently: repeat reads hit no new queries.
      await resolver.getFreeDefaultConfig();
      await resolver.getGlobalDefaultConfig();
      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(2);
    });

    it('should handle Prisma Decimal values for memoryScoreThreshold', async () => {
      const mockDecimal = {
        toNumber: () => 0.85,
      };

      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        freeDefaultLlmConfig: {
          name: 'Free Default Config',
          model: 'google/gemini-2.0-flash:free',
          provider: 'openrouter',
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
        },
      });

      const result = await resolver.getFreeDefaultConfig();

      expect(result).not.toBeNull();
      // JSONB values - native numbers
      expect(result!.temperature).toBe(0.7);
      expect(result!.topP).toBe(0.9);
      expect(result!.frequencyPenalty).toBe(0.3);
      expect(result!.presencePenalty).toBe(0.2);
      // memoryScoreThreshold no longer copied from LlmConfig (moved to cascade)
      expect(result!.memoryScoreThreshold).toBeUndefined();
    });

    it('should be invalidated when clearCache is called', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        freeDefaultLlmConfig: {
          name: 'Free Default Config',
          model: 'google/gemini-2.0-flash:free',
          provider: 'openrouter',
          advancedParameters: {
            temperature: 0.7,
          },
          memoryScoreThreshold: null,
          memoryLimit: null,
          contextWindowTokens: 128000,
        },
      });

      // First call - caches result
      await resolver.getFreeDefaultConfig();
      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(1);

      // Clear cache
      resolver.clearCache();

      // Should query again
      await resolver.getFreeDefaultConfig();
      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('query shapes (the Prisma seam)', () => {
    it('selects the user row with the default-config join flags', async () => {
      // With Prisma mocked, a wrong select shape is invisible to value-flow
      // tests — the mock returns its programmed row regardless. Assert the
      // arguments actually crossing the seam.
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await resolver.resolveConfig('user-123', 'personality-id', mockPersonality);

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { discordId: 'user-123' },
          select: expect.objectContaining({
            id: true,
            defaultLlmConfigId: true,
          }),
        })
      );
    });
  });

  describe('user-not-found caching', () => {
    it('caches the user-not-found resolution (single lookup for repeat calls)', async () => {
      // User-not-found is a definitive answer and must cache; only thrown
      // errors skip the cache. The lookup count pins the two paths apart.
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const first = await resolver.resolveConfig('user-123', 'personality-id', mockPersonality);
      const second = await resolver.resolveConfig('user-123', 'personality-id', mockPersonality);

      expect(first.source).toBe('personality');
      expect(second).toEqual(first);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolved-config key shape', () => {
    it('omits keys the personality leaves undefined (extract path)', async () => {
      // Materializing `key: undefined` differs from omitting the key —
      // spreads, serialization, and Object.keys all observe the difference.
      const sparse: LoadedPersonality = {
        ...mockPersonality,
        topK: undefined,
        frequencyPenalty: undefined,
      };

      const result = await resolver.resolveConfig(undefined, 'personality-id', sparse);

      expect(Object.keys(result.config)).not.toContain('topK');
      expect(Object.keys(result.config)).not.toContain('frequencyPenalty');
    });

    it('omits keys undefined in BOTH override and personality (merge path)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-user-id',
        defaultLlmConfigId: 'global-config-id',
        defaultLlmConfig: {
          name: 'User Global Config',
          model: 'openai/gpt-4o',
          provider: 'openrouter',
          advancedParameters: { temperature: 0.3 },
          memoryScoreThreshold: null,
          memoryLimit: null,
          contextWindowTokens: null,
        },
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);
      const sparse: LoadedPersonality = { ...mockPersonality, topK: undefined };

      const result = await resolver.resolveConfig('user-123', 'personality-id', sparse);

      expect(result.source).toBe('user-default');
      expect(Object.keys(result.config)).not.toContain('topK');
    });
  });

  describe('getFreeDefaultConfig — absent pointer stays silent', () => {
    // A missing admin row / unset pointer is the NORMAL pre-seed state, not a
    // failure: it must return null via the debug path, never the error path
    // (operators alert on error logs).

    it('returns null without an error log when the admin row is absent', async () => {
      mockLogger.error.mockClear();
      mockPrisma.adminSettings.findUnique.mockResolvedValue(null);

      expect(await resolver.getFreeDefaultConfig()).toBeNull();
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('returns null without an error log when the pointer is unset', async () => {
      mockLogger.error.mockClear();
      mockPrisma.adminSettings.findUnique.mockResolvedValue({ freeDefaultLlmConfig: null });

      expect(await resolver.getFreeDefaultConfig()).toBeNull();
      expect(mockLogger.error).not.toHaveBeenCalled();
    });
  });
});
