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
import * as configModule from '../../config/index.js';

vi.mock('../../utils/ownerMiddleware.js', () => ({
  isBotOwner: vi.fn().mockReturnValue(false),
}));

vi.mock('../../config/index.js', () => ({
  getConfig: vi.fn().mockReturnValue({ BOT_OWNER_ID: undefined }),
}));

describe('PersonalityLoader', () => {
  let mockPrisma: PrismaClient;
  let loader: PersonalityLoader;

  // Auto-incrementing counter for deterministic createdAt ordering in tests
  let createdAtCounter = 0;

  // Helper to create a mock personality object
  const createMockPersonality = (
    overrides: Partial<{
      id: string;
      name: string;
      displayName: string;
      slug: string;
      isPublic: boolean;
      ownerId: string;
      createdAt: Date;
    }> = {}
  ) => ({
    id: overrides.id ?? 'test-id',
    name: overrides.name ?? 'TestBot',
    displayName: overrides.displayName ?? 'Test Bot',
    slug: overrides.slug ?? 'test-bot',
    isPublic: overrides.isPublic ?? true,
    ownerId: overrides.ownerId ?? 'default-owner-id',
    createdAt: overrides.createdAt ?? new Date(2026, 0, 1, 0, 0, createdAtCounter++),
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
    createdAtCounter = 0;

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

    describe('name conflict resolution', () => {
      const ADMIN_DB_UUID = '00000000-0000-0000-0000-admin0000001';
      const OTHER_OWNER = '00000000-0000-0000-0000-other0000001';

      it('should return single name match directly without scoring', async () => {
        const personality = createMockPersonality({
          name: 'Lilith',
          slug: 'lilith-one',
          isPublic: false,
          ownerId: OTHER_OWNER,
        });

        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([personality] as any);

        const result = await loader.loadFromDatabase('Lilith');

        expect(result).not.toBeNull();
        expect(result?.name).toBe('Lilith');
        // No admin UUID lookup needed for single match
        expect(vi.mocked(mockPrisma.user.findUnique)).not.toHaveBeenCalled();
      });

      it('should prefer public over private when names collide', async () => {
        const privateOlder = createMockPersonality({
          id: 'private-older',
          name: 'Lilith',
          slug: 'lilith-private',
          isPublic: false,
          ownerId: OTHER_OWNER,
        });
        const publicNewer = createMockPersonality({
          id: 'public-newer',
          name: 'Lilith',
          slug: 'lilith-public',
          isPublic: true,
          ownerId: OTHER_OWNER,
        });

        // DB returns oldest first (createdAt asc) — private one is older
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([
          privateOlder,
          publicNewer,
        ] as any);

        // No BOT_OWNER_ID configured
        vi.mocked(configModule.getConfig).mockReturnValue({ BOT_OWNER_ID: undefined } as any);

        const result = await loader.loadFromDatabase('Lilith');

        expect(result).not.toBeNull();
        expect(result?.id).toBe('public-newer');
      });

      it('should prefer admin-owned among same visibility', async () => {
        const publicOther = createMockPersonality({
          id: 'public-other',
          name: 'Lilith',
          slug: 'lilith-other',
          isPublic: true,
          ownerId: OTHER_OWNER,
        });
        const publicAdmin = createMockPersonality({
          id: 'public-admin',
          name: 'Lilith',
          slug: 'lilith-admin',
          isPublic: true,
          ownerId: ADMIN_DB_UUID,
        });

        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([
          publicOther,
          publicAdmin,
        ] as any);

        // Configure bot admin
        vi.mocked(configModule.getConfig).mockReturnValue({
          BOT_OWNER_ID: 'discord-admin-id',
        } as any);
        vi.mocked(mockPrisma.user.findUnique).mockResolvedValueOnce({
          id: ADMIN_DB_UUID,
        } as any);

        const result = await loader.loadFromDatabase('Lilith');

        expect(result).not.toBeNull();
        expect(result?.id).toBe('public-admin');
      });

      it('should prefer public non-admin (score 2) over private admin (score 1)', async () => {
        const privateAdmin = createMockPersonality({
          id: 'private-admin',
          name: 'Lilith',
          slug: 'lilith-admin',
          isPublic: false,
          ownerId: ADMIN_DB_UUID,
        });
        const publicOther = createMockPersonality({
          id: 'public-other',
          name: 'Lilith',
          slug: 'lilith-other',
          isPublic: true,
          ownerId: OTHER_OWNER,
        });

        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([
          privateAdmin,
          publicOther,
        ] as any);

        vi.mocked(configModule.getConfig).mockReturnValue({
          BOT_OWNER_ID: 'discord-admin-id',
        } as any);
        vi.mocked(mockPrisma.user.findUnique).mockResolvedValueOnce({
          id: ADMIN_DB_UUID,
        } as any);

        const result = await loader.loadFromDatabase('Lilith');

        expect(result).not.toBeNull();
        expect(result?.id).toBe('public-other');
      });

      it('should use oldest as tiebreaker when scores are equal', async () => {
        // Both public, neither admin-owned — score 2 each, oldest wins
        const older = createMockPersonality({
          id: 'older-public',
          name: 'Lilith',
          slug: 'lilith-older',
          isPublic: true,
          ownerId: 'owner-a',
        });
        const newer = createMockPersonality({
          id: 'newer-public',
          name: 'Lilith',
          slug: 'lilith-newer',
          isPublic: true,
          ownerId: 'owner-b',
        });

        // DB returns oldest first
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([older, newer] as any);

        vi.mocked(configModule.getConfig).mockReturnValue({ BOT_OWNER_ID: undefined } as any);

        const result = await loader.loadFromDatabase('Lilith');

        expect(result).not.toBeNull();
        expect(result?.id).toBe('older-public');
      });

      it('should not affect slug resolution', async () => {
        // No name match, only slug match — returned directly, no scoring
        const slugOnly = createMockPersonality({
          name: 'SomethingElse',
          slug: 'lilith',
          isPublic: false,
          ownerId: OTHER_OWNER,
        });

        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([slugOnly] as any);

        const result = await loader.loadFromDatabase('lilith');

        expect(result).not.toBeNull();
        expect(result?.slug).toBe('lilith');
        // No admin lookup for slug-only match
        expect(vi.mocked(mockPrisma.user.findUnique)).not.toHaveBeenCalled();
      });

      it('should cache bot admin UUID across multiple calls', async () => {
        vi.mocked(configModule.getConfig).mockReturnValue({
          BOT_OWNER_ID: 'discord-admin-id',
        } as any);
        // First call succeeds; second would throw if cache misses
        vi.mocked(mockPrisma.user.findUnique)
          .mockResolvedValueOnce({ id: ADMIN_DB_UUID } as any)
          .mockRejectedValueOnce(
            new Error('Admin UUID should have been cached — unexpected second DB call')
          );

        // First call — two name matches, triggers admin UUID resolution
        const match1a = createMockPersonality({
          id: 'a1',
          name: 'Lilith',
          slug: 'lilith-a',
          isPublic: true,
          ownerId: ADMIN_DB_UUID,
        });
        const match1b = createMockPersonality({
          id: 'a2',
          name: 'Lilith',
          slug: 'lilith-b',
          isPublic: true,
          ownerId: OTHER_OWNER,
        });
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([match1a, match1b] as any);

        await loader.loadFromDatabase('Lilith');

        // Second call — different collision
        const match2a = createMockPersonality({
          id: 'b1',
          name: 'Eve',
          slug: 'eve-a',
          isPublic: true,
          ownerId: ADMIN_DB_UUID,
        });
        const match2b = createMockPersonality({
          id: 'b2',
          name: 'Eve',
          slug: 'eve-b',
          isPublic: true,
          ownerId: OTHER_OWNER,
        });
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([match2a, match2b] as any);

        await loader.loadFromDatabase('Eve');

        // user.findUnique called only once (for resolveOwnerUuid there's no userId,
        // so only the admin UUID resolution call happens) — cached on second call
        expect(vi.mocked(mockPrisma.user.findUnique)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(mockPrisma.user.findUnique)).toHaveBeenCalledWith({
          where: { discordId: 'discord-admin-id' },
          select: { id: true },
        });
      });

      it('should fall back gracefully when admin UUID lookup fails', async () => {
        const privateAdmin = createMockPersonality({
          id: 'private-admin',
          name: 'Lilith',
          slug: 'lilith-admin',
          isPublic: false,
          ownerId: ADMIN_DB_UUID,
        });
        const publicOther = createMockPersonality({
          id: 'public-other',
          name: 'Lilith',
          slug: 'lilith-other',
          isPublic: true,
          ownerId: OTHER_OWNER,
        });

        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([
          privateAdmin,
          publicOther,
        ] as any);

        vi.mocked(configModule.getConfig).mockReturnValue({
          BOT_OWNER_ID: 'discord-admin-id',
        } as any);
        // DB error on admin lookup — should not propagate
        vi.mocked(mockPrisma.user.findUnique).mockRejectedValueOnce(
          new Error('Connection refused')
        );

        const result = await loader.loadFromDatabase('Lilith');

        // Should still resolve — public wins on isPublic alone (admin score unknown)
        expect(result).not.toBeNull();
        expect(result?.id).toBe('public-other');
      });

      it('should not cache null when admin has not registered yet', async () => {
        vi.mocked(configModule.getConfig).mockReturnValue({
          BOT_OWNER_ID: 'discord-admin-id',
        } as any);

        // First call: admin not in DB yet (returns null, should NOT cache)
        // Second call: admin has registered
        vi.mocked(mockPrisma.user.findUnique)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: ADMIN_DB_UUID } as any);

        const matchA = createMockPersonality({
          id: 'admin-char',
          name: 'Lilith',
          slug: 'lilith-admin',
          isPublic: true,
          ownerId: ADMIN_DB_UUID,
        });
        const matchB = createMockPersonality({
          id: 'other-char',
          name: 'Lilith',
          slug: 'lilith-other',
          isPublic: true,
          ownerId: OTHER_OWNER,
        });

        // First collision — admin not found, no admin preference, tiebreaker: oldest
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([matchA, matchB] as any);
        const result1 = await loader.loadFromDatabase('Lilith');
        expect(result1?.id).toBe('admin-char'); // oldest wins (same score)

        // Second collision — admin now registered, should re-query and apply preference
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([matchA, matchB] as any);
        const result2 = await loader.loadFromDatabase('Lilith');
        expect(result2?.id).toBe('admin-char'); // wins by score 3 now

        // Key assertion: user.findUnique called TWICE (null was not cached)
        expect(vi.mocked(mockPrisma.user.findUnique)).toHaveBeenCalledTimes(2);
      });

      it('should retry admin UUID lookup after transient failure', async () => {
        vi.mocked(configModule.getConfig).mockReturnValue({
          BOT_OWNER_ID: 'discord-admin-id',
        } as any);

        // First call: DB error (not cached)
        vi.mocked(mockPrisma.user.findUnique)
          .mockRejectedValueOnce(new Error('Connection refused'))
          .mockResolvedValueOnce({ id: ADMIN_DB_UUID } as any);

        const match1a = createMockPersonality({
          id: 'a1',
          name: 'Lilith',
          slug: 'lilith-a',
          isPublic: true,
          ownerId: ADMIN_DB_UUID,
        });
        const match1b = createMockPersonality({
          id: 'a2',
          name: 'Lilith',
          slug: 'lilith-b',
          isPublic: true,
          ownerId: OTHER_OWNER,
        });
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([match1a, match1b] as any);

        // First call — admin UUID fails, no admin preference applied
        const result1 = await loader.loadFromDatabase('Lilith');
        // Both score 2 (public), tiebreaker: oldest (a1 created first)
        expect(result1?.id).toBe('a1');

        // Second call — admin UUID succeeds now, gets cached
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([match1a, match1b] as any);
        const result2 = await loader.loadFromDatabase('Lilith');
        // Admin-owned a1 now scores 3 vs a2's score 2
        expect(result2?.id).toBe('a1');

        // Admin UUID was looked up twice (not cached on error)
        expect(vi.mocked(mockPrisma.user.findUnique)).toHaveBeenCalledTimes(2);
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
