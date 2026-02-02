/**
 * Tests for Autocomplete Data Cache
 * Validates caching behavior for personality and persona lists.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getCachedPersonalities,
  getCachedPersonas,
  invalidateUserCache,
  _clearCacheForTesting,
  _getCacheSizeForTesting,
} from './autocompleteCache.js';
import type { PersonalitySummary } from '@tzurot/common-types';
import type { PersonaSummary } from './autocompleteCache.js';

// Mock the gateway client
const mockCallGatewayApi = vi.fn();
vi.mock('../userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

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

describe('autocompleteCache', () => {
  const testUserId = 'user-123';

  beforeEach(() => {
    vi.clearAllMocks();
    _clearCacheForTesting();
  });

  afterEach(() => {
    _clearCacheForTesting();
  });

  describe('getCachedPersonalities', () => {
    const mockPersonalities: PersonalitySummary[] = [
      {
        id: 'personality-1',
        name: 'Lilith',
        displayName: 'Lilith the Succubus',
        slug: 'lilith',
        isPublic: true,
        isOwned: true,
      },
      {
        id: 'personality-2',
        name: 'Default',
        displayName: null,
        slug: 'default',
        isPublic: true,
        isOwned: true,
      },
    ];

    it('should fetch from gateway on cache miss', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { personalities: mockPersonalities },
      });

      const result = await getCachedPersonalities(testUserId);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/personality', { userId: testUserId });
      expect(result).toEqual(mockPersonalities);
    });

    it('should return cached data on cache hit', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { personalities: mockPersonalities },
      });

      // First call - cache miss
      await getCachedPersonalities(testUserId);
      expect(mockCallGatewayApi).toHaveBeenCalledTimes(1);

      // Second call - cache hit
      const result = await getCachedPersonalities(testUserId);
      expect(mockCallGatewayApi).toHaveBeenCalledTimes(1); // Still only 1 call
      expect(result).toEqual(mockPersonalities);
    });

    it('should cache empty personality list (not treat as cache miss)', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { personalities: [] },
      });

      // First call - cache miss
      await getCachedPersonalities(testUserId);
      expect(mockCallGatewayApi).toHaveBeenCalledTimes(1);

      // Second call - should be cache hit even with empty list
      const result = await getCachedPersonalities(testUserId);
      expect(mockCallGatewayApi).toHaveBeenCalledTimes(1); // Still only 1 call
      expect(result).toEqual([]);
    });

    it('should return empty array on gateway error', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Gateway error',
      });

      const result = await getCachedPersonalities(testUserId);

      expect(result).toEqual([]);
    });

    it('should return empty array on exception', async () => {
      mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

      const result = await getCachedPersonalities(testUserId);

      expect(result).toEqual([]);
    });

    it('should cache per user', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { personalities: mockPersonalities },
      });

      await getCachedPersonalities('user-1');
      await getCachedPersonalities('user-2');

      expect(mockCallGatewayApi).toHaveBeenCalledTimes(2);
      expect(_getCacheSizeForTesting()).toBe(2);
    });
  });

  describe('getCachedPersonas', () => {
    const mockPersonas: PersonaSummary[] = [
      {
        id: 'persona-1',
        name: 'Default',
        preferredName: 'My Default',
        isDefault: true,
      },
      {
        id: 'persona-2',
        name: 'Work',
        preferredName: null,
        isDefault: false,
      },
    ];

    it('should fetch from gateway on cache miss', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { personas: mockPersonas },
      });

      const result = await getCachedPersonas(testUserId);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/persona', { userId: testUserId });
      expect(result).toEqual(mockPersonas);
    });

    it('should return cached data on cache hit', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { personas: mockPersonas },
      });

      // First call - cache miss
      await getCachedPersonas(testUserId);
      expect(mockCallGatewayApi).toHaveBeenCalledTimes(1);

      // Second call - cache hit
      const result = await getCachedPersonas(testUserId);
      expect(mockCallGatewayApi).toHaveBeenCalledTimes(1); // Still only 1 call
      expect(result).toEqual(mockPersonas);
    });

    /**
     * CRITICAL TEST: Regression test for the empty personas cache hit bug.
     * Previously, users with zero personas were treated as cache miss due to
     * `cached.personas.length > 0` check, causing repeated API calls.
     */
    it('should cache empty persona list (not treat as cache miss)', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { personas: [] },
      });

      // First call - cache miss
      await getCachedPersonas(testUserId);
      expect(mockCallGatewayApi).toHaveBeenCalledTimes(1);

      // Second call - should be cache hit even with empty list
      const result = await getCachedPersonas(testUserId);
      expect(mockCallGatewayApi).toHaveBeenCalledTimes(1); // Still only 1 call!
      expect(result).toEqual([]);
    });

    it('should return empty array on gateway error', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Gateway error',
      });

      const result = await getCachedPersonas(testUserId);

      expect(result).toEqual([]);
    });

    it('should return empty array on exception', async () => {
      mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

      const result = await getCachedPersonas(testUserId);

      expect(result).toEqual([]);
    });
  });

  describe('invalidateUserCache', () => {
    it('should remove user from cache', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { personalities: [{ id: '1', name: 'Test', slug: 'test' }] },
      });

      // Populate cache
      await getCachedPersonalities(testUserId);
      expect(_getCacheSizeForTesting()).toBe(1);

      // Invalidate
      invalidateUserCache(testUserId);
      expect(_getCacheSizeForTesting()).toBe(0);
    });

    it('should cause next fetch to be cache miss', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { personalities: [] },
      });

      // First call - cache miss
      await getCachedPersonalities(testUserId);
      expect(mockCallGatewayApi).toHaveBeenCalledTimes(1);

      // Invalidate
      invalidateUserCache(testUserId);

      // Next call - cache miss again
      await getCachedPersonalities(testUserId);
      expect(mockCallGatewayApi).toHaveBeenCalledTimes(2);
    });
  });

  describe('cache behavior with mixed data', () => {
    it('should preserve personalities when fetching personas', async () => {
      const mockPersonalities: PersonalitySummary[] = [
        {
          id: 'p1',
          name: 'Test',
          displayName: null,
          slug: 'test',
          isPublic: true,
          isOwned: true,
        },
      ];
      const mockPersonas: PersonaSummary[] = [
        { id: 'per1', name: 'Profile', preferredName: null, isDefault: true },
      ];

      // First fetch personalities
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { personalities: mockPersonalities },
      });
      await getCachedPersonalities(testUserId);

      // Then fetch personas (should preserve personalities)
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { personas: mockPersonas },
      });
      await getCachedPersonas(testUserId);

      // Verify both are cached
      mockCallGatewayApi.mockClear();
      const personalities = await getCachedPersonalities(testUserId);
      const personas = await getCachedPersonas(testUserId);

      expect(mockCallGatewayApi).not.toHaveBeenCalled();
      expect(personalities).toEqual(mockPersonalities);
      expect(personas).toEqual(mockPersonas);
    });
  });
});
