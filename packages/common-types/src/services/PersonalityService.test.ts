/**
 * PersonalityService Unit Tests
 * Tests cache invalidation methods
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PersonalityService } from './PersonalityService.js';
import type { PrismaClient } from '@prisma/client';

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
        id: 'test-id',
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

      // Load personality (should cache it)
      const loaded1 = await service.loadPersonality('test');
      expect(loaded1).not.toBeNull();
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(1);

      // Load again (should come from cache, no DB call)
      const loaded2 = await service.loadPersonality('test');
      expect(loaded2).not.toBeNull();
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(1); // Still 1

      // Invalidate the cache
      service.invalidatePersonality('test');

      // Load again (should hit DB again since cache was invalidated)
      const loaded3 = await service.loadPersonality('test');
      expect(loaded3).not.toBeNull();
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(2); // Now 2
    });

    it('should handle invalidating non-existent cache entries gracefully', () => {
      // Should not throw error
      expect(() => {
        service.invalidatePersonality('non-existent');
      }).not.toThrow();
    });
  });

  describe('invalidateAll', () => {
    it('should clear entire cache', async () => {
      // Setup: Load multiple personalities
      const mockPersonality1 = {
        id: 'test-id-1',
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
        id: 'test-id-2',
        name: 'TestPersonality2',
        displayName: 'Test 2',
        slug: 'test2',
      };

      vi.mocked(mockPrisma.personality.findFirst)
        .mockResolvedValueOnce(mockPersonality1 as any)
        .mockResolvedValueOnce(mockPersonality2 as any)
        .mockResolvedValueOnce(mockPersonality1 as any)
        .mockResolvedValueOnce(mockPersonality2 as any);

      // Load two personalities (cache them)
      await service.loadPersonality('test1');
      await service.loadPersonality('test2');
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(2);

      // Verify cache hit
      await service.loadPersonality('test1');
      await service.loadPersonality('test2');
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(2); // Still 2

      // Invalidate entire cache
      service.invalidateAll();

      // Load both again (should hit DB since cache was cleared)
      await service.loadPersonality('test1');
      await service.loadPersonality('test2');
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(4); // Now 4
    });

    it('should handle empty cache gracefully', () => {
      // Should not throw error
      expect(() => {
        service.invalidateAll();
      }).not.toThrow();
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

      // Cache should have 1 entry
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
