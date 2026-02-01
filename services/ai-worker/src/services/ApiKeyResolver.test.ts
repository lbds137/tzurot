/**
 * Tests for ApiKeyResolver service
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { ApiKeyResolver } from './ApiKeyResolver.js';
import { AIProvider, decryptApiKey, type PrismaClient } from '@tzurot/common-types';

// Mock the common-types module
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
    getConfig: () => ({
      API_KEY_ENCRYPTION_KEY: 'test-encryption-key-32-bytes-long!',
      OPENROUTER_API_KEY: 'system-openrouter-key',
    }),
    decryptApiKey: vi.fn(),
    AIProvider: {
      OpenRouter: 'openrouter',
    },
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
      { cacheTtlMs: 1000 } // Short TTL for testing
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
