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
  ttsConfig: null as SubscribeCallback | null,
  stt: null as SubscribeCallback | null,
  persona: null as SubscribeCallback | null,
  cascade: null as SubscribeCallback | null,
  user: null as SubscribeCallback | null,
  systemSettings: null as SubscribeCallback | null,
};

const mockUnsubscribe = vi.fn().mockResolvedValue(undefined);

// Mock resolvers with trackable methods
const mockApiKeyResolver = { clearCache: vi.fn(), invalidateUserCache: vi.fn() };
const mockLlmConfigResolver = { clearCache: vi.fn(), invalidateUserCache: vi.fn() };
const mockTtsConfigResolver = { clearCache: vi.fn(), invalidateUserCache: vi.fn() };
const mockSttResolver = { clearCache: vi.fn(), invalidateUserCache: vi.fn() };
const mockPersonaResolver = { clearCache: vi.fn(), invalidateUserCache: vi.fn() };
const mockCascadeResolver = {
  clearCache: vi.fn(),
  invalidateUserCache: vi.fn(),
  invalidatePersonalityCache: vi.fn(),
  invalidateChannelCache: vi.fn(),
};

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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

vi.mock('@tzurot/cache-invalidation', () => ({
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
  TtsConfigCacheInvalidationService: class {
    subscribe = vi.fn().mockImplementation((cb: SubscribeCallback) => {
      capturedCallbacks.ttsConfig = cb;
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
  ConfigCascadeCacheInvalidationService: class {
    subscribe = vi.fn().mockImplementation((cb: SubscribeCallback) => {
      capturedCallbacks.cascade = cb;
      return Promise.resolve();
    });
    unsubscribe = mockUnsubscribe;
  },
  SttResolverCacheInvalidationService: class {
    subscribe = vi.fn().mockImplementation((cb: SubscribeCallback) => {
      capturedCallbacks.stt = cb;
      return Promise.resolve();
    });
    unsubscribe = mockUnsubscribe;
  },
  UserCacheInvalidationService: class {
    subscribe = vi.fn().mockImplementation((cb: SubscribeCallback) => {
      capturedCallbacks.user = cb;
      return Promise.resolve();
    });
    unsubscribe = mockUnsubscribe;
  },
  SystemSettingsCacheInvalidationService: class {
    subscribe = vi.fn().mockImplementation((cb: SubscribeCallback) => {
      capturedCallbacks.systemSettings = cb;
      return Promise.resolve();
    });
    unsubscribe = mockUnsubscribe;
  },
}));

// SystemSettingsService: mocked so setup's prime() never touches Prisma.
const mockSystemSettingsInvalidate = vi.fn();
const mockSystemSettingsPrime = vi.fn().mockResolvedValue(undefined);
vi.mock('@tzurot/common-types/services/SystemSettingsService', () => ({
  SystemSettingsService: class {
    invalidate = mockSystemSettingsInvalidate;
    prime = mockSystemSettingsPrime;
  },
}));

vi.mock('@tzurot/config-resolver', () => ({
  ConfigCascadeResolver: class {
    clearCache = mockCascadeResolver.clearCache;
    invalidateUserCache = mockCascadeResolver.invalidateUserCache;
    invalidatePersonalityCache = mockCascadeResolver.invalidatePersonalityCache;
    invalidateChannelCache = mockCascadeResolver.invalidateChannelCache;
  },
  LlmConfigResolver: class {
    clearCache = mockLlmConfigResolver.clearCache;
    invalidateUserCache = mockLlmConfigResolver.invalidateUserCache;
  },
  TtsConfigResolver: class {
    clearCache = mockTtsConfigResolver.clearCache;
    invalidateUserCache = mockTtsConfigResolver.invalidateUserCache;
  },
  SttResolver: class {
    clearCache = mockSttResolver.clearCache;
    invalidateUserCache = mockSttResolver.invalidateUserCache;
  },
}));

vi.mock('./services/ApiKeyResolver.js', () => ({
  ApiKeyResolver: class {
    clearCache = mockApiKeyResolver.clearCache;
    invalidateUserCache = mockApiKeyResolver.invalidateUserCache;
  },
}));

const mockInvalidateUser = vi.fn();
vi.mock('@tzurot/identity', () => ({
  PersonalityService: class {},
  PersonaResolver: class {
    clearCache = mockPersonaResolver.clearCache;
    invalidateUserCache = mockPersonaResolver.invalidateUserCache;
  },
  getOrCreateUserService: () => ({ invalidateUser: mockInvalidateUser }),
}));

// The wallet-update recovery edge calls the worker's credit-exhaustion cache
// singleton; mock the redis module so no real client is constructed.
const mockClearCreditExhausted = vi.fn().mockResolvedValue(undefined);
vi.mock('./redis.js', () => ({
  creditExhaustionCache: {
    clearCreditExhausted: (options: { cacheKeyId: string }) => mockClearCreditExhausted(options),
  },
}));

import { setupCacheInvalidation } from './cacheInvalidation.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { Redis } from 'ioredis';

describe('setupCacheInvalidation', () => {
  const mockRedis = {} as Redis;
  const mockPrisma = {} as PrismaClient;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedCallbacks.apiKey = null;
    capturedCallbacks.llmConfig = null;
    capturedCallbacks.ttsConfig = null;
    capturedCallbacks.stt = null;
    capturedCallbacks.persona = null;
    capturedCallbacks.cascade = null;
    capturedCallbacks.user = null;
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
    expect(result.ttsConfigResolver).toBeDefined();
    expect(result.sttResolver).toBeDefined();
    expect(result.personaResolver).toBeDefined();
    expect(result.cascadeResolver).toBeDefined();
    expect(result.cleanupFns).toHaveLength(9);
  });

  it('should provide cleanup functions that unsubscribe', async () => {
    const result = await setupCacheInvalidation({
      cacheRedis: mockRedis,
      prisma: mockPrisma,
    });

    await Promise.all(result.cleanupFns.map(fn => fn()));

    expect(mockUnsubscribe).toHaveBeenCalledTimes(9);
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

    it('clears the credit-exhaustion mark for the user bucket on a wallet key update', async () => {
      await setupCacheInvalidation({ cacheRedis: mockRedis, prisma: mockPrisma });
      capturedCallbacks.apiKey?.({ type: 'user', discordId: '278863839632818186' });
      // The recovery edge: a top-up must not stay stranded behind the doom-cache.
      expect(mockClearCreditExhausted).toHaveBeenCalledWith({
        cacheKeyId: 'user:278863839632818186',
      });
    });

    it('does NOT clear the credit-exhaustion cache on an "all" event (per-account semantic)', async () => {
      await setupCacheInvalidation({ cacheRedis: mockRedis, prisma: mockPrisma });
      capturedCallbacks.apiKey?.({ type: 'all' });
      expect(mockClearCreditExhausted).not.toHaveBeenCalled();
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

  describe('TTS config cache invalidation events', () => {
    it('should clear all TTS config cache on "all" event', async () => {
      await setupCacheInvalidation({ cacheRedis: mockRedis, prisma: mockPrisma });
      capturedCallbacks.ttsConfig?.({ type: 'all' });
      expect(mockTtsConfigResolver.clearCache).toHaveBeenCalled();
    });

    it('should invalidate user TTS config cache on "user" event', async () => {
      await setupCacheInvalidation({ cacheRedis: mockRedis, prisma: mockPrisma });
      capturedCallbacks.ttsConfig?.({ type: 'user', discordId: 'user-123' });
      expect(mockTtsConfigResolver.invalidateUserCache).toHaveBeenCalledWith('user-123');
    });

    it('should clear all TTS config cache on "config" event', async () => {
      await setupCacheInvalidation({ cacheRedis: mockRedis, prisma: mockPrisma });
      capturedCallbacks.ttsConfig?.({ type: 'config', configId: 'cfg-tts-1' });
      expect(mockTtsConfigResolver.clearCache).toHaveBeenCalled();
    });
  });

  describe('STT cache invalidation events', () => {
    it('should clear all STT cache on "all" event', async () => {
      await setupCacheInvalidation({ cacheRedis: mockRedis, prisma: mockPrisma });
      capturedCallbacks.stt?.({ type: 'all' });
      expect(mockSttResolver.clearCache).toHaveBeenCalled();
    });

    it('should invalidate user STT cache on "user" event', async () => {
      await setupCacheInvalidation({ cacheRedis: mockRedis, prisma: mockPrisma });
      capturedCallbacks.stt?.({ type: 'user', discordId: 'user-123' });
      expect(mockSttResolver.invalidateUserCache).toHaveBeenCalledWith('user-123');
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

  describe('user provisioning-cache invalidation events', () => {
    it('evicts the user provisioning cache on a "user" event', async () => {
      await setupCacheInvalidation({ cacheRedis: mockRedis, prisma: mockPrisma });
      capturedCallbacks.user?.({ type: 'user', discordId: 'user-123' });
      expect(mockInvalidateUser).toHaveBeenCalledWith('user-123');
    });

    it('no-ops on an "all" event (TTL bounds staleness; no bulk-evict API)', async () => {
      await setupCacheInvalidation({ cacheRedis: mockRedis, prisma: mockPrisma });
      capturedCallbacks.user?.({ type: 'all' });
      expect(mockInvalidateUser).not.toHaveBeenCalled();
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

    it('should invalidate channel cascade cache on "channel" event', async () => {
      await setupCacheInvalidation({ cacheRedis: mockRedis, prisma: mockPrisma });
      capturedCallbacks.cascade?.({ type: 'channel', channelId: 'channel-789' });
      expect(mockCascadeResolver.invalidateChannelCache).toHaveBeenCalledWith('channel-789');
    });
  });

  describe('system settings invalidation events', () => {
    it('primes the settings cache at setup', async () => {
      await setupCacheInvalidation({ cacheRedis: mockRedis, prisma: mockPrisma });
      expect(mockSystemSettingsPrime).toHaveBeenCalledTimes(1);
    });

    it('refreshes the settings cache on a "keys" event', async () => {
      await setupCacheInvalidation({ cacheRedis: mockRedis, prisma: mockPrisma });
      capturedCallbacks.systemSettings?.({ type: 'keys', keys: ['zaiHeadroomPercent'] });
      expect(mockSystemSettingsInvalidate).toHaveBeenCalled();
    });

    it('refreshes the settings cache on an "all" event', async () => {
      await setupCacheInvalidation({ cacheRedis: mockRedis, prisma: mockPrisma });
      capturedCallbacks.systemSettings?.({ type: 'all' });
      expect(mockSystemSettingsInvalidate).toHaveBeenCalled();
    });
  });
});
