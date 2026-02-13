/**
 * Tests for cache invalidation setup
 *
 * Verifies that setupCacheInvalidation correctly wires all resolvers
 * with their corresponding cache invalidation services and event handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Track subscribe callbacks for each service type
type SubscribeCallback = (event: Record<string, unknown>) => void;
const capturedCallbacks = {
  apiKey: null as SubscribeCallback | null,
  llmConfig: null as SubscribeCallback | null,
  persona: null as SubscribeCallback | null,
  cascade: null as SubscribeCallback | null,
};

const mockUnsubscribe = vi.fn().mockResolvedValue(undefined);

// Mock resolvers with trackable methods
const mockApiKeyResolver = { clearCache: vi.fn(), invalidateUserCache: vi.fn() };
const mockLlmConfigResolver = { clearCache: vi.fn(), invalidateUserCache: vi.fn() };
const mockPersonaResolver = { clearCache: vi.fn(), invalidateUserCache: vi.fn() };
const mockCascadeResolver = {
  clearCache: vi.fn(),
  invalidateUserCache: vi.fn(),
  invalidatePersonalityCache: vi.fn(),
};

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
    PersonalityService: class {},
    CacheInvalidationService: class {
      subscribe = vi.fn().mockResolvedValue(undefined);
      unsubscribe = mockUnsubscribe;
    },
    ApiKeyCacheInvalidationService: class {
      subscribe = vi.fn().mockImplementation((cb: SubscribeCallback) => {
        capturedCallbacks.apiKey = cb;
        return Promise.resolve();
      });
      unsubscribe = mockUnsubscribe;
    },
    LlmConfigCacheInvalidationService: class {
      subscribe = vi.fn().mockImplementation((cb: SubscribeCallback) => {
        capturedCallbacks.llmConfig = cb;
        return Promise.resolve();
      });
      unsubscribe = mockUnsubscribe;
    },
    PersonaCacheInvalidationService: class {
      subscribe = vi.fn().mockImplementation((cb: SubscribeCallback) => {
        capturedCallbacks.persona = cb;
        return Promise.resolve();
      });
      unsubscribe = mockUnsubscribe;
    },
    ConfigCascadeResolver: class {
      clearCache = mockCascadeResolver.clearCache;
      invalidateUserCache = mockCascadeResolver.invalidateUserCache;
      invalidatePersonalityCache = mockCascadeResolver.invalidatePersonalityCache;
    },
    ConfigCascadeCacheInvalidationService: class {
      subscribe = vi.fn().mockImplementation((cb: SubscribeCallback) => {
        capturedCallbacks.cascade = cb;
        return Promise.resolve();
      });
      unsubscribe = mockUnsubscribe;
    },
    LlmConfigResolver: class {
      clearCache = mockLlmConfigResolver.clearCache;
      invalidateUserCache = mockLlmConfigResolver.invalidateUserCache;
    },
  };
});

vi.mock('./services/ApiKeyResolver.js', () => ({
  ApiKeyResolver: class {
    clearCache = mockApiKeyResolver.clearCache;
    invalidateUserCache = mockApiKeyResolver.invalidateUserCache;
  },
}));

vi.mock('./services/resolvers/index.js', () => ({
  PersonaResolver: class {
    clearCache = mockPersonaResolver.clearCache;
    invalidateUserCache = mockPersonaResolver.invalidateUserCache;
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
    capturedCallbacks.apiKey = null;
    capturedCallbacks.llmConfig = null;
    capturedCallbacks.persona = null;
    capturedCallbacks.cascade = null;
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
    expect(result.cleanupFns).toHaveLength(5);
  });

  it('should provide cleanup functions that unsubscribe', async () => {
    const result = await setupCacheInvalidation({
      cacheRedis: mockRedis,
      prisma: mockPrisma,
    });

    await Promise.all(result.cleanupFns.map(fn => fn()));

    expect(mockUnsubscribe).toHaveBeenCalledTimes(5);
  });

  describe('API key cache invalidation events', () => {
    it('should clear all API key cache on "all" event', async () => {
      await setupCacheInvalidation({ cacheRedis: mockRedis, prisma: mockPrisma });
      capturedCallbacks.apiKey?.({ type: 'all' });
      expect(mockApiKeyResolver.clearCache).toHaveBeenCalled();
    });

    it('should invalidate specific user API key cache on "user" event', async () => {
      await setupCacheInvalidation({ cacheRedis: mockRedis, prisma: mockPrisma });
      capturedCallbacks.apiKey?.({ type: 'user', discordId: 'user-123' });
      expect(mockApiKeyResolver.invalidateUserCache).toHaveBeenCalledWith('user-123');
    });
  });

  describe('LLM config cache invalidation events', () => {
    it('should clear all LLM config cache on "all" event', async () => {
      await setupCacheInvalidation({ cacheRedis: mockRedis, prisma: mockPrisma });
      capturedCallbacks.llmConfig?.({ type: 'all' });
      expect(mockLlmConfigResolver.clearCache).toHaveBeenCalled();
    });

    it('should invalidate user LLM config cache on "user" event', async () => {
      await setupCacheInvalidation({ cacheRedis: mockRedis, prisma: mockPrisma });
      capturedCallbacks.llmConfig?.({ type: 'user', discordId: 'user-123' });
      expect(mockLlmConfigResolver.invalidateUserCache).toHaveBeenCalledWith('user-123');
    });

    it('should clear all LLM config cache on "config" event', async () => {
      await setupCacheInvalidation({ cacheRedis: mockRedis, prisma: mockPrisma });
      capturedCallbacks.llmConfig?.({ type: 'config', configId: 'cfg-1' });
      expect(mockLlmConfigResolver.clearCache).toHaveBeenCalled();
    });
  });

  describe('persona cache invalidation events', () => {
    it('should clear all persona cache on "all" event', async () => {
      await setupCacheInvalidation({ cacheRedis: mockRedis, prisma: mockPrisma });
      capturedCallbacks.persona?.({ type: 'all' });
      expect(mockPersonaResolver.clearCache).toHaveBeenCalled();
    });

    it('should invalidate user persona cache on "user" event', async () => {
      await setupCacheInvalidation({ cacheRedis: mockRedis, prisma: mockPrisma });
      capturedCallbacks.persona?.({ type: 'user', discordId: 'user-123' });
      expect(mockPersonaResolver.invalidateUserCache).toHaveBeenCalledWith('user-123');
    });
  });

  describe('config cascade cache invalidation events', () => {
    it('should clear all cascade cache on "all" event', async () => {
      await setupCacheInvalidation({ cacheRedis: mockRedis, prisma: mockPrisma });
      capturedCallbacks.cascade?.({ type: 'all' });
      expect(mockCascadeResolver.clearCache).toHaveBeenCalled();
    });

    it('should clear cascade cache on "admin" event', async () => {
      await setupCacheInvalidation({ cacheRedis: mockRedis, prisma: mockPrisma });
      capturedCallbacks.cascade?.({ type: 'admin' });
      expect(mockCascadeResolver.clearCache).toHaveBeenCalled();
    });

    it('should invalidate user cascade cache on "user" event', async () => {
      await setupCacheInvalidation({ cacheRedis: mockRedis, prisma: mockPrisma });
      capturedCallbacks.cascade?.({ type: 'user', discordId: 'user-123' });
      expect(mockCascadeResolver.invalidateUserCache).toHaveBeenCalledWith('user-123');
    });

    it('should invalidate personality cascade cache on "personality" event', async () => {
      await setupCacheInvalidation({ cacheRedis: mockRedis, prisma: mockPrisma });
      capturedCallbacks.cascade?.({ type: 'personality', personalityId: 'pers-456' });
      expect(mockCascadeResolver.invalidatePersonalityCache).toHaveBeenCalledWith('pers-456');
    });
  });
});
