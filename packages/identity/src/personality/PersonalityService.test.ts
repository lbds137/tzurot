/**
 * PersonalityService Unit Tests
 * Tests cache invalidation methods
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PersonalityService } from './PersonalityService.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';

const GLOBAL_SENTINEL_MODEL = 'sentinel-global-default-model';

const makeDbPersonality = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Fixture',
  displayName: null,
  slug: 'fixture',
  isPublic: true,
  ownerId: null,
  createdAt: new Date('2020-01-01T00:00:00Z'),
  updatedAt: new Date('2020-01-01T00:00:00Z'),
  characterInfo: 'char',
  personalityTraits: 'traits',
  personalityTone: null,
  personalityAge: null,
  personalityAppearance: null,
  personalityLikes: null,
  personalityDislikes: null,
  conversationalGoals: null,
  conversationalExamples: null,
  errorMessage: null,
  voiceEnabled: false,
  systemPrompt: { content: 'prompt' },
  defaultConfigLink: null,
  ...overrides,
});

const linkedLlmConfig = (model: string): Record<string, unknown> => ({
  llmConfig: {
    model,
    provider: 'openrouter',
    advancedParameters: {},
    contextWindowTokens: 4096,
  },
});

describe('PersonalityService - Cache Invalidation', () => {
  let mockPrisma: PrismaClient;
  let service: PersonalityService;

  // Reads mockPrisma at call time, so it lives here rather than at file scope:
  // beforeEach rebuilds the client, and a file-scope copy would capture nothing.
  const mockGlobalDefault = (): void => {
    vi.mocked(mockPrisma.adminSettings.findUnique).mockResolvedValue({
      globalDefaultLlmConfig: {
        model: GLOBAL_SENTINEL_MODEL,
        provider: 'sentinel-provider',
        advancedParameters: {},
        contextWindowTokens: 111111,
      },
    } as any);
  };

  beforeEach(() => {
    // Mock Prisma client
    mockPrisma = {
      personality: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      personalityAlias: {
        findFirst: vi.fn(),
      },
      llmConfig: {
        findFirst: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
      },
      adminSettings: {
        findUnique: vi.fn(),
      },
    } as unknown as PrismaClient;

    service = new PersonalityService(mockPrisma);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('invalidatePersonality', () => {
    it('should invalidate specific personality from cache', async () => {
      // Setup: Load a personality to cache it
      const mockPersonality = {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'TestPersonality',
        displayName: 'Test Personality',
        slug: 'test',
        systemPrompt: { content: 'Test prompt' },
        defaultConfigLink: {
          llmConfig: {
            model: 'test-model',
            provider: 'openrouter',
            temperature: 0.7,
            topP: null,
            topK: null,
            frequencyPenalty: null,
            presencePenalty: null,
            maxTokens: 1000,
            contextWindowTokens: 4096,
          },
        },
        characterInfo: 'Test character',
        personalityTraits: 'Test traits',
        personalityTone: null,
        personalityAge: null,
        personalityAppearance: null,
        personalityLikes: null,
        personalityDislikes: null,
        conversationalGoals: null,
        conversationalExamples: null,
      };

      vi.mocked(mockPrisma.personality.findFirst).mockResolvedValue(mockPersonality as any);

      // Load personality by ID (should cache it by ID)
      const loaded1 = await service.loadPersonality('00000000-0000-0000-0000-000000000001');
      expect(loaded1).not.toBeNull();
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(1);

      // Load again by ID (should come from cache, no DB call)
      const loaded2 = await service.loadPersonality('00000000-0000-0000-0000-000000000001');
      expect(loaded2).not.toBeNull();
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(1); // Still 1

      // Invalidate the cache by ID
      service.invalidatePersonality('00000000-0000-0000-0000-000000000001');

      // Load again by ID (should hit DB again since cache was invalidated)
      const loaded3 = await service.loadPersonality('00000000-0000-0000-0000-000000000001');
      expect(loaded3).not.toBeNull();
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(2); // Now 2
    });

    it('should handle invalidating non-existent cache entries gracefully', () => {
      // Should not throw error
      expect(() => {
        service.invalidatePersonality('non-existent');
      }).not.toThrow();
    });

    it('should cache by ID and invalidate by ID', async () => {
      // Setup: Mock personality with id, name, and slug
      const mockPersonality = {
        id: 'c0b36b1b-0c5b-59ac-a6e2-5d50d0e2036a',
        name: 'COLD',
        displayName: 'Cold',
        slug: 'cold',
        systemPrompt: { content: 'Test prompt' },
        defaultConfigLink: {
          llmConfig: {
            model: 'test-model',
            provider: 'openrouter',
            temperature: 0.7,
            topP: null,
            topK: null,
            frequencyPenalty: null,
            presencePenalty: null,
            maxTokens: 1000,
            contextWindowTokens: 4096,
          },
        },
        characterInfo: 'Test character',
        personalityTraits: 'Test traits',
        personalityTone: null,
        personalityAge: null,
        personalityAppearance: null,
        personalityLikes: null,
        personalityDislikes: null,
        conversationalGoals: null,
        conversationalExamples: null,
      };

      vi.mocked(mockPrisma.personality.findFirst).mockResolvedValue(mockPersonality as any);

      // Load personality by ID (should cache by ID only)
      await service.loadPersonality('c0b36b1b-0c5b-59ac-a6e2-5d50d0e2036a');
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(1);

      // Load by ID again - should hit cache
      await service.loadPersonality('c0b36b1b-0c5b-59ac-a6e2-5d50d0e2036a');
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(1); // Still 1 (cache hit)

      // Invalidate by ID (this is what cache invalidation events use)
      service.invalidatePersonality('c0b36b1b-0c5b-59ac-a6e2-5d50d0e2036a');

      // Load by ID again - should hit DB (cache was invalidated)
      await service.loadPersonality('c0b36b1b-0c5b-59ac-a6e2-5d50d0e2036a');
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(2); // Now 2 (cache miss)
    });
  });

  describe('invalidateAll', () => {
    it('should clear entire cache', async () => {
      // Setup: Load multiple personalities
      const mockPersonality1 = {
        id: '00000000-0000-0000-0000-000000000011',
        name: 'TestPersonality1',
        displayName: 'Test 1',
        slug: 'test1',
        systemPrompt: { content: 'Test 1' },
        defaultConfigLink: {
          llmConfig: {
            model: 'test-model',
            provider: 'openrouter',
            temperature: 0.7,
            topP: null,
            topK: null,
            frequencyPenalty: null,
            presencePenalty: null,
            maxTokens: 1000,
            contextWindowTokens: 4096,
          },
        },
        characterInfo: 'Test 1',
        personalityTraits: 'Traits 1',
        personalityTone: null,
        personalityAge: null,
        personalityAppearance: null,
        personalityLikes: null,
        personalityDislikes: null,
        conversationalGoals: null,
        conversationalExamples: null,
      };

      const mockPersonality2 = {
        ...mockPersonality1,
        id: '00000000-0000-0000-0000-000000000022',
        name: 'TestPersonality2',
        displayName: 'Test 2',
        slug: 'test2',
      };

      vi.mocked(mockPrisma.personality.findFirst)
        .mockResolvedValueOnce(mockPersonality1 as any)
        .mockResolvedValueOnce(mockPersonality2 as any)
        .mockResolvedValueOnce(mockPersonality1 as any)
        .mockResolvedValueOnce(mockPersonality2 as any);

      // Load two personalities by ID (cache them)
      await service.loadPersonality('00000000-0000-0000-0000-000000000011');
      await service.loadPersonality('00000000-0000-0000-0000-000000000022');
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(2);

      // Verify cache hit by loading by ID again
      await service.loadPersonality('00000000-0000-0000-0000-000000000011');
      await service.loadPersonality('00000000-0000-0000-0000-000000000022');
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(2); // Still 2

      // Invalidate entire cache
      service.invalidateAll();

      // Load both again by ID (should hit DB since cache was cleared)
      await service.loadPersonality('00000000-0000-0000-0000-000000000011');
      await service.loadPersonality('00000000-0000-0000-0000-000000000022');
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(4); // Now 4
    });

    it('should handle empty cache gracefully', () => {
      // Should not throw error
      expect(() => {
        service.invalidateAll();
      }).not.toThrow();
    });
  });

  describe('cache and access control', () => {
    const mockPersonality = {
      id: '00000000-0000-0000-0000-000000000099',
      name: 'PrivatePersonality',
      displayName: 'Private',
      slug: 'private',
      isPublic: false,
      ownerId: 'owner-user-123',
      systemPrompt: { content: 'Test prompt' },
      defaultConfigLink: {
        llmConfig: {
          model: 'test-model',
          provider: 'openrouter',
          temperature: 0.7,
          topP: null,
          topK: null,
          frequencyPenalty: null,
          presencePenalty: null,
          maxTokens: 1000,
          contextWindowTokens: 4096,
        },
      },
      characterInfo: 'Private character',
      personalityTraits: 'Test traits',
      personalityTone: null,
      personalityAge: null,
      personalityAppearance: null,
      personalityLikes: null,
      personalityDislikes: null,
      conversationalGoals: null,
      conversationalExamples: null,
    };

    it('should use cache when userId is not provided (internal operations)', async () => {
      vi.mocked(mockPrisma.personality.findFirst).mockResolvedValue(mockPersonality as any);

      // First load - should hit DB
      const loaded1 = await service.loadPersonality('00000000-0000-0000-0000-000000000099');
      expect(loaded1).not.toBeNull();
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(1);

      // Second load without userId - should hit cache (no additional DB call)
      const loaded2 = await service.loadPersonality('00000000-0000-0000-0000-000000000099');
      expect(loaded2).not.toBeNull();
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(1); // Still 1
    });

    it('should bypass cache when userId is provided (enforces access control)', async () => {
      vi.mocked(mockPrisma.personality.findFirst).mockResolvedValue(mockPersonality as any);
      // Mock user lookups
      vi.mocked(mockPrisma.user.findUnique).mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000123',
      } as any);

      // First load without userId - should hit DB and cache result
      const loaded1 = await service.loadPersonality('00000000-0000-0000-0000-000000000099');
      expect(loaded1).not.toBeNull();
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(1);

      // Second load WITH userId - should bypass cache and hit DB again
      const loaded2 = await service.loadPersonality(
        '00000000-0000-0000-0000-000000000099',
        'some-user-123'
      );
      expect(loaded2).not.toBeNull();
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(2); // Now 2

      // Third load WITH different userId - should bypass cache again
      const loaded3 = await service.loadPersonality(
        '00000000-0000-0000-0000-000000000099',
        'another-user-456'
      );
      expect(loaded3).not.toBeNull();
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(3); // Now 3
    });

    it('should bypass cache when userId is empty string', async () => {
      vi.mocked(mockPrisma.personality.findFirst).mockResolvedValue(mockPersonality as any);

      // Load without userId - should hit DB and cache result
      const loaded1 = await service.loadPersonality('00000000-0000-0000-0000-000000000099');
      expect(loaded1).not.toBeNull();
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(1);

      // Load with empty string userId - should use cache (empty string = no access control)
      const loaded2 = await service.loadPersonality('00000000-0000-0000-0000-000000000099', '');
      expect(loaded2).not.toBeNull();
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(1); // Still 1
    });

    it('should always bypass cache for name lookups (non-UUID)', async () => {
      // Non-UUID lookups use findMany for combined name/slug query
      vi.mocked(mockPrisma.personality.findMany).mockResolvedValue([mockPersonality] as any);

      // Load by name - should hit DB
      const loaded1 = await service.loadPersonality('PrivatePersonality');
      expect(loaded1).not.toBeNull();
      expect(vi.mocked(mockPrisma.personality.findMany)).toHaveBeenCalledTimes(1);

      // Cache is now populated by ID, but loading by name should still hit DB
      // because we only cache by ID and name lookups always go to DB
      const loaded2 = await service.loadPersonality('PrivatePersonality');
      expect(loaded2).not.toBeNull();
      expect(vi.mocked(mockPrisma.personality.findMany)).toHaveBeenCalledTimes(2); // Now 2
    });

    it('should return null when access control denies access', async () => {
      // Mock user lookup
      vi.mocked(mockPrisma.user.findUnique).mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000999',
      } as any);
      // Mock DB returning null (personality exists but user lacks access)
      vi.mocked(mockPrisma.personality.findFirst).mockResolvedValue(null);
      vi.mocked(mockPrisma.personality.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValue(null);

      // Load with userId - DB returns null due to access control
      const loaded = await service.loadPersonality(
        '00000000-0000-0000-0000-000000000099',
        'unauthorized-user'
      );

      expect(loaded).toBeNull();
      // Verify DB was queried - prioritized lookup tries UUID, then combined name/slug
      // The input is a UUID so it tries: UUID lookup (findFirst) → combined name/slug (findMany)
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(mockPrisma.personality.findMany)).toHaveBeenCalledTimes(1);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', async () => {
      const stats = service.getCacheStats();

      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('maxSize');
      expect(stats).toHaveProperty('ttl');
      expect(typeof stats.size).toBe('number');
      expect(typeof stats.maxSize).toBe('number');
      expect(typeof stats.ttl).toBe('number');
    });

    it('should reflect cache size changes', async () => {
      const mockPersonality = {
        id: 'test-id',
        name: 'TestPersonality',
        displayName: 'Test',
        slug: 'test',
        isPublic: true,
        ownerId: null,
        updatedAt: new Date(),
        systemPrompt: { content: 'Test' },
        defaultConfigLink: {
          llmConfig: {
            model: 'test-model',
            provider: 'openrouter',
            temperature: 0.7,
            topP: null,
            topK: null,
            frequencyPenalty: null,
            presencePenalty: null,
            maxTokens: 1000,
            contextWindowTokens: 4096,
          },
        },
        characterInfo: 'Test',
        personalityTraits: 'Test',
        personalityTone: null,
        personalityAge: null,
        personalityAppearance: null,
        personalityLikes: null,
        personalityDislikes: null,
        conversationalGoals: null,
        conversationalExamples: null,
        errorMessage: null,
      };

      // Non-UUID lookups use findMany for combined name/slug query
      vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([mockPersonality] as any);

      // Initially empty
      let stats = service.getCacheStats();
      expect(stats.size).toBe(0);

      // Load a personality by name (uses findMany)
      await service.loadPersonality('test');

      // Cache should have 1 entry (by ID only)
      stats = service.getCacheStats();
      expect(stats.size).toBe(1);

      // Clear cache
      service.invalidateAll();

      // Cache should be empty again
      stats = service.getCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  describe('UUID regex anchoring', () => {
    it('never consults cache for a UUID with trailing junk (anchored $)', async () => {
      const id = '00000000-0000-0000-0000-000000000101xx';
      const personality = makeDbPersonality({
        id,
        name: id,
        slug: 'a1',
        defaultConfigLink: linkedLlmConfig('a1-model'),
      });
      vi.mocked(mockPrisma.personality.findFirst).mockResolvedValue(personality as any);
      vi.mocked(mockPrisma.personality.findMany).mockResolvedValue([personality] as any);

      const loaded1 = await service.loadPersonality(id);
      const loaded2 = await service.loadPersonality(id);

      expect(loaded1).not.toBeNull();
      expect(loaded1?.id).toBe(id);
      expect(loaded2).not.toBeNull();
      expect(loaded2?.id).toBe(id);

      const findFirstCalls = vi.mocked(mockPrisma.personality.findFirst).mock.calls.length;
      const findManyCalls = vi.mocked(mockPrisma.personality.findMany).mock.calls.length;
      expect(findFirstCalls + findManyCalls).toBe(2);
    });

    it('never consults cache for a UUID with leading junk (anchored ^)', async () => {
      const id = 'xx00000000-0000-0000-0000-000000000102';
      const personality = makeDbPersonality({
        id,
        name: id,
        slug: 'a2',
        defaultConfigLink: linkedLlmConfig('a2-model'),
      });
      vi.mocked(mockPrisma.personality.findFirst).mockResolvedValue(personality as any);
      vi.mocked(mockPrisma.personality.findMany).mockResolvedValue([personality] as any);

      const loaded1 = await service.loadPersonality(id);
      const loaded2 = await service.loadPersonality(id);

      expect(loaded1).not.toBeNull();
      expect(loaded1?.id).toBe(id);
      expect(loaded2).not.toBeNull();
      expect(loaded2?.id).toBe(id);

      const findFirstCalls = vi.mocked(mockPrisma.personality.findFirst).mock.calls.length;
      const findManyCalls = vi.mocked(mockPrisma.personality.findMany).mock.calls.length;
      expect(findFirstCalls + findManyCalls).toBe(2);
    });
  });

  describe('global default config fallback', () => {
    it('loads the global default config when the personality has no defaultConfigLink', async () => {
      mockGlobalDefault();
      const id = '00000000-0000-0000-0000-000000000201';
      const personality = makeDbPersonality({
        id,
        name: 'NoLink',
        slug: 'nolink',
        defaultConfigLink: null,
      });
      vi.mocked(mockPrisma.personality.findFirst).mockResolvedValue(personality as any);

      const loaded = await service.loadPersonality(id);

      expect(vi.mocked(mockPrisma.adminSettings.findUnique)).toHaveBeenCalledTimes(1);
      // Pin WHICH row the fallback reads, not just that it read one: the global
      // default is the AdminSettings singleton's pointer relation, and a call
      // count alone would survive that query being pointed somewhere else.
      expect(vi.mocked(mockPrisma.adminSettings.findUnique)).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ADMIN_SETTINGS_SINGLETON_ID } })
      );
      expect(loaded?.model).toBe(GLOBAL_SENTINEL_MODEL);
      expect(loaded?.contextWindowTokens).toBe(111111);
    });

    it('does not load the global default config when the personality has a defaultConfigLink', async () => {
      mockGlobalDefault();
      const id = '00000000-0000-0000-0000-000000000202';
      const personality = makeDbPersonality({
        id,
        name: 'HasLink',
        slug: 'haslink',
        defaultConfigLink: linkedLlmConfig('own-model'),
      });
      vi.mocked(mockPrisma.personality.findFirst).mockResolvedValue(personality as any);

      const loaded = await service.loadPersonality(id);

      expect(vi.mocked(mockPrisma.adminSettings.findUnique)).not.toHaveBeenCalled();
      expect(loaded?.model).toBe('own-model');
    });
  });

  describe('loadAllPersonalities', () => {
    it('does not load the global default when every personality has a defaultConfigLink', async () => {
      mockGlobalDefault();
      const p1 = makeDbPersonality({
        id: '00000000-0000-0000-0000-000000000301',
        name: 'A1',
        slug: 'a1',
        defaultConfigLink: linkedLlmConfig('model-a'),
      });
      const p2 = makeDbPersonality({
        id: '00000000-0000-0000-0000-000000000302',
        name: 'A2',
        slug: 'a2',
        defaultConfigLink: linkedLlmConfig('model-b'),
      });
      vi.mocked(mockPrisma.personality.findMany).mockResolvedValue([p1, p2] as any);

      const result = await service.loadAllPersonalities();

      expect(vi.mocked(mockPrisma.adminSettings.findUnique)).not.toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(result.map(p => p.model)).toEqual(['model-a', 'model-b']);
      expect(result.map(p => p.id)).toEqual([
        '00000000-0000-0000-0000-000000000301',
        '00000000-0000-0000-0000-000000000302',
      ]);
    });

    // TWO unlinked personalities, deliberately: the load is once per BATCH, not
    // once per personality that needs it. With a single unlinked entry both
    // semantics produce exactly one call, so the assertion below would hold
    // even if the lookup were moved inside the .map().
    it('loads the global default exactly once for a mixed list, not once per unlinked personality', async () => {
      mockGlobalDefault();
      const withLink = makeDbPersonality({
        id: '00000000-0000-0000-0000-000000000401',
        name: 'WithLink',
        slug: 'withlink',
        defaultConfigLink: linkedLlmConfig('own-model'),
      });
      const noLink = makeDbPersonality({
        id: '00000000-0000-0000-0000-000000000402',
        name: 'NoLink',
        slug: 'nolink2',
        defaultConfigLink: null,
      });
      const noLink2 = makeDbPersonality({
        id: '00000000-0000-0000-0000-000000000403',
        name: 'NoLinkTwo',
        slug: 'nolink3',
        defaultConfigLink: null,
      });
      vi.mocked(mockPrisma.personality.findMany).mockResolvedValue([
        withLink,
        noLink,
        noLink2,
      ] as any);

      const result = await service.loadAllPersonalities();

      expect(vi.mocked(mockPrisma.adminSettings.findUnique)).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(3);
      expect(result[0]?.id).toBe('00000000-0000-0000-0000-000000000401');
      expect(result[0]?.model).toBe('own-model');
      expect(result[1]?.id).toBe('00000000-0000-0000-0000-000000000402');
      expect(result[1]?.model).toBe(GLOBAL_SENTINEL_MODEL);
      expect(result[1]?.contextWindowTokens).toBe(111111);
      expect(result[2]?.id).toBe('00000000-0000-0000-0000-000000000403');
      expect(result[2]?.model).toBe(GLOBAL_SENTINEL_MODEL);
    });

    it('warms the cache so a subsequent loadPersonality by ID makes no additional DB calls', async () => {
      mockGlobalDefault();
      const id = '00000000-0000-0000-0000-000000000501';
      const warm = makeDbPersonality({
        id,
        name: 'Warm',
        slug: 'warm',
        defaultConfigLink: linkedLlmConfig('warm-model'),
      });
      vi.mocked(mockPrisma.personality.findMany).mockResolvedValue([warm] as any);

      await service.loadAllPersonalities();

      const afterAll = {
        first: vi.mocked(mockPrisma.personality.findFirst).mock.calls.length,
        many: vi.mocked(mockPrisma.personality.findMany).mock.calls.length,
      };

      const cached = await service.loadPersonality(id);

      expect(cached?.id).toBe(id);
      expect(cached?.model).toBe('warm-model');
      expect(vi.mocked(mockPrisma.personality.findFirst).mock.calls.length).toBe(afterAll.first);
      expect(vi.mocked(mockPrisma.personality.findMany).mock.calls.length).toBe(afterAll.many);
    });
  });
});
