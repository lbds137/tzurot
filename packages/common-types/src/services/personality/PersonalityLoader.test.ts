/**
 * PersonalityLoader Unit Tests
 * Tests database query logic for loading personalities
 *
 * The PersonalityLoader uses a prioritized lookup strategy:
 * 1. UUID lookup (if input looks like a UUID) - findFirst
 * 2. Name OR Slug lookup (combined query) - findMany with in-memory prioritization
 *    - Name match takes priority over slug match
 * 3. Alias lookup (fallback) - findFirst on personalityAlias, then findFirst on personality
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
      user: {
        findUnique: vi.fn(),
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
          slug: 'test-bot',
        });

        // findMany returns array with matching personality
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([mockPersonality] as any);

        const result = await loader.loadFromDatabase('testbot');

        expect(result).not.toBeNull();
        expect(result?.name).toBe('TestBot');

        // Should use findMany for combined name/slug lookup
        expect(vi.mocked(mockPrisma.personality.findMany)).toHaveBeenCalledTimes(1);

        // Verify combined query structure (name OR slug)
        expect(vi.mocked(mockPrisma.personality.findMany)).toHaveBeenCalledWith({
          where: {
            AND: [
              {
                OR: [{ name: { equals: 'testbot', mode: 'insensitive' } }, { slug: 'testbot' }],
              },
            ],
          },
          orderBy: { createdAt: 'asc' },
          select: expect.any(Object),
          take: 100, // SYNC_LIMITS.MAX_PERSONALITY_SEARCH
        });
      });

      it('should return slug match when no name match exists (in-memory prioritization)', async () => {
        // Personality has a different name but matching slug
        const mockPersonality = createMockPersonality({
          name: 'SomeOtherName',
          slug: 'test-bot',
        });

        // findMany returns personality matched by slug (not name)
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([mockPersonality] as any);

        const result = await loader.loadFromDatabase('test-bot');

        expect(result).not.toBeNull();
        expect(result?.slug).toBe('test-bot');

        // Should use findMany for combined name/slug lookup
        expect(vi.mocked(mockPrisma.personality.findMany)).toHaveBeenCalledTimes(1);
      });

      it('should fall back to alias lookup when name and slug fail', async () => {
        const mockPersonality = createMockPersonality({
          id: 'test-id',
          name: 'Lilith',
          slug: 'lilith-tzel-shani',
        });

        // Combined name/slug lookup returns empty (no match)
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([]);

        // Alias lookup succeeds
        vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValue({
          id: 'alias-id',
          alias: 'lilith',
          personalityId: 'test-id',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);

        // Personality by alias ID lookup succeeds
        vi.mocked(mockPrisma.personality.findFirst).mockResolvedValueOnce(mockPersonality as any);

        const result = await loader.loadFromDatabase('lilith');

        expect(result).not.toBeNull();
        expect(result?.name).toBe('Lilith');
        expect(result?.slug).toBe('lilith-tzel-shani');

        // Should make 1 findMany (combined name/slug) + 1 findFirst (by alias ID)
        expect(vi.mocked(mockPrisma.personality.findMany)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledTimes(1);

        // Verify alias query
        expect(vi.mocked(mockPrisma.personalityAlias.findFirst)).toHaveBeenCalledWith({
          where: {
            alias: { equals: 'lilith', mode: 'insensitive' },
          },
          select: { personalityId: true },
        });
      });

      it('should return null when all lookups fail', async () => {
        // Combined name/slug lookup returns empty
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([]);
        // Alias lookup fails
        vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValue(null);

        const result = await loader.loadFromDatabase('nonexistent');

        expect(result).toBeNull();

        // Should make 1 findMany (combined name/slug) then alias lookup
        expect(vi.mocked(mockPrisma.personality.findMany)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(mockPrisma.personalityAlias.findFirst)).toHaveBeenCalledTimes(1);
      });
    });

    describe('name vs slug priority (collision prevention)', () => {
      it('should prefer name match over slug match when both could match', async () => {
        // Scenario: User looks up "Lilith"
        // - Personality A: name="Lilith", slug="lilith-tzel-shani" (correct)
        // - Personality B: name="kissed", slug="lilith" (wrong)
        // Both are returned by findMany, in-memory prioritization picks name match

        const correctPersonality = createMockPersonality({
          id: 'correct-id',
          name: 'Lilith',
          slug: 'lilith-tzel-shani',
        });

        const wrongPersonality = createMockPersonality({
          id: 'wrong-id',
          name: 'kissed',
          slug: 'lilith',
        });

        // findMany returns both candidates (slug match and name match)
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([
          wrongPersonality,
          correctPersonality,
        ] as any);

        const result = await loader.loadFromDatabase('Lilith');

        expect(result).not.toBeNull();
        expect(result?.id).toBe('correct-id');
        expect(result?.name).toBe('Lilith');
        expect(result?.slug).toBe('lilith-tzel-shani');

        // Should use findMany for combined lookup
        expect(vi.mocked(mockPrisma.personality.findMany)).toHaveBeenCalledTimes(1);
      });

      it('should order by createdAt ascending in query', async () => {
        const mockPersonality = createMockPersonality({
          id: 'oldest-personality',
          name: 'DuplicateName',
          slug: 'original-slug',
        });

        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([mockPersonality] as any);

        const result = await loader.loadFromDatabase('DuplicateName');

        expect(result).not.toBeNull();
        expect(result?.id).toBe('oldest-personality');

        // Verify orderBy is included
        expect(vi.mocked(mockPrisma.personality.findMany)).toHaveBeenCalledWith(
          expect.objectContaining({
            orderBy: { createdAt: 'asc' },
          })
        );
      });
    });

    describe('alias lookup edge cases', () => {
      it('should return null when alias exists but personality is deleted', async () => {
        // Combined name/slug lookup returns empty
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([]);

        // Alias lookup finds a match
        vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValue({
          id: 'alias-id',
          alias: 'deleted-bot',
          personalityId: 'deleted-id',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);

        // Personality by alias ID returns null (deleted)
        vi.mocked(mockPrisma.personality.findFirst).mockResolvedValueOnce(null);

        const result = await loader.loadFromDatabase('deleted-bot');

        expect(result).toBeNull();
      });
    });

    describe('error handling', () => {
      it('should handle database errors gracefully', async () => {
        vi.mocked(mockPrisma.personality.findMany).mockRejectedValue(
          new Error('Database connection failed')
        );

        const result = await loader.loadFromDatabase('test');

        expect(result).toBeNull();
      });
    });

    describe('access control', () => {
      it('should apply access filter to combined name/slug lookup when userId is provided', async () => {
        // The ownerId is a database UUID, not Discord ID
        const userUuid = '00000000-0000-0000-0000-000000000123';
        const mockPersonality = createMockPersonality({
          name: 'PrivateBot',
          slug: 'private-bot',
          isPublic: false,
          ownerId: userUuid,
        });

        // Mock user lookup: Discord ID -> UUID
        vi.mocked(mockPrisma.user.findUnique).mockResolvedValueOnce({ id: userUuid } as any);
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([mockPersonality] as any);

        // Pass Discord ID, which gets resolved to UUID internally
        const result = await loader.loadFromDatabase('private-bot', 'discord-user-123');

        expect(result).not.toBeNull();
        expect(result?.isPublic).toBe(false);
        expect(result?.ownerId).toBe(userUuid);

        // Verify user lookup was called with Discord ID
        expect(vi.mocked(mockPrisma.user.findUnique)).toHaveBeenCalledWith({
          where: { discordId: 'discord-user-123' },
          select: { id: true },
        });

        // Verify access filter was applied with UUID (not Discord ID)
        expect(vi.mocked(mockPrisma.personality.findMany)).toHaveBeenCalledWith({
          where: {
            AND: [
              {
                OR: [
                  { name: { equals: 'private-bot', mode: 'insensitive' } },
                  { slug: 'private-bot' },
                ],
              },
              { OR: [{ isPublic: true }, { ownerId: userUuid }] },
            ],
          },
          orderBy: { createdAt: 'asc' },
          select: expect.any(Object),
          take: 100, // SYNC_LIMITS.MAX_PERSONALITY_SEARCH
        });
      });

      it('should not apply access filter when userId is not provided', async () => {
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValue([]);
        vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValue(null);

        await loader.loadFromDatabase('test');

        // Verify no access filter (AND array has only the OR condition)
        expect(vi.mocked(mockPrisma.personality.findMany)).toHaveBeenCalledWith({
          where: {
            AND: [
              {
                OR: [{ name: { equals: 'test', mode: 'insensitive' } }, { slug: 'test' }],
              },
            ],
          },
          orderBy: { createdAt: 'asc' },
          select: expect.any(Object),
          take: 100, // SYNC_LIMITS.MAX_PERSONALITY_SEARCH
        });
      });

      it('should return null when user lacks access to private personality', async () => {
        // Mock user lookup - user exists but has different UUID than owner
        vi.mocked(mockPrisma.user.findUnique).mockResolvedValueOnce({
          id: '00000000-0000-0000-0000-000000000999',
        } as any);

        // All lookups return empty (access denied due to filter)
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValue([]);
        vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValue(null);

        const result = await loader.loadFromDatabase('private-bot', 'wrong-user-discord-id');

        expect(result).toBeNull();
      });

      it('should restrict access when user not found in database', async () => {
        // User doesn't exist in database
        vi.mocked(mockPrisma.user.findUnique).mockResolvedValueOnce(null);

        // Personality lookup returns empty (only public would match)
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValue([]);
        vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValue(null);

        const result = await loader.loadFromDatabase('private-bot', 'unknown-discord-id');

        expect(result).toBeNull();

        // Verify filter only allows public personalities (no ownerId check since user doesn't exist)
        expect(vi.mocked(mockPrisma.personality.findMany)).toHaveBeenCalledWith({
          where: {
            AND: [
              {
                OR: [
                  { name: { equals: 'private-bot', mode: 'insensitive' } },
                  { slug: 'private-bot' },
                ],
              },
              { isPublic: true },
            ],
          },
          orderBy: { createdAt: 'asc' },
          select: expect.any(Object),
          take: 100, // SYNC_LIMITS.MAX_PERSONALITY_SEARCH
        });
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

        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([mockPersonality] as any);

        const result = await loader.loadFromDatabase('private-bot', 'bot-owner-id');

        expect(result).not.toBeNull();
        expect(result?.id).toBe('private-id');

        // Verify no access filter was applied (AND array has only the OR condition)
        expect(vi.mocked(mockPrisma.personality.findMany)).toHaveBeenCalledWith({
          where: {
            AND: [
              {
                OR: [
                  { name: { equals: 'private-bot', mode: 'insensitive' } },
                  { slug: 'private-bot' },
                ],
              },
            ],
          },
          orderBy: { createdAt: 'asc' },
          select: expect.any(Object),
          take: 100, // SYNC_LIMITS.MAX_PERSONALITY_SEARCH
        });
      });

      it('should apply access filter to alias-based lookup', async () => {
        const userUuid = '00000000-0000-0000-0000-000000000123';
        const mockPersonality = createMockPersonality({
          id: 'private-id',
          name: 'PrivateBot',
          isPublic: false,
          ownerId: userUuid,
        });

        // Mock user lookup: Discord ID -> UUID
        vi.mocked(mockPrisma.user.findUnique).mockResolvedValueOnce({ id: userUuid } as any);

        // Combined name/slug lookup returns empty
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([]);

        // Alias lookup succeeds
        vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValue({
          personalityId: 'private-id',
        } as any);

        // Personality by alias ID lookup succeeds
        vi.mocked(mockPrisma.personality.findFirst).mockResolvedValueOnce(mockPersonality as any);

        const result = await loader.loadFromDatabase('my-alias', 'discord-user-123');

        expect(result).not.toBeNull();

        // Verify access filter was applied with UUID to the alias-based personality lookup
        expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledWith({
          where: {
            AND: [{ id: 'private-id' }, { OR: [{ isPublic: true }, { ownerId: userUuid }] }],
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
        take: 1000, // SYNC_LIMITS.MAX_PERSONALITY_CATALOG
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
