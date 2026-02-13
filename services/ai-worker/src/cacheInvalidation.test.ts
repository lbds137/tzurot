/**
 * Tests for cache invalidation setup
 *
 * Verifies that setupCacheInvalidation correctly wires all resolvers
 * with their corresponding cache invalidation services.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock common-types before imports
const mockSubscribe = vi.fn().mockResolvedValue(undefined);
const mockUnsubscribe = vi.fn().mockResolvedValue(undefined);

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
    PersonalityService: class {
      constructor() {}
    },
    CacheInvalidationService: class {
      subscribe = mockSubscribe;
      unsubscribe = mockUnsubscribe;
    },
    ApiKeyCacheInvalidationService: class {
      subscribe = mockSubscribe;
      unsubscribe = mockUnsubscribe;
    },
    LlmConfigCacheInvalidationService: class {
      subscribe = mockSubscribe;
      unsubscribe = mockUnsubscribe;
    },
    PersonaCacheInvalidationService: class {
      subscribe = mockSubscribe;
      unsubscribe = mockUnsubscribe;
    },
    ConfigCascadeResolver: class {
      clearCache = vi.fn();
      invalidateUserCache = vi.fn();
      invalidatePersonalityCache = vi.fn();
    },
    ConfigCascadeCacheInvalidationService: class {
      subscribe = mockSubscribe;
      unsubscribe = mockUnsubscribe;
    },
    LlmConfigResolver: class {
      clearCache = vi.fn();
      invalidateUserCache = vi.fn();
    },
  };
});

vi.mock('./services/ApiKeyResolver.js', () => ({
  ApiKeyResolver: class {
    clearCache = vi.fn();
    invalidateUserCache = vi.fn();
  },
}));

vi.mock('./services/resolvers/index.js', () => ({
  PersonaResolver: class {
    clearCache = vi.fn();
    invalidateUserCache = vi.fn();
  },
}));

import { setupCacheInvalidation } from './cacheInvalidation.js';
import type { PrismaClient } from '@tzurot/common-types';
import type { Redis } from 'ioredis';

describe('setupCacheInvalidation', () => {
  const mockRedis = {} as Redis;
  const mockPrisma = {} as PrismaClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return all resolvers and services', async () => {
    const result = await setupCacheInvalidation({
      cacheRedis: mockRedis,
      prisma: mockPrisma,
    });

    expect(result.personalityService).toBeDefined();
    expect(result.cacheInvalidationService).toBeDefined();
    expect(result.apiKeyResolver).toBeDefined();
    expect(result.llmConfigResolver).toBeDefined();
    expect(result.personaResolver).toBeDefined();
    expect(result.cascadeResolver).toBeDefined();
    // 5 cleanup fns: personality, API key, LLM config, persona, config cascade
    expect(result.cleanupFns).toHaveLength(5);
  });

  it('should subscribe to all cache invalidation channels', async () => {
    await setupCacheInvalidation({
      cacheRedis: mockRedis,
      prisma: mockPrisma,
    });

    // 5 subscriptions: personality, API key, LLM config, persona, config cascade
    expect(mockSubscribe).toHaveBeenCalledTimes(5);
  });

  it('should provide cleanup functions that unsubscribe', async () => {
    const result = await setupCacheInvalidation({
      cacheRedis: mockRedis,
      prisma: mockPrisma,
    });

    // Execute all cleanup functions
    await Promise.all(result.cleanupFns.map(fn => fn()));

    expect(mockUnsubscribe).toHaveBeenCalledTimes(5);
  });
});
