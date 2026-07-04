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
import type { PersonalitySummary } from '@tzurot/common-types/schemas/api/personality';
import type { UserClient } from '@tzurot/clients';
import type { PersonaSummary, ShapesSummary } from './autocompleteCache.js';
import { makeOk, makeErr } from '../../test/gatewayClientStubs.js';

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

// One mock per typed-client method, shared across tests. `vi.clearAllMocks()`
// in beforeEach resets call records but the same fn identity is reused — so
// the helper-built stub always points at these and tests can drive responses
// via mockResolvedValue / mockRejectedValue.
const mockListPersonalities = vi.fn();
const mockListPersonas = vi.fn();
const mockListShapes = vi.fn();

function stubUser(userId: string): UserClient {
  return {
    actor: userId,
    listPersonalities: mockListPersonalities,
    listPersonas: mockListPersonas,
    listShapes: mockListShapes,
  } as unknown as UserClient;
}

describe('autocompleteCache', () => {
  const testUserId = 'user-123';
  const testUser = stubUser(testUserId);

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
      mockListPersonalities.mockResolvedValue(makeOk({ personalities: mockPersonalities }));

      const result = await getCachedPersonalities(testUser);

      expect(mockListPersonalities).toHaveBeenCalled();
      expect(result).toEqual({ kind: 'ok', value: mockPersonalities });
    });

    it('should return cached data on cache hit', async () => {
      mockListPersonalities.mockResolvedValue(makeOk({ personalities: mockPersonalities }));

      // First call - cache miss
      await getCachedPersonalities(testUser);
      expect(mockListPersonalities).toHaveBeenCalledTimes(1);

      // Second call - cache hit
      const result = await getCachedPersonalities(testUser);
      expect(mockListPersonalities).toHaveBeenCalledTimes(1); // Still only 1 call
      expect(result).toEqual({ kind: 'ok', value: mockPersonalities });
    });

    it('should cache empty personality list (not treat as cache miss)', async () => {
      mockListPersonalities.mockResolvedValue(makeOk({ personalities: [] }));

      // First call - cache miss
      await getCachedPersonalities(testUser);
      expect(mockListPersonalities).toHaveBeenCalledTimes(1);

      // Second call - should be cache hit even with empty list
      const result = await getCachedPersonalities(testUser);
      expect(mockListPersonalities).toHaveBeenCalledTimes(1); // Still only 1 call
      expect(result).toEqual({ kind: 'ok', value: [] });
    });

    it('should return error on gateway error', async () => {
      mockListPersonalities.mockResolvedValue(makeErr(500, 'Gateway error'));

      const result = await getCachedPersonalities(testUser);

      expect(result).toEqual({ kind: 'error', error: 'Gateway error' });
    });

    it('should return error on exception', async () => {
      mockListPersonalities.mockRejectedValue(new Error('Network error'));

      const result = await getCachedPersonalities(testUser);

      expect(result).toEqual({ kind: 'error', error: 'Unknown error' });
    });

    it('should cache per user', async () => {
      mockListPersonalities.mockResolvedValue(makeOk({ personalities: mockPersonalities }));

      await getCachedPersonalities(stubUser('user-1'));
      await getCachedPersonalities(stubUser('user-2'));

      expect(mockListPersonalities).toHaveBeenCalledTimes(2);
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
      mockListPersonas.mockResolvedValue(makeOk({ personas: mockPersonas }));

      const result = await getCachedPersonas(testUser);

      expect(mockListPersonas).toHaveBeenCalled();
      expect(result).toEqual({ kind: 'ok', value: mockPersonas });
    });

    it('should return cached data on cache hit', async () => {
      mockListPersonas.mockResolvedValue(makeOk({ personas: mockPersonas }));

      // First call - cache miss
      await getCachedPersonas(testUser);
      expect(mockListPersonas).toHaveBeenCalledTimes(1);

      // Second call - cache hit
      const result = await getCachedPersonas(testUser);
      expect(mockListPersonas).toHaveBeenCalledTimes(1); // Still only 1 call
      expect(result).toEqual({ kind: 'ok', value: mockPersonas });
    });

    /**
     * CRITICAL TEST: Regression test for the empty personas cache hit bug.
     * Previously, users with zero personas were treated as cache miss due to
     * `cached.personas.length > 0` check, causing repeated API calls.
     */
    it('should cache empty persona list (not treat as cache miss)', async () => {
      mockListPersonas.mockResolvedValue(makeOk({ personas: [] }));

      // First call - cache miss
      await getCachedPersonas(testUser);
      expect(mockListPersonas).toHaveBeenCalledTimes(1);

      // Second call - should be cache hit even with empty list
      const result = await getCachedPersonas(testUser);
      expect(mockListPersonas).toHaveBeenCalledTimes(1); // Still only 1 call!
      expect(result).toEqual({ kind: 'ok', value: [] });
    });

    it('should return error on gateway error', async () => {
      mockListPersonas.mockResolvedValue(makeErr(500, 'Gateway error'));

      const result = await getCachedPersonas(testUser);

      expect(result).toEqual({ kind: 'error', error: 'Gateway error' });
    });

    it('should return error on exception', async () => {
      mockListPersonas.mockRejectedValue(new Error('Network error'));

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
      mockListShapes.mockResolvedValue(makeOk({ shapes: mockShapes }));

      const result = await getCachedShapes(testUser);

      expect(mockListShapes).toHaveBeenCalled();
      expect(result).toEqual({ kind: 'ok', value: mockShapes });
    });

    it('should return cached data on cache hit', async () => {
      mockListShapes.mockResolvedValue(makeOk({ shapes: mockShapes }));

      await getCachedShapes(testUser);
      expect(mockListShapes).toHaveBeenCalledTimes(1);

      const result = await getCachedShapes(testUser);
      expect(mockListShapes).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ kind: 'ok', value: mockShapes });
    });

    it('should cache empty shapes list (not treat as cache miss)', async () => {
      mockListShapes.mockResolvedValue(makeOk({ shapes: [] }));

      await getCachedShapes(testUser);
      expect(mockListShapes).toHaveBeenCalledTimes(1);

      const result = await getCachedShapes(testUser);
      expect(mockListShapes).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ kind: 'ok', value: [] });
    });

    it('should return error on gateway error', async () => {
      mockListShapes.mockResolvedValue(makeErr(500, 'Gateway error'));

      const result = await getCachedShapes(testUser);

      expect(result).toEqual({ kind: 'error', error: 'Gateway error' });
    });

    it('should return error on exception', async () => {
      mockListShapes.mockRejectedValue(new Error('Network error'));

      const result = await getCachedShapes(testUser);

      expect(result).toEqual({ kind: 'error', error: 'Unknown error' });
    });
  });

  describe('invalidateUserCache', () => {
    it('should remove user from cache', async () => {
      mockListPersonalities.mockResolvedValue(
        makeOk({
          personalities: [
            {
              id: '1',
              name: 'Test',
              displayName: null,
              slug: 'test',
              isPublic: true,
              isOwned: true,
              ownerId: 'owner-1',
              ownerDiscordId: 'discord-123',
              permissions: { canEdit: true, canDelete: true },
            },
          ],
        })
      );

      // Populate cache
      await getCachedPersonalities(testUser);
      expect(_getCacheSizeForTesting()).toBe(1);

      // Invalidate
      invalidateUserCache(testUserId);
      expect(_getCacheSizeForTesting()).toBe(0);
    });

    it('should cause next fetch to be cache miss', async () => {
      mockListPersonalities.mockResolvedValue(makeOk({ personalities: [] }));

      // First call - cache miss
      await getCachedPersonalities(testUser);
      expect(mockListPersonalities).toHaveBeenCalledTimes(1);

      // Invalidate
      invalidateUserCache(testUserId);

      // Next call - cache miss again
      await getCachedPersonalities(testUser);
      expect(mockListPersonalities).toHaveBeenCalledTimes(2);
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

      mockListPersonalities.mockResolvedValue(makeOk({ personalities: mockPersonalities }));
      await getCachedPersonalities(testUser);

      mockListPersonas.mockResolvedValue(makeOk({ personas: mockPersonas }));
      await getCachedPersonas(testUser);

      // Verify both are cached — neither method called again
      mockListPersonalities.mockClear();
      mockListPersonas.mockClear();
      const personalities = await getCachedPersonalities(testUser);
      const personas = await getCachedPersonas(testUser);

      expect(mockListPersonalities).not.toHaveBeenCalled();
      expect(mockListPersonas).not.toHaveBeenCalled();
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

      mockListPersonalities.mockResolvedValue(makeOk({ personalities: mockPersonalities }));
      await getCachedPersonalities(testUser);

      mockListShapes.mockResolvedValue(makeOk({ shapes: mockShapes }));
      await getCachedShapes(testUser);

      mockListPersonalities.mockClear();
      mockListShapes.mockClear();
      const personalities = await getCachedPersonalities(testUser);
      const shapes = await getCachedShapes(testUser);

      expect(mockListPersonalities).not.toHaveBeenCalled();
      expect(mockListShapes).not.toHaveBeenCalled();
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
     *
     * Personas and shapes share the same `fallbackToStale` code path, so
     * exercising `personalities` alone is sufficient coverage.
     */
    async function primeStaleOnly(): Promise<void> {
      mockListPersonalities.mockResolvedValueOnce(makeOk({ personalities: mockPersonalities }));
      await getCachedPersonalities(testUser);
      _clearFreshCacheForTesting();
      expect(_getCacheSizeForTesting()).toBe(0);
      expect(_getStaleCacheSizeForTesting()).toBe(1);
    }

    it('serves stale data on transient error (5xx) after initial success', async () => {
      await primeStaleOnly();

      mockListPersonalities.mockResolvedValueOnce(makeErr(503, 'Backend down'));
      const result = await getCachedPersonalities(testUser);

      expect(result).toEqual({ kind: 'ok', value: mockPersonalities });
    });

    it('does NOT serve stale on permanent error (4xx), returns error instead', async () => {
      await primeStaleOnly();

      mockListPersonalities.mockResolvedValueOnce(makeErr(403, 'Forbidden'));
      const result = await getCachedPersonalities(testUser);

      expect(result).toEqual({ kind: 'error', error: 'Forbidden' });
    });

    /**
     * 429 sits at the 4xx/transient boundary — it's the most likely status
     * to be accidentally regressed if someone changes the transient condition
     * to a naive `status >= 500`. Pinning end-to-end stale-fallback for 429
     * here ensures the boundary survives such refactors.
     */
    it('serves stale data on rate-limit error (429) after initial success', async () => {
      await primeStaleOnly();

      mockListPersonalities.mockResolvedValueOnce(makeErr(429, 'Rate limited'));
      const result = await getCachedPersonalities(testUser);

      expect(result).toEqual({ kind: 'ok', value: mockPersonalities });
    });

    it('returns error on transient error when no stale cache exists', async () => {
      mockListPersonalities.mockResolvedValueOnce(makeErr(503, 'Backend down'));
      const result = await getCachedPersonalities(testUser);

      expect(result).toEqual({ kind: 'error', error: 'Backend down' });
    });

    it('falls back to stale on thrown fetch error (transient-by-default)', async () => {
      await primeStaleOnly();

      mockListPersonalities.mockRejectedValueOnce(new Error('Network meltdown'));
      const result = await getCachedPersonalities(testUser);

      expect(result).toEqual({ kind: 'ok', value: mockPersonalities });
    });

    it('invalidateUserCache clears stale tier too', async () => {
      await primeStaleOnly();

      invalidateUserCache(testUserId);
      expect(_getStaleCacheSizeForTesting()).toBe(0);

      // Stale is gone, so transient error surfaces as error (no fallback)
      mockListPersonalities.mockResolvedValueOnce(makeErr(503, 'Backend down'));
      const result = await getCachedPersonalities(testUser);

      expect(result).toEqual({ kind: 'error', error: 'Backend down' });
    });

    /**
     * Pins the `commitFetchedField` carry-over invariant: when a single field
     * is fetched, the other two fields are carried from stale into the new
     * fresh entry (effectively resetting their TTL). This is intentional —
     * keeps a user's autocomplete bundle cohesive in one tier — but trivially
     * easy to break by removing the `...carryOver` spread in commitFetchedField.
     * Behavioral proof: after the carry-over, reads of the other fields hit
     * fresh and do not trigger a new gateway call.
     */
    it('carries other fields from stale into fresh when one field is fetched', async () => {
      const mockPersonas: PersonaSummary[] = [
        { id: 'persona-1', name: 'Default', preferredName: null, isDefault: true },
      ];
      const mockShapes: ShapesSummary[] = [{ name: 'Shape', username: 'shape' }];

      // 1. Prime personalities + personas into fresh (and stale via commitFetchedField)
      mockListPersonalities.mockResolvedValueOnce(makeOk({ personalities: mockPersonalities }));
      await getCachedPersonalities(testUser);

      mockListPersonas.mockResolvedValueOnce(makeOk({ personas: mockPersonas }));
      await getCachedPersonas(testUser);

      // 2. Demote both to stale-only by clearing fresh
      _clearFreshCacheForTesting();
      expect(_getCacheSizeForTesting()).toBe(0);
      expect(_getStaleCacheSizeForTesting()).toBe(1);

      // 3. Fetch shapes — carry-over should pull personalities + personas into fresh
      mockListShapes.mockResolvedValueOnce(makeOk({ shapes: mockShapes }));
      await getCachedShapes(testUser);

      // 4. Behavioral proof: subsequent reads of the carried-over fields
      //    must not trigger a gateway call (they're now in fresh).
      mockListPersonalities.mockClear();
      mockListPersonas.mockClear();

      const personalitiesResult = await getCachedPersonalities(testUser);
      const personasResult = await getCachedPersonas(testUser);

      expect(personalitiesResult).toEqual({ kind: 'ok', value: mockPersonalities });
      expect(personasResult).toEqual({ kind: 'ok', value: mockPersonas });
      expect(mockListPersonalities).not.toHaveBeenCalled();
      expect(mockListPersonas).not.toHaveBeenCalled();
    });
  });
});
