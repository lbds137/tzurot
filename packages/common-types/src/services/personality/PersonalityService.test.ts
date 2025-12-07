/**
 * PersonalityService Unit Tests
 * Tests cache invalidation methods
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PersonalityService } from './PersonalityService.js';
import type { PrismaClient } from '../prisma.js';

describe('PersonalityService - Cache Invalidation', () => {
  let mockPrisma: PrismaClient;
  let service: PersonalityService;

  beforeEach(() => {
    // Mock Prisma client
    mockPrisma = {
      personality: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      llmConfig: {
        findFirst: vi.fn(),
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
            visionModel: null,
            temperature: 0.7,
            topP: null,
            topK: null,
            frequencyPenalty: null,
            presencePenalty: null,
            maxTokens: 1000,
            memoryScoreThreshold: 0.7,
            memoryLimit: 10,
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
            visionModel: null,
            temperature: 0.7,
            topP: null,
            topK: null,
            frequencyPenalty: null,
            presencePenalty: null,
            maxTokens: 1000,
            memoryScoreThreshold: 0.7,
            memoryLimit: 10,
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
            visionModel: null,
            temperature: 0.7,
            topP: null,
            topK: null,
            frequencyPenalty: null,
            presencePenalty: null,
            maxTokens: 1000,
            memoryScoreThreshold: 0.7,
            memoryLimit: 10,
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
          visionModel: null,
          temperature: 0.7,
          topP: null,
          topK: null,
          frequencyPenalty: null,
          presencePenalty: null,
          maxTokens: 1000,
          memoryScoreThreshold: 0.7,
          memoryLimit: 10,
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
      vi.mocked(mockPrisma.personality.findFirst).mockResolvedValue(mockPersonality as any);

      // Load by name - should hit DB
      const loaded1 = await service.loadPersonality('PrivatePersonality');
      expect(loaded1).not.toBeNull();
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(1);

      // Cache is now populated by ID, but loading by name should still hit DB
      // because we only cache by ID and name lookups always go to DB
      const loaded2 = await service.loadPersonality('PrivatePersonality');
      expect(loaded2).not.toBeNull();
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(2); // Now 2
    });

    it('should return null when access control denies access', async () => {
      // Mock DB returning null (personality exists but user lacks access)
      vi.mocked(mockPrisma.personality.findFirst).mockResolvedValue(null);

      // Load with userId - DB returns null due to access control
      const loaded = await service.loadPersonality(
        '00000000-0000-0000-0000-000000000099',
        'unauthorized-user'
      );

      expect(loaded).toBeNull();
      // Verify DB was queried - prioritized lookup tries UUID, name, and slug
      // The input is a UUID so it tries: UUID lookup → name lookup → slug lookup
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(3);
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
        systemPrompt: { content: 'Test' },
        defaultConfigLink: {
          llmConfig: {
            model: 'test-model',
            visionModel: null,
            temperature: 0.7,
            topP: null,
            topK: null,
            frequencyPenalty: null,
            presencePenalty: null,
            maxTokens: 1000,
            memoryScoreThreshold: 0.7,
            memoryLimit: 10,
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
      };

      vi.mocked(mockPrisma.personality.findFirst).mockResolvedValue(mockPersonality as any);

      // Initially empty
      let stats = service.getCacheStats();
      expect(stats.size).toBe(0);

      // Load a personality
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
});
