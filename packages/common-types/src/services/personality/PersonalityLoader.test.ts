/**
 * PersonalityLoader Unit Tests
 * Tests database query logic for loading personalities
 *
 * The PersonalityLoader uses a prioritized lookup strategy:
 * 1. UUID lookup (if input looks like a UUID)
 * 2. Name lookup (case-insensitive)
 * 3. Slug lookup (lowercase)
 * 4. Alias lookup (fallback)
 *
 * This prevents slug/name collisions where a personality named "Lilith"
 * should win over a different personality with slug "lilith".
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PersonalityLoader } from './PersonalityLoader.js';
import type { PrismaClient } from '../prisma.js';
import * as ownerMiddleware from '../../utils/ownerMiddleware.js';

vi.mock('../../utils/ownerMiddleware.js', () => ({
  isBotOwner: vi.fn().mockReturnValue(false),
}));

describe('PersonalityLoader', () => {
  let mockPrisma: PrismaClient;
  let loader: PersonalityLoader;

  // Helper to create a mock personality object
  const createMockPersonality = (
    overrides: Partial<{
      id: string;
      name: string;
      displayName: string;
      slug: string;
      isPublic: boolean;
      ownerId: string | null;
    }> = {}
  ) => ({
    id: overrides.id ?? 'test-id',
    name: overrides.name ?? 'TestBot',
    displayName: overrides.displayName ?? 'Test Bot',
    slug: overrides.slug ?? 'test-bot',
    isPublic: overrides.isPublic ?? true,
    ownerId: overrides.ownerId ?? null,
    updatedAt: new Date(),
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
    errorMessage: null,
  });

  beforeEach(() => {
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
    } as unknown as PrismaClient;

    loader = new PersonalityLoader(mockPrisma);
  });

  describe('loadFromDatabase', () => {
    describe('prioritized lookup order', () => {
      it('should find personality by UUID on first query when input is UUID', async () => {
        const mockPersonality = createMockPersonality({
          id: '00000000-0000-0000-0000-000000000001',
          name: 'TestBot',
        });

        vi.mocked(mockPrisma.personality.findFirst).mockResolvedValueOnce(mockPersonality as any);

        const result = await loader.loadFromDatabase('00000000-0000-0000-0000-000000000001');

        expect(result).not.toBeNull();
        expect(result?.id).toBe('00000000-0000-0000-0000-000000000001');

        // Should only make one call (UUID lookup succeeds)
        expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(1);

        // Verify UUID query structure
        expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledWith({
          where: {
            AND: [{ id: '00000000-0000-0000-0000-000000000001' }],
          },
          select: expect.any(Object),
        });
      });

      it('should find personality by name when input is not UUID', async () => {
        const mockPersonality = createMockPersonality({
          name: 'TestBot',
        });

        vi.mocked(mockPrisma.personality.findFirst).mockResolvedValueOnce(mockPersonality as any);

        const result = await loader.loadFromDatabase('testbot');

        expect(result).not.toBeNull();
        expect(result?.name).toBe('TestBot');

        // Should only make one call (name lookup succeeds)
        expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(1);

        // Verify name query structure (case-insensitive)
        expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledWith({
          where: {
            AND: [{ name: { equals: 'testbot', mode: 'insensitive' } }],
          },
          orderBy: { createdAt: 'asc' },
          select: expect.any(Object),
        });
      });

      it('should fall back to slug lookup when name lookup fails', async () => {
        const mockPersonality = createMockPersonality({
          name: 'TestBot',
          slug: 'test-bot',
        });

        // Name lookup fails, slug lookup succeeds
        vi.mocked(mockPrisma.personality.findFirst)
          .mockResolvedValueOnce(null) // Name lookup
          .mockResolvedValueOnce(mockPersonality as any); // Slug lookup

        const result = await loader.loadFromDatabase('test-bot');

        expect(result).not.toBeNull();
        expect(result?.slug).toBe('test-bot');

        // Should make two calls (name fails, slug succeeds)
        expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(2);

        // Verify slug query structure
        expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenNthCalledWith(2, {
          where: {
            AND: [{ slug: 'test-bot' }],
          },
          orderBy: { createdAt: 'asc' },
          select: expect.any(Object),
        });
      });

      it('should fall back to alias lookup when name and slug fail', async () => {
        const mockPersonality = createMockPersonality({
          id: 'test-id',
          name: 'Lilith',
          slug: 'lilith-tzel-shani',
        });

        // Name and slug lookups fail
        vi.mocked(mockPrisma.personality.findFirst)
          .mockResolvedValueOnce(null) // Name lookup
          .mockResolvedValueOnce(null) // Slug lookup
          .mockResolvedValueOnce(mockPersonality as any); // Personality by alias ID

        // Alias lookup succeeds
        vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValue({
          id: 'alias-id',
          alias: 'lilith',
          personalityId: 'test-id',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);

        const result = await loader.loadFromDatabase('lilith');

        expect(result).not.toBeNull();
        expect(result?.name).toBe('Lilith');
        expect(result?.slug).toBe('lilith-tzel-shani');

        // Should make 3 personality calls (name, slug, by-alias-id)
        expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(3);

        // Verify alias query
        expect(vi.mocked(mockPrisma.personalityAlias.findFirst)).toHaveBeenCalledWith({
          where: {
            alias: { equals: 'lilith', mode: 'insensitive' },
          },
          select: { personalityId: true },
        });
      });

      it('should return null when all lookups fail', async () => {
        // All lookups fail
        vi.mocked(mockPrisma.personality.findFirst).mockResolvedValue(null);
        vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValue(null);

        const result = await loader.loadFromDatabase('nonexistent');

        expect(result).toBeNull();

        // Should make 2 personality calls (name, slug) then alias
        expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(2);
        expect(vi.mocked(mockPrisma.personalityAlias.findFirst)).toHaveBeenCalledTimes(1);
      });
    });

    describe('name vs slug priority (collision prevention)', () => {
      it('should prefer name match over slug match when both could match', async () => {
        // Scenario: User looks up "Lilith"
        // - Personality A: name="Lilith", slug="lilith-tzel-shani" (correct)
        // - Personality B: name="kissed", slug="lilith" (wrong)
        // Old bug: Single OR query might return B if it was created first
        // New behavior: Name lookup happens first, returns A

        const correctPersonality = createMockPersonality({
          id: 'correct-id',
          name: 'Lilith',
          slug: 'lilith-tzel-shani',
        });

        // Name lookup succeeds with correct personality
        vi.mocked(mockPrisma.personality.findFirst).mockResolvedValueOnce(
          correctPersonality as any
        );

        const result = await loader.loadFromDatabase('Lilith');

        expect(result).not.toBeNull();
        expect(result?.id).toBe('correct-id');
        expect(result?.name).toBe('Lilith');
        expect(result?.slug).toBe('lilith-tzel-shani');

        // Should only make one call - name lookup succeeds immediately
        expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(1);
      });

      it('should order by createdAt ascending to prefer oldest personality on name collision', async () => {
        const mockPersonality = createMockPersonality({
          id: 'oldest-personality',
          name: 'DuplicateName',
          slug: 'original-slug',
        });

        vi.mocked(mockPrisma.personality.findFirst).mockResolvedValueOnce(mockPersonality as any);

        const result = await loader.loadFromDatabase('DuplicateName');

        expect(result).not.toBeNull();
        expect(result?.id).toBe('oldest-personality');

        // Verify orderBy is included
        expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledWith(
          expect.objectContaining({
            orderBy: { createdAt: 'asc' },
          })
        );
      });
    });

    describe('alias lookup edge cases', () => {
      it('should return null when alias exists but personality is deleted', async () => {
        // Name and slug lookups fail
        vi.mocked(mockPrisma.personality.findFirst)
          .mockResolvedValueOnce(null) // Name lookup
          .mockResolvedValueOnce(null) // Slug lookup
          .mockResolvedValueOnce(null); // Personality by alias ID (deleted)

        // Alias lookup finds a match
        vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValue({
          id: 'alias-id',
          alias: 'deleted-bot',
          personalityId: 'deleted-id',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);

        const result = await loader.loadFromDatabase('deleted-bot');

        expect(result).toBeNull();
      });
    });

    describe('error handling', () => {
      it('should handle database errors gracefully', async () => {
        vi.mocked(mockPrisma.personality.findFirst).mockRejectedValue(
          new Error('Database connection failed')
        );

        const result = await loader.loadFromDatabase('test');

        expect(result).toBeNull();
      });
    });

    describe('access control', () => {
      it('should apply access filter to name lookup when userId is provided', async () => {
        const mockPersonality = createMockPersonality({
          name: 'PrivateBot',
          slug: 'private-bot',
          isPublic: false,
          ownerId: 'user-123',
        });

        vi.mocked(mockPrisma.personality.findFirst).mockResolvedValueOnce(mockPersonality as any);

        const result = await loader.loadFromDatabase('private-bot', 'user-123');

        expect(result).not.toBeNull();
        expect(result?.isPublic).toBe(false);
        expect(result?.ownerId).toBe('user-123');

        // Verify access filter was applied to name query
        expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledWith({
          where: {
            AND: [
              { name: { equals: 'private-bot', mode: 'insensitive' } },
              { OR: [{ isPublic: true }, { ownerId: 'user-123' }] },
            ],
          },
          orderBy: { createdAt: 'asc' },
          select: expect.any(Object),
        });
      });

      it('should apply access filter to slug lookup when userId is provided', async () => {
        const mockPersonality = createMockPersonality({
          name: 'PrivateBot',
          slug: 'private-bot',
          isPublic: false,
          ownerId: 'user-123',
        });

        // Name lookup fails, slug lookup succeeds
        vi.mocked(mockPrisma.personality.findFirst)
          .mockResolvedValueOnce(null) // Name lookup
          .mockResolvedValueOnce(mockPersonality as any); // Slug lookup

        const result = await loader.loadFromDatabase('private-bot', 'user-123');

        expect(result).not.toBeNull();

        // Verify access filter was applied to slug query
        expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenNthCalledWith(2, {
          where: {
            AND: [{ slug: 'private-bot' }, { OR: [{ isPublic: true }, { ownerId: 'user-123' }] }],
          },
          orderBy: { createdAt: 'asc' },
          select: expect.any(Object),
        });
      });

      it('should not apply access filter when userId is not provided', async () => {
        vi.mocked(mockPrisma.personality.findFirst).mockResolvedValue(null);
        vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValue(null);

        await loader.loadFromDatabase('test');

        // Verify no access filter (AND array has only one element)
        expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenNthCalledWith(1, {
          where: {
            AND: [{ name: { equals: 'test', mode: 'insensitive' } }],
          },
          orderBy: { createdAt: 'asc' },
          select: expect.any(Object),
        });
      });

      it('should return null when user lacks access to private personality', async () => {
        // All lookups return null (access denied due to filter)
        vi.mocked(mockPrisma.personality.findFirst).mockResolvedValue(null);
        vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValue(null);

        const result = await loader.loadFromDatabase('private-bot', 'wrong-user');

        expect(result).toBeNull();
      });

      it('should bypass access filter when user is bot owner', async () => {
        // Mock isBotOwner to return true for this test
        vi.mocked(ownerMiddleware.isBotOwner).mockReturnValueOnce(true);

        const mockPersonality = createMockPersonality({
          id: 'private-id',
          name: 'PrivateBot',
          slug: 'private-bot',
          isPublic: false,
          ownerId: 'other-user',
        });

        vi.mocked(mockPrisma.personality.findFirst).mockResolvedValueOnce(mockPersonality as any);

        const result = await loader.loadFromDatabase('private-bot', 'bot-owner-id');

        expect(result).not.toBeNull();
        expect(result?.id).toBe('private-id');

        // Verify no access filter was applied (AND array has only one element)
        expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledWith({
          where: {
            AND: [{ name: { equals: 'private-bot', mode: 'insensitive' } }],
          },
          orderBy: { createdAt: 'asc' },
          select: expect.any(Object),
        });
      });

      it('should apply access filter to alias-based lookup', async () => {
        const mockPersonality = createMockPersonality({
          id: 'private-id',
          name: 'PrivateBot',
          isPublic: false,
          ownerId: 'user-123',
        });

        // Name and slug lookups fail
        vi.mocked(mockPrisma.personality.findFirst)
          .mockResolvedValueOnce(null) // Name lookup
          .mockResolvedValueOnce(null) // Slug lookup
          .mockResolvedValueOnce(mockPersonality as any); // Personality by alias ID

        // Alias lookup succeeds
        vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValue({
          personalityId: 'private-id',
        } as any);

        const result = await loader.loadFromDatabase('my-alias', 'user-123');

        expect(result).not.toBeNull();

        // Verify access filter was applied to the alias-based personality lookup
        expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenNthCalledWith(3, {
          where: {
            AND: [{ id: 'private-id' }, { OR: [{ isPublic: true }, { ownerId: 'user-123' }] }],
          },
          select: expect.any(Object),
        });
      });
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
        createMockPersonality({ id: 'id-1', name: 'Bot1', slug: 'bot-1' }),
        createMockPersonality({
          id: 'id-2',
          name: 'Bot2',
          slug: 'bot-2',
          isPublic: false,
          ownerId: 'user-123',
        }),
      ];

      vi.mocked(mockPrisma.personality.findMany).mockResolvedValue(mockPersonalities as any);

      const result = await loader.loadAllFromDatabase();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('id-1');
      expect(result[1].id).toBe('id-2');
      expect(vi.mocked(mockPrisma.personality.findMany)).toHaveBeenCalledWith({
        select: expect.any(Object),
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
