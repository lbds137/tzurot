/**
 * Tests for Autocomplete Data Cache
 * Validates caching behavior for personality and persona lists.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getCachedPersonalities,
  getCachedPersonas,
  getCachedShapes,
  invalidateUserCache,
  _clearCacheForTesting,
  _clearFreshCacheForTesting,
  _getCacheSizeForTesting,
  _getStaleCacheSizeForTesting,
} from './autocompleteCache.js';
import type { PersonalitySummary } from '@tzurot/common-types';
import type { PersonaSummary, ShapesSummary } from './autocompleteCache.js';

// Mock the gateway client
const mockCallGatewayApi = vi.fn();
vi.mock('../userGatewayClient.js', async () => {
  const actual =
    await vi.importActual<typeof import('../userGatewayClient.js')>('../userGatewayClient.js');
  return {
    ...actual,
    callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
  };
});

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
  const testUser = {
    discordId: 'user-123',
    username: 'testuser',
    displayName: 'testuser',
  } as const;

  function mkUser(id: string) {
    return { discordId: id, username: 'testuser', displayName: 'testuser' } as const;
  }

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
        ownerId: 'owner-1',
        ownerDiscordId: 'discord-123',
        permissions: { canEdit: true, canDelete: true },
      },
      {
        id: 'personality-2',
        name: 'Default',
        displayName: null,
        slug: 'default',
        isPublic: true,
        isOwned: true,
        ownerId: 'owner-1',
        ownerDiscordId: 'discord-123',
        permissions: { canEdit: true, canDelete: true },
      },
    ];

    it('should fetch from gateway on cache miss', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { personalities: mockPersonalities },
      });

      const result = await getCachedPersonalities(testUser);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/personality', { user: testUser });
      expect(result).toEqual({ kind: 'ok', value: mockPersonalities });
    });

    it('should return cached data on cache hit', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { personalities: mockPersonalities },
      });

      // First call - cache miss
      await getCachedPersonalities(testUser);
      expect(mockCallGatewayApi).toHaveBeenCalledTimes(1);

      // Second call - cache hit
      const result = await getCachedPersonalities(testUser);
      expect(mockCallGatewayApi).toHaveBeenCalledTimes(1); // Still only 1 call
      expect(result).toEqual({ kind: 'ok', value: mockPersonalities });
    });

    it('should cache empty personality list (not treat as cache miss)', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { personalities: [] },
      });

      // First call - cache miss
      await getCachedPersonalities(testUser);
      expect(mockCallGatewayApi).toHaveBeenCalledTimes(1);

      // Second call - should be cache hit even with empty list
      const result = await getCachedPersonalities(testUser);
      expect(mockCallGatewayApi).toHaveBeenCalledTimes(1); // Still only 1 call
      expect(result).toEqual({ kind: 'ok', value: [] });
    });

    it('should return error on gateway error', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Gateway error',
        status: 500,
      });

      const result = await getCachedPersonalities(testUser);

      expect(result).toEqual({ kind: 'error', error: 'Gateway error' });
    });

    it('should return error on exception', async () => {
      mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

      const result = await getCachedPersonalities(testUser);

      expect(result).toEqual({ kind: 'error', error: 'Unknown error' });
    });

    it('should cache per user', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { personalities: mockPersonalities },
      });

      await getCachedPersonalities(mkUser('user-1'));
      await getCachedPersonalities(mkUser('user-2'));

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

      const result = await getCachedPersonas(testUser);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/persona', { user: testUser });
      expect(result).toEqual({ kind: 'ok', value: mockPersonas });
    });

    it('should return cached data on cache hit', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { personas: mockPersonas },
      });

      // First call - cache miss
      await getCachedPersonas(testUser);
      expect(mockCallGatewayApi).toHaveBeenCalledTimes(1);

      // Second call - cache hit
      const result = await getCachedPersonas(testUser);
      expect(mockCallGatewayApi).toHaveBeenCalledTimes(1); // Still only 1 call
      expect(result).toEqual({ kind: 'ok', value: mockPersonas });
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
      await getCachedPersonas(testUser);
      expect(mockCallGatewayApi).toHaveBeenCalledTimes(1);

      // Second call - should be cache hit even with empty list
      const result = await getCachedPersonas(testUser);
      expect(mockCallGatewayApi).toHaveBeenCalledTimes(1); // Still only 1 call!
      expect(result).toEqual({ kind: 'ok', value: [] });
    });

    it('should return error on gateway error', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Gateway error',
        status: 500,
      });

      const result = await getCachedPersonas(testUser);

      expect(result).toEqual({ kind: 'error', error: 'Gateway error' });
    });

    it('should return error on exception', async () => {
      mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

      const result = await getCachedPersonas(testUser);

      expect(result).toEqual({ kind: 'error', error: 'Unknown error' });
    });
  });

  describe('getCachedShapes', () => {
    const mockShapes: ShapesSummary[] = [
      { name: 'My Shape', username: 'my-shape' },
      { name: 'Other Shape', username: 'other-shape' },
    ];

    it('should fetch from gateway on cache miss', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { shapes: mockShapes },
      });

      const result = await getCachedShapes(testUser);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/shapes/list', {
        user: testUser,
      });
      expect(result).toEqual({ kind: 'ok', value: mockShapes });
    });

    it('should return cached data on cache hit', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { shapes: mockShapes },
      });

      await getCachedShapes(testUser);
      expect(mockCallGatewayApi).toHaveBeenCalledTimes(1);

      const result = await getCachedShapes(testUser);
      expect(mockCallGatewayApi).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ kind: 'ok', value: mockShapes });
    });

    it('should cache empty shapes list (not treat as cache miss)', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { shapes: [] },
      });

      await getCachedShapes(testUser);
      expect(mockCallGatewayApi).toHaveBeenCalledTimes(1);

      const result = await getCachedShapes(testUser);
      expect(mockCallGatewayApi).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ kind: 'ok', value: [] });
    });

    it('should return error on gateway error', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Gateway error',
        status: 500,
      });

      const result = await getCachedShapes(testUser);

      expect(result).toEqual({ kind: 'error', error: 'Gateway error' });
    });

    it('should return error on exception', async () => {
      mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

      const result = await getCachedShapes(testUser);

      expect(result).toEqual({ kind: 'error', error: 'Unknown error' });
    });
  });

  describe('invalidateUserCache', () => {
    it('should remove user from cache', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { personalities: [{ id: '1', name: 'Test', slug: 'test' }] },
      });

      // Populate cache
      await getCachedPersonalities(testUser);
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
      await getCachedPersonalities(testUser);
      expect(mockCallGatewayApi).toHaveBeenCalledTimes(1);

      // Invalidate
      invalidateUserCache(testUserId);

      // Next call - cache miss again
      await getCachedPersonalities(testUser);
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
          ownerId: 'owner-1',
          ownerDiscordId: 'discord-123',
          permissions: { canEdit: true, canDelete: true },
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
      await getCachedPersonalities(testUser);

      // Then fetch personas (should preserve personalities)
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { personas: mockPersonas },
      });
      await getCachedPersonas(testUser);

      // Verify both are cached
      mockCallGatewayApi.mockClear();
      const personalities = await getCachedPersonalities(testUser);
      const personas = await getCachedPersonas(testUser);

      expect(mockCallGatewayApi).not.toHaveBeenCalled();
      expect(personalities).toEqual({ kind: 'ok', value: mockPersonalities });
      expect(personas).toEqual({ kind: 'ok', value: mockPersonas });
    });

    it('should preserve personalities and personas when fetching shapes', async () => {
      const mockPersonalities: PersonalitySummary[] = [
        {
          id: 'p1',
          name: 'Test',
          displayName: null,
          slug: 'test',
          isPublic: true,
          isOwned: true,
          ownerId: 'owner-1',
          ownerDiscordId: 'discord-123',
          permissions: { canEdit: true, canDelete: true },
        },
      ];
      const mockShapes: ShapesSummary[] = [{ name: 'Shape', username: 'shape' }];

      // Fetch personalities first
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { personalities: mockPersonalities },
      });
      await getCachedPersonalities(testUser);

      // Then fetch shapes (should preserve personalities)
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { shapes: mockShapes },
      });
      await getCachedShapes(testUser);

      // Verify both are cached
      mockCallGatewayApi.mockClear();
      const personalities = await getCachedPersonalities(testUser);
      const shapes = await getCachedShapes(testUser);

      expect(mockCallGatewayApi).not.toHaveBeenCalled();
      expect(personalities).toEqual({ kind: 'ok', value: mockPersonalities });
      expect(shapes).toEqual({ kind: 'ok', value: mockShapes });
    });
  });

  describe('stale cache fallback', () => {
    const mockPersonalities: PersonalitySummary[] = [
      {
        id: 'personality-1',
        name: 'Lilith',
        displayName: 'Lilith the Succubus',
        slug: 'lilith',
        isPublic: true,
        isOwned: true,
        ownerId: 'owner-1',
        ownerDiscordId: 'discord-123',
        permissions: { canEdit: true, canDelete: true },
      },
    ];

    /**
     * Helper: populate both fresh and stale with a successful fetch, then
     * clear only the fresh tier so the next call exercises the fetch/fallback
     * path with stale still primed.
     *
     * We use this instead of `vi.advanceTimersByTime(CACHE_TTL_MS + 1)`
     * because TTLCache relies on lru-cache's module-cached `performance.now`,
     * which doesn't respond to vitest fake timers without extra wiring.
     * Clearing fresh directly is functionally equivalent and simpler.
     */
    async function primeStaleOnly(): Promise<void> {
      mockCallGatewayApi.mockResolvedValueOnce({
        ok: true,
        data: { personalities: mockPersonalities },
      });
      await getCachedPersonalities(testUser);
      _clearFreshCacheForTesting();
      expect(_getCacheSizeForTesting()).toBe(0);
      expect(_getStaleCacheSizeForTesting()).toBe(1);
    }

    it('serves stale data on transient error (5xx) after initial success', async () => {
      await primeStaleOnly();

      mockCallGatewayApi.mockResolvedValueOnce({
        ok: false,
        error: 'Backend down',
        status: 503,
      });
      const result = await getCachedPersonalities(testUser);

      expect(result).toEqual({ kind: 'ok', value: mockPersonalities });
    });

    it('does NOT serve stale on permanent error (4xx), returns error instead', async () => {
      await primeStaleOnly();

      mockCallGatewayApi.mockResolvedValueOnce({
        ok: false,
        error: 'Forbidden',
        status: 403,
      });
      const result = await getCachedPersonalities(testUser);

      expect(result).toEqual({ kind: 'error', error: 'Forbidden' });
    });

    it('returns error on transient error when no stale cache exists', async () => {
      mockCallGatewayApi.mockResolvedValueOnce({
        ok: false,
        error: 'Backend down',
        status: 503,
      });
      const result = await getCachedPersonalities(testUser);

      expect(result).toEqual({ kind: 'error', error: 'Backend down' });
    });

    it('falls back to stale on thrown fetch error (transient-by-default)', async () => {
      await primeStaleOnly();

      mockCallGatewayApi.mockRejectedValueOnce(new Error('Network meltdown'));
      const result = await getCachedPersonalities(testUser);

      expect(result).toEqual({ kind: 'ok', value: mockPersonalities });
    });

    it('invalidateUserCache clears stale tier too', async () => {
      await primeStaleOnly();

      invalidateUserCache(testUserId);
      expect(_getStaleCacheSizeForTesting()).toBe(0);

      // Stale is gone, so transient error surfaces as error (no fallback)
      mockCallGatewayApi.mockResolvedValueOnce({
        ok: false,
        error: 'Backend down',
        status: 503,
      });
      const result = await getCachedPersonalities(testUser);

      expect(result).toEqual({ kind: 'error', error: 'Backend down' });
    });
  });
});
