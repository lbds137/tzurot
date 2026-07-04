/**
 * Tests for ApiKeyResolver service
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { ApiKeyResolver } from './ApiKeyResolver.js';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { decryptApiKey } from '@tzurot/common-types/utils/encryption';

// Mock the common-types module
vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: () => ({
      API_KEY_ENCRYPTION_KEY: 'test-encryption-key-32-bytes-long!',
      OPENROUTER_API_KEY: 'system-openrouter-key',
      ELEVENLABS_API_KEY: 'system-elevenlabs-key',
    }),
  };
});

vi.mock('@tzurot/common-types/constants/ai', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/constants/ai')>(
    '@tzurot/common-types/constants/ai'
  );
  return {
    ...actual,
    AIProvider: {
      OpenRouter: 'openrouter',
      ElevenLabs: 'elevenlabs',
      ZaiCoding: 'zai-coding',
    },
  };
});

vi.mock('@tzurot/common-types/utils/encryption', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/encryption')>(
    '@tzurot/common-types/utils/encryption'
  );
  return {
    ...actual,
    decryptApiKey: vi.fn(),
  };
});

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

describe('ApiKeyResolver', () => {
  let mockPrisma: {
    userApiKey: {
      findFirst: Mock;
    };
  };
  let resolver: ApiKeyResolver;
  const mockDecryptApiKey = decryptApiKey as Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma = {
      userApiKey: {
        findFirst: vi.fn(),
      },
    };

    resolver = new ApiKeyResolver(
      mockPrisma as unknown as PrismaClient,
      'test-encryption-key-32-bytes-long!',
      // `now: () => Date.now()` makes TTLCache's TTL respect vi.useFakeTimers
      // (lru-cache's default `performance.now()` is NOT mocked by fake timers).
      { cacheTtlMs: 1000, now: () => Date.now() } // Short TTL for testing
    );
  });

  describe('resolveApiKey', () => {
    it('should return user API key when available', async () => {
      const encryptedData = {
        iv: 'test-iv',
        content: 'encrypted-data',
        tag: 'test-auth-tag',
      };

      mockPrisma.userApiKey.findFirst.mockResolvedValue(encryptedData);
      mockDecryptApiKey.mockReturnValue('decrypted-user-key');

      const result = await resolver.resolveApiKey('user-123', AIProvider.OpenRouter);

      expect(result).toEqual({
        apiKey: 'decrypted-user-key',
        source: 'user',
        provider: AIProvider.OpenRouter,
        userId: 'user-123',
        isGuestMode: false,
      });

      expect(mockPrisma.userApiKey.findFirst).toHaveBeenCalledWith({
        where: {
          user: { discordId: 'user-123' },
          provider: AIProvider.OpenRouter,
          isActive: true,
        },
        select: {
          iv: true,
          content: true,
          tag: true,
        },
      });

      // decryptApiKey gets encryption key from environment, not passed as parameter
      expect(mockDecryptApiKey).toHaveBeenCalledWith(encryptedData);
    });

    it('should fall back to system key with guest mode when user has no key', async () => {
      mockPrisma.userApiKey.findFirst.mockResolvedValue(null);

      const result = await resolver.resolveApiKey('user-123', AIProvider.OpenRouter);

      expect(result).toEqual({
        apiKey: 'system-openrouter-key',
        source: 'system',
        provider: AIProvider.OpenRouter,
        userId: 'user-123',
        isGuestMode: true, // Guest mode - restricted to free models
      });
    });

    it('should fall back to system key with guest mode when userId is undefined', async () => {
      const result = await resolver.resolveApiKey(undefined, AIProvider.OpenRouter);

      expect(result).toEqual({
        apiKey: 'system-openrouter-key',
        source: 'system',
        provider: AIProvider.OpenRouter,
        userId: undefined,
        isGuestMode: true, // Guest mode - restricted to free models
      });

      // Should not query database when no userId
      expect(mockPrisma.userApiKey.findFirst).not.toHaveBeenCalled();
    });

    it('should fall back to system key with guest mode on decryption error', async () => {
      mockPrisma.userApiKey.findFirst.mockResolvedValue({
        iv: 'test-iv',
        content: 'corrupted',
        tag: 'test-auth-tag',
      });
      mockDecryptApiKey.mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      const result = await resolver.resolveApiKey('user-123', AIProvider.OpenRouter);

      expect(result).toEqual({
        apiKey: 'system-openrouter-key',
        source: 'system',
        provider: AIProvider.OpenRouter,
        userId: 'user-123',
        isGuestMode: true, // Guest mode - restricted to free models
      });
    });

    it('should fall back to system key with guest mode on database error', async () => {
      mockPrisma.userApiKey.findFirst.mockRejectedValue(new Error('DB error'));

      const result = await resolver.resolveApiKey('user-123', AIProvider.OpenRouter);

      expect(result).toEqual({
        apiKey: 'system-openrouter-key',
        source: 'system',
        provider: AIProvider.OpenRouter,
        userId: 'user-123',
        isGuestMode: true, // Guest mode - restricted to free models
      });
    });
  });

  describe('caching', () => {
    it('should cache results and not query database again', async () => {
      mockPrisma.userApiKey.findFirst.mockResolvedValue({
        iv: 'iv',
        content: 'encrypted',
        tag: 'tag',
      });
      mockDecryptApiKey.mockReturnValue('user-key');

      // First call
      const result1 = await resolver.resolveApiKey('user-123', AIProvider.OpenRouter);
      // Second call
      const result2 = await resolver.resolveApiKey('user-123', AIProvider.OpenRouter);

      expect(result1).toEqual(result2);
      expect(mockPrisma.userApiKey.findFirst).toHaveBeenCalledTimes(1);
    });

    it('should cache different users separately', async () => {
      mockPrisma.userApiKey.findFirst
        .mockResolvedValueOnce({
          iv: 'iv1',
          content: 'encrypted1',
          tag: 'tag1',
        })
        .mockResolvedValueOnce({
          iv: 'iv2',
          content: 'encrypted2',
          tag: 'tag2',
        });
      mockDecryptApiKey.mockReturnValueOnce('user1-key').mockReturnValueOnce('user2-key');

      const result1 = await resolver.resolveApiKey('user-1', AIProvider.OpenRouter);
      const result2 = await resolver.resolveApiKey('user-2', AIProvider.OpenRouter);

      expect(result1.apiKey).toBe('user1-key');
      expect(result2.apiKey).toBe('user2-key');
      expect(mockPrisma.userApiKey.findFirst).toHaveBeenCalledTimes(2);
    });

    it('should refresh cache after TTL expires', async () => {
      vi.useFakeTimers();

      mockPrisma.userApiKey.findFirst.mockResolvedValue({
        iv: 'iv',
        content: 'encrypted',
        tag: 'tag',
      });
      mockDecryptApiKey.mockReturnValue('user-key');

      // First call - populates cache
      await resolver.resolveApiKey('user-123', AIProvider.OpenRouter);
      expect(mockPrisma.userApiKey.findFirst).toHaveBeenCalledTimes(1);

      // Advance time past TTL (1000ms in test config)
      vi.advanceTimersByTime(1100);

      // Second call - cache expired, should query again
      await resolver.resolveApiKey('user-123', AIProvider.OpenRouter);
      expect(mockPrisma.userApiKey.findFirst).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });

  describe('invalidateUserCache', () => {
    it('should invalidate cache for specific user', async () => {
      mockPrisma.userApiKey.findFirst.mockResolvedValue({
        iv: 'iv',
        content: 'encrypted',
        tag: 'tag',
      });
      mockDecryptApiKey.mockReturnValue('user-key');

      // Populate cache
      await resolver.resolveApiKey('user-123', AIProvider.OpenRouter);
      expect(mockPrisma.userApiKey.findFirst).toHaveBeenCalledTimes(1);

      // Invalidate
      resolver.invalidateUserCache('user-123');

      // Next call should query database again
      await resolver.resolveApiKey('user-123', AIProvider.OpenRouter);
      expect(mockPrisma.userApiKey.findFirst).toHaveBeenCalledTimes(2);
    });

    it('should not affect other users cache', async () => {
      mockPrisma.userApiKey.findFirst.mockResolvedValue({
        iv: 'iv',
        content: 'encrypted',
        tag: 'tag',
      });
      mockDecryptApiKey.mockReturnValue('user-key');

      // Populate cache for two users
      await resolver.resolveApiKey('user-1', AIProvider.OpenRouter);
      await resolver.resolveApiKey('user-2', AIProvider.OpenRouter);
      expect(mockPrisma.userApiKey.findFirst).toHaveBeenCalledTimes(2);

      // Invalidate only user-1
      resolver.invalidateUserCache('user-1');

      // Query user-1 again - should hit database
      await resolver.resolveApiKey('user-1', AIProvider.OpenRouter);
      // Query user-2 - should still use cache
      await resolver.resolveApiKey('user-2', AIProvider.OpenRouter);

      expect(mockPrisma.userApiKey.findFirst).toHaveBeenCalledTimes(3);
    });
  });

  describe('clearCache', () => {
    it('should clear all cached entries', async () => {
      mockPrisma.userApiKey.findFirst.mockResolvedValue({
        iv: 'iv',
        content: 'encrypted',
        tag: 'tag',
      });
      mockDecryptApiKey.mockReturnValue('user-key');

      // Populate cache for multiple users
      await resolver.resolveApiKey('user-1', AIProvider.OpenRouter);
      await resolver.resolveApiKey('user-2', AIProvider.OpenRouter);
      expect(mockPrisma.userApiKey.findFirst).toHaveBeenCalledTimes(2);

      // Clear all cache
      resolver.clearCache();

      // Both users should query database again
      await resolver.resolveApiKey('user-1', AIProvider.OpenRouter);
      await resolver.resolveApiKey('user-2', AIProvider.OpenRouter);
      expect(mockPrisma.userApiKey.findFirst).toHaveBeenCalledTimes(4);
    });
  });

  describe('ElevenLabs system key', () => {
    it('should fall back to ElevenLabs system key when user has no key', async () => {
      mockPrisma.userApiKey.findFirst.mockResolvedValue(null);

      const result = await resolver.resolveApiKey('user-123', AIProvider.ElevenLabs);

      expect(result).toEqual({
        apiKey: 'system-elevenlabs-key',
        source: 'system',
        provider: AIProvider.ElevenLabs,
        userId: 'user-123',
        isGuestMode: true,
      });
    });

    it('should cache ElevenLabs and OpenRouter keys separately', async () => {
      mockPrisma.userApiKey.findFirst.mockResolvedValue(null);

      const openRouterResult = await resolver.resolveApiKey('user-123', AIProvider.OpenRouter);
      const elevenLabsResult = await resolver.resolveApiKey('user-123', AIProvider.ElevenLabs);

      expect(openRouterResult.apiKey).toBe('system-openrouter-key');
      expect(elevenLabsResult.apiKey).toBe('system-elevenlabs-key');
      expect(openRouterResult.provider).toBe(AIProvider.OpenRouter);
      expect(elevenLabsResult.provider).toBe(AIProvider.ElevenLabs);
    });
  });

  describe('ZaiCoding (no system fallback)', () => {
    it('should throw when user has no ZaiCoding key (no operator-provided fallback)', async () => {
      mockPrisma.userApiKey.findFirst.mockResolvedValue(null);

      // z.ai coding plan has no system fallback by design — every user must
      // bring their own coding-plan subscription key. The intentional null
      // from getSystemApiKey causes resolveApiKey to throw rather than silently
      // route requests to a wrong/missing key.
      await expect(resolver.resolveApiKey('user-123', AIProvider.ZaiCoding)).rejects.toThrow(
        /No API key available for provider zai-coding/
      );
    });

    it('should return user ZaiCoding key when present (BYOK only)', async () => {
      const encryptedData = { iv: 'iv', content: 'content', tag: 'tag' };
      mockPrisma.userApiKey.findFirst.mockResolvedValue(encryptedData);
      mockDecryptApiKey.mockReturnValue('zai-user-key');

      const result = await resolver.resolveApiKey('user-123', AIProvider.ZaiCoding);

      expect(result).toEqual({
        apiKey: 'zai-user-key',
        source: 'user',
        provider: AIProvider.ZaiCoding,
        userId: 'user-123',
        isGuestMode: false,
      });
    });
  });

  describe('tryResolveUserKey', () => {
    it('should return null when userId is undefined', async () => {
      const result = await resolver.tryResolveUserKey(undefined, AIProvider.ZaiCoding);

      expect(result).toBeNull();
      expect(mockPrisma.userApiKey.findFirst).not.toHaveBeenCalled();
    });

    it('should return null when encryption is not configured', async () => {
      const noEncryptionResolver = new ApiKeyResolver(mockPrisma as unknown as PrismaClient, '');

      const result = await noEncryptionResolver.tryResolveUserKey('user-123', AIProvider.ZaiCoding);

      expect(result).toBeNull();
      // Should NOT hit the DB — encryption-disabled short-circuit.
      expect(mockPrisma.userApiKey.findFirst).not.toHaveBeenCalled();
    });

    it('should return user key from cache when source is "user"', async () => {
      // Pre-warm the cache via resolveApiKey
      const encryptedData = { iv: 'iv', content: 'content', tag: 'tag' };
      mockPrisma.userApiKey.findFirst.mockResolvedValue(encryptedData);
      mockDecryptApiKey.mockReturnValue('cached-zai-key');

      await resolver.resolveApiKey('user-123', AIProvider.ZaiCoding);
      mockPrisma.userApiKey.findFirst.mockClear();

      // Now tryResolveUserKey should hit the cache, NOT the DB.
      const result = await resolver.tryResolveUserKey('user-123', AIProvider.ZaiCoding);

      expect(result).toBe('cached-zai-key');
      expect(mockPrisma.userApiKey.findFirst).not.toHaveBeenCalled();
    });

    it('should return null on cache hit when source is "system" (user has no key)', async () => {
      // Pre-warm cache with system-source result (this is the path for
      // OpenRouter when user has no key — system key + isGuestMode=true).
      mockPrisma.userApiKey.findFirst.mockResolvedValue(null);

      await resolver.resolveApiKey('user-123', AIProvider.OpenRouter); // system fallback
      mockPrisma.userApiKey.findFirst.mockClear();

      // tryResolveUserKey should NOT honor the system-source cache hit —
      // returning null triggers fallthrough correctly.
      const result = await resolver.tryResolveUserKey('user-123', AIProvider.OpenRouter);

      expect(result).toBeNull();
      // Should also NOT hit the DB — we've decided based on cached source.
      expect(mockPrisma.userApiKey.findFirst).not.toHaveBeenCalled();
    });

    it('should write user-source cache entry on cache miss + DB hit', async () => {
      // First call: cache miss, DB hit, writes cache.
      const encryptedData = { iv: 'iv', content: 'content', tag: 'tag' };
      mockPrisma.userApiKey.findFirst.mockResolvedValue(encryptedData);
      mockDecryptApiKey.mockReturnValue('zai-user-key');

      const firstCall = await resolver.tryResolveUserKey('user-123', AIProvider.ZaiCoding);
      expect(firstCall).toBe('zai-user-key');
      expect(mockPrisma.userApiKey.findFirst).toHaveBeenCalledTimes(1);

      // Second call: cache hit, no DB call.
      mockPrisma.userApiKey.findFirst.mockClear();
      const secondCall = await resolver.tryResolveUserKey('user-123', AIProvider.ZaiCoding);
      expect(secondCall).toBe('zai-user-key');
      expect(mockPrisma.userApiKey.findFirst).not.toHaveBeenCalled();
    });

    it('should NOT cache the null path — re-reads DB on every call (accepted overhead)', async () => {
      // The auto-fallthrough majority path: user has no key for the requested
      // provider. ApiKeyResolver intentionally does NOT write a "no key"
      // sentinel here (would muddy resolveApiKey's source: 'system' semantics
      // for providers like zai-coding that have no system fallback). This test
      // locks in that invariant — if a future refactor adds caching here, the
      // second-call DB-call assertion catches it.
      mockPrisma.userApiKey.findFirst.mockResolvedValue(null);

      const result = await resolver.tryResolveUserKey('user-123', AIProvider.ZaiCoding);
      expect(result).toBeNull();
      expect(mockPrisma.userApiKey.findFirst).toHaveBeenCalledTimes(1);

      const secondResult = await resolver.tryResolveUserKey('user-123', AIProvider.ZaiCoding);
      expect(secondResult).toBeNull();
      expect(mockPrisma.userApiKey.findFirst).toHaveBeenCalledTimes(2);
    });
  });

  describe('encryption key not configured', () => {
    it('should use system key with guest mode when encryption key not provided', async () => {
      const resolverNoEncryption = new ApiKeyResolver(
        mockPrisma as unknown as PrismaClient,
        '' // Empty encryption key
      );

      const result = await resolverNoEncryption.resolveApiKey('user-123', AIProvider.OpenRouter);

      // Should not try to get user key when encryption is disabled
      expect(mockPrisma.userApiKey.findFirst).not.toHaveBeenCalled();
      expect(result).toEqual({
        apiKey: 'system-openrouter-key',
        source: 'system',
        provider: AIProvider.OpenRouter,
        userId: 'user-123',
        isGuestMode: true, // Guest mode - restricted to free models
      });
    });
  });
});
