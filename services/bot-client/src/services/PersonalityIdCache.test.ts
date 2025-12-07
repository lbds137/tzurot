/**
 * PersonalityIdCache Unit Tests
 *
 * Tests the caching wrapper around PersonalityService that:
 * 1. Caches name→ID mappings with TTL
 * 2. Passes userId through for access control (critical bug fix)
 * 3. Handles cache expiry correctly
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PersonalityIdCache } from './PersonalityIdCache.js';
import type { PersonalityService, LoadedPersonality } from '@tzurot/common-types';

// Mock common-types logger
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

describe('PersonalityIdCache', () => {
  let mockPersonalityService: PersonalityService;
  let cache: PersonalityIdCache;

  const createMockPersonality = (overrides: Partial<LoadedPersonality> = {}): LoadedPersonality =>
    ({
      id: '00000000-0000-0000-0000-000000000001',
      name: 'TestBot',
      displayName: 'Test Bot',
      slug: 'test-bot',
      systemPrompt: 'Test prompt',
      isPublic: true,
      ownerId: null,
      model: 'test-model',
      ...overrides,
    }) as LoadedPersonality;

  beforeEach(() => {
    vi.useFakeTimers();

    mockPersonalityService = {
      loadPersonality: vi.fn(),
    } as unknown as PersonalityService;

    cache = new PersonalityIdCache(mockPersonalityService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('loadPersonality', () => {
    describe('UUID lookup', () => {
      it('should pass userId to PersonalityService when loading by UUID', async () => {
        const mockPersonality = createMockPersonality();
        vi.mocked(mockPersonalityService.loadPersonality).mockResolvedValue(mockPersonality);

        await cache.loadPersonality('00000000-0000-0000-0000-000000000001', 'user-123');

        expect(mockPersonalityService.loadPersonality).toHaveBeenCalledWith(
          '00000000-0000-0000-0000-000000000001',
          'user-123'
        );
      });

      it('should load directly without caching when input is UUID', async () => {
        const mockPersonality = createMockPersonality();
        vi.mocked(mockPersonalityService.loadPersonality).mockResolvedValue(mockPersonality);

        const uuid = '00000000-0000-0000-0000-000000000001';
        await cache.loadPersonality(uuid);
        await cache.loadPersonality(uuid);

        // Should call service twice (no caching for UUID)
        expect(mockPersonalityService.loadPersonality).toHaveBeenCalledTimes(2);
      });
    });

    describe('name lookup with userId passthrough', () => {
      it('should pass userId on first load (cache miss)', async () => {
        const mockPersonality = createMockPersonality({ name: 'TestBot', slug: 'test-bot' });
        vi.mocked(mockPersonalityService.loadPersonality).mockResolvedValue(mockPersonality);

        await cache.loadPersonality('testbot', 'user-456');

        expect(mockPersonalityService.loadPersonality).toHaveBeenCalledWith('testbot', 'user-456');
      });

      it('should pass userId when using cached ID', async () => {
        const mockPersonality = createMockPersonality({
          id: 'cached-id',
          name: 'TestBot',
          slug: 'test-bot',
        });
        vi.mocked(mockPersonalityService.loadPersonality).mockResolvedValue(mockPersonality);

        // First load caches the ID
        await cache.loadPersonality('testbot', 'user-111');

        // Second load uses cached ID but MUST still pass userId
        await cache.loadPersonality('testbot', 'user-222');

        expect(mockPersonalityService.loadPersonality).toHaveBeenNthCalledWith(1, 'testbot', 'user-111');
        expect(mockPersonalityService.loadPersonality).toHaveBeenNthCalledWith(2, 'cached-id', 'user-222');
      });

      it('should pass userId when using slug cache', async () => {
        const mockPersonality = createMockPersonality({
          id: 'slug-cached-id',
          name: 'TestBot',
          slug: 'my-slug',
        });
        vi.mocked(mockPersonalityService.loadPersonality).mockResolvedValue(mockPersonality);

        // First load by name caches both name and slug
        await cache.loadPersonality('testbot', 'user-aaa');

        // Second load by slug uses cached ID with new userId
        await cache.loadPersonality('my-slug', 'user-bbb');

        expect(mockPersonalityService.loadPersonality).toHaveBeenNthCalledWith(1, 'testbot', 'user-aaa');
        expect(mockPersonalityService.loadPersonality).toHaveBeenNthCalledWith(
          2,
          'slug-cached-id',
          'user-bbb'
        );
      });
    });

    describe('cache behavior', () => {
      it('should cache name→ID mapping after first load', async () => {
        const mockPersonality = createMockPersonality({ id: 'my-id', name: 'TestBot', slug: 'test-bot' });
        vi.mocked(mockPersonalityService.loadPersonality).mockResolvedValue(mockPersonality);

        // First load - fetches by name
        await cache.loadPersonality('testbot');

        // Second load - should use cached ID
        await cache.loadPersonality('testbot');

        // First call: 'testbot' (by name)
        // Second call: 'my-id' (by cached ID)
        expect(mockPersonalityService.loadPersonality).toHaveBeenNthCalledWith(1, 'testbot', undefined);
        expect(mockPersonalityService.loadPersonality).toHaveBeenNthCalledWith(2, 'my-id', undefined);
      });

      it('should expire cache after TTL', async () => {
        const mockPersonality = createMockPersonality({ id: 'my-id', name: 'TestBot', slug: 'test-bot' });
        vi.mocked(mockPersonalityService.loadPersonality).mockResolvedValue(mockPersonality);

        // First load
        await cache.loadPersonality('testbot');

        // Advance time past TTL (5 minutes)
        vi.advanceTimersByTime(6 * 60 * 1000);

        // Third load - cache expired, should fetch by name again
        await cache.loadPersonality('testbot');

        // Both calls should be by name (not cached ID)
        expect(mockPersonalityService.loadPersonality).toHaveBeenNthCalledWith(1, 'testbot', undefined);
        expect(mockPersonalityService.loadPersonality).toHaveBeenNthCalledWith(2, 'testbot', undefined);
      });

      it('should not cache when personality not found', async () => {
        vi.mocked(mockPersonalityService.loadPersonality).mockResolvedValue(null);

        await cache.loadPersonality('nonexistent');
        await cache.loadPersonality('nonexistent');

        // Should call service twice (nothing cached)
        expect(mockPersonalityService.loadPersonality).toHaveBeenCalledTimes(2);
        expect(mockPersonalityService.loadPersonality).toHaveBeenNthCalledWith(
          1,
          'nonexistent',
          undefined
        );
        expect(mockPersonalityService.loadPersonality).toHaveBeenNthCalledWith(
          2,
          'nonexistent',
          undefined
        );
      });
    });

    describe('clearCache', () => {
      it('should clear all cached mappings', async () => {
        const mockPersonality = createMockPersonality({ id: 'my-id', name: 'TestBot', slug: 'test-bot' });
        vi.mocked(mockPersonalityService.loadPersonality).mockResolvedValue(mockPersonality);

        // First load caches
        await cache.loadPersonality('testbot');

        // Clear cache
        cache.clearCache();

        // Next load should fetch by name again
        await cache.loadPersonality('testbot');

        expect(mockPersonalityService.loadPersonality).toHaveBeenNthCalledWith(1, 'testbot', undefined);
        expect(mockPersonalityService.loadPersonality).toHaveBeenNthCalledWith(2, 'testbot', undefined);
      });
    });
  });
});
