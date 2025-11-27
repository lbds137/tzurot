/**
 * PersonalityLoader Unit Tests
 * Tests database query logic for loading personalities
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PersonalityLoader } from './PersonalityLoader.js';
import type { PrismaClient } from '../prisma.js';

describe('PersonalityLoader', () => {
  let mockPrisma: PrismaClient;
  let loader: PersonalityLoader;

  beforeEach(() => {
    mockPrisma = {
      personality: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
      personalityAlias: {
        findFirst: vi.fn(),
      },
      llmConfig: {
        findFirst: vi.fn(),
      },
    } as unknown as PrismaClient;

    loader = new PersonalityLoader(mockPrisma);
  });

  describe('loadFromDatabase', () => {
    it('should load personality by UUID', async () => {
      const mockPersonality = {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'TestBot',
        displayName: 'Test Bot',
        slug: 'test-bot',
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

      const result = await loader.loadFromDatabase('00000000-0000-0000-0000-000000000001');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('00000000-0000-0000-0000-000000000001');
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledWith({
        where: {
          OR: [
            { id: '00000000-0000-0000-0000-000000000001' },
            { name: { equals: '00000000-0000-0000-0000-000000000001', mode: 'insensitive' } },
            { slug: '00000000-0000-0000-0000-000000000001' },
          ],
        },
        include: expect.any(Object),
      });
    });

    it('should load personality by name (case-insensitive)', async () => {
      const mockPersonality = {
        id: 'test-id',
        name: 'TestBot',
        displayName: 'Test Bot',
        slug: 'test-bot',
        systemPrompt: { content: 'Test prompt' },
        defaultConfigLink: null,
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

      const result = await loader.loadFromDatabase('testbot');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('TestBot');
      expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledWith({
        where: {
          OR: [{ name: { equals: 'testbot', mode: 'insensitive' } }, { slug: 'testbot' }],
        },
        include: expect.any(Object),
      });
    });

    it('should load personality by slug', async () => {
      const mockPersonality = {
        id: 'test-id',
        name: 'TestBot',
        displayName: 'Test Bot',
        slug: 'test-bot',
        systemPrompt: { content: 'Test prompt' },
        defaultConfigLink: null,
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

      const result = await loader.loadFromDatabase('test-bot');

      expect(result).not.toBeNull();
      expect(result?.slug).toBe('test-bot');
    });

    it('should return null when personality not found', async () => {
      vi.mocked(mockPrisma.personality.findFirst).mockResolvedValue(null);
      vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValue(null);

      const result = await loader.loadFromDatabase('nonexistent');

      expect(result).toBeNull();
    });

    it('should load personality by alias when direct lookup fails', async () => {
      const mockPersonality = {
        id: 'test-id',
        name: 'Lilith',
        displayName: 'Lilith',
        slug: 'lilith-tzel-shani',
        systemPrompt: { content: 'Test prompt' },
        defaultConfigLink: null,
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

      // Direct lookup returns null
      vi.mocked(mockPrisma.personality.findFirst).mockResolvedValue(null);
      // Alias lookup finds a match
      vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValue({
        id: 'alias-id',
        alias: 'lilith',
        personalityId: 'test-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
      // Personality lookup by ID returns the personality
      vi.mocked(mockPrisma.personality.findUnique).mockResolvedValue(mockPersonality as any);

      const result = await loader.loadFromDatabase('lilith');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('Lilith');
      expect(result?.slug).toBe('lilith-tzel-shani');
      expect(vi.mocked(mockPrisma.personalityAlias.findFirst)).toHaveBeenCalledWith({
        where: {
          alias: { equals: 'lilith', mode: 'insensitive' },
        },
        select: { personalityId: true },
      });
      expect(vi.mocked(mockPrisma.personality.findUnique)).toHaveBeenCalledWith({
        where: { id: 'test-id' },
        include: expect.any(Object),
      });
    });

    it('should return null when alias exists but personality is deleted', async () => {
      // Direct lookup returns null
      vi.mocked(mockPrisma.personality.findFirst).mockResolvedValue(null);
      // Alias lookup finds a match
      vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValue({
        id: 'alias-id',
        alias: 'deleted-bot',
        personalityId: 'deleted-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
      // Personality lookup by ID returns null (deleted)
      vi.mocked(mockPrisma.personality.findUnique).mockResolvedValue(null);

      const result = await loader.loadFromDatabase('deleted-bot');

      expect(result).toBeNull();
    });

    it('should handle database errors gracefully', async () => {
      vi.mocked(mockPrisma.personality.findFirst).mockRejectedValue(
        new Error('Database connection failed')
      );

      const result = await loader.loadFromDatabase('test');

      expect(result).toBeNull();
    });
  });

  describe('loadGlobalDefaultConfig', () => {
    it('should load global default config', async () => {
      const mockConfig = {
        model: 'global-model',
        visionModel: 'global-vision-model',
        temperature: 0.7,
        topP: null,
        topK: null,
        frequencyPenalty: null,
        presencePenalty: null,
        maxTokens: 4096,
        memoryScoreThreshold: 0.7,
        memoryLimit: 10,
        contextWindowTokens: 200000,
      };

      vi.mocked(mockPrisma.llmConfig.findFirst).mockResolvedValue(mockConfig as any);

      const result = await loader.loadGlobalDefaultConfig();

      expect(result).not.toBeNull();
      expect(result?.model).toBe('global-model');
      expect(vi.mocked(mockPrisma.llmConfig.findFirst)).toHaveBeenCalledWith({
        where: {
          isGlobal: true,
          isDefault: true,
        },
        select: expect.any(Object),
      });
    });

    it('should return null when no global default exists', async () => {
      vi.mocked(mockPrisma.llmConfig.findFirst).mockResolvedValue(null);

      const result = await loader.loadGlobalDefaultConfig();

      expect(result).toBeNull();
    });

    it('should handle database errors gracefully', async () => {
      vi.mocked(mockPrisma.llmConfig.findFirst).mockRejectedValue(
        new Error('Database connection failed')
      );

      const result = await loader.loadGlobalDefaultConfig();

      expect(result).toBeNull();
    });
  });

  describe('loadAllFromDatabase', () => {
    it('should load all personalities', async () => {
      const mockPersonalities = [
        {
          id: 'id-1',
          name: 'Bot1',
          displayName: 'Bot 1',
          slug: 'bot-1',
          systemPrompt: { content: 'Prompt 1' },
          defaultConfigLink: null,
          characterInfo: 'Character 1',
          personalityTraits: 'Traits 1',
          personalityTone: null,
          personalityAge: null,
          personalityAppearance: null,
          personalityLikes: null,
          personalityDislikes: null,
          conversationalGoals: null,
          conversationalExamples: null,
        },
        {
          id: 'id-2',
          name: 'Bot2',
          displayName: 'Bot 2',
          slug: 'bot-2',
          systemPrompt: { content: 'Prompt 2' },
          defaultConfigLink: null,
          characterInfo: 'Character 2',
          personalityTraits: 'Traits 2',
          personalityTone: null,
          personalityAge: null,
          personalityAppearance: null,
          personalityLikes: null,
          personalityDislikes: null,
          conversationalGoals: null,
          conversationalExamples: null,
        },
      ];

      vi.mocked(mockPrisma.personality.findMany).mockResolvedValue(mockPersonalities as any);

      const result = await loader.loadAllFromDatabase();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('id-1');
      expect(result[1].id).toBe('id-2');
      expect(vi.mocked(mockPrisma.personality.findMany)).toHaveBeenCalledWith({
        include: expect.any(Object),
      });
    });

    it('should return empty array when no personalities exist', async () => {
      vi.mocked(mockPrisma.personality.findMany).mockResolvedValue([]);

      const result = await loader.loadAllFromDatabase();

      expect(result).toEqual([]);
    });

    it('should handle database errors gracefully', async () => {
      vi.mocked(mockPrisma.personality.findMany).mockRejectedValue(
        new Error('Database connection failed')
      );

      const result = await loader.loadAllFromDatabase();

      expect(result).toEqual([]);
    });
  });
});
