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
import { LLM_CONFIG_SELECT } from '@tzurot/common-types/services/LlmConfigMapper';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { getConfig } from '@tzurot/common-types/config/config';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@tzurot/common-types/utils/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/utils/logger')>();
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

vi.mock('@tzurot/common-types/config/config', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/config/config')>();
  return {
    ...actual,
    getConfig: vi.fn().mockReturnValue({ BOT_OWNER_ID: undefined }),
  };
});
vi.mock('@tzurot/common-types/utils/ownerMiddleware', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@tzurot/common-types/utils/ownerMiddleware')>();
  return {
    ...actual,
    isBotOwner: vi.fn().mockReturnValue(false),
  };
});
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
    // Default: requester is not the bot owner; owner-path tests opt in.
    vi.mocked(isBotOwner).mockReturnValue(false);
    mockLogger.debug.mockClear();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();

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
        findUnique: vi.fn(),
      },
      adminSettings: {
        findUnique: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
      },
    } as unknown as PrismaClient;

    loader = new PersonalityLoader(mockPrisma);
  });

  describe('query select shape (the persisted wire contract)', () => {
    it('requests exactly the personality fields the mapper consumes', async () => {
      vi.mocked(mockPrisma.personality.findFirst).mockResolvedValueOnce(null);
      vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([]);

      await loader.loadFromDatabase('00000000-0000-0000-0000-000000000001');

      const select = vi.mocked(mockPrisma.personality.findFirst).mock.calls[0][0]?.select;
      // Full-equality pin: dropping ANY field silently feeds undefined into
      // the loaded personality downstream (select shapes are invisible to
      // result-mocked unit tests otherwise).
      expect(select).toEqual({
        id: true,
        name: true,
        displayName: true,
        slug: true,
        isPublic: true,
        ownerId: true,
        createdAt: true,
        updatedAt: true,
        characterInfo: true,
        personalityTraits: true,
        personalityTone: true,
        personalityAge: true,
        personalityAppearance: true,
        personalityLikes: true,
        personalityDislikes: true,
        conversationalGoals: true,
        conversationalExamples: true,
        errorMessage: true,
        voiceEnabled: true,
        systemPrompt: { select: { content: true } },
        defaultConfigLink: { select: { llmConfig: { select: LLM_CONFIG_SELECT } } },
      });
    });
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

        // Verify alias query — internal call (no userId) queries the GLOBAL
        // tier only (userId: null); no personal-tier lookup happens.
        expect(vi.mocked(mockPrisma.personalityAlias.findFirst)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(mockPrisma.personalityAlias.findFirst)).toHaveBeenCalledWith({
          where: {
            alias: { equals: 'lilith', mode: 'insensitive' },
            userId: null,
          },
          select: { personalityId: true },
        });
      });

      it('checks the requesting user personal aliases BEFORE global rows', async () => {
        const mockPersonality = createMockPersonality({ id: 'personal-target', name: 'Mine' });

        // User exists (uuid resolution for BOTH the access filter and the
        // personal-alias tier).
        vi.mocked(mockPrisma.user.findUnique).mockResolvedValue({ id: 'user-uuid-1' } as any);
        // Name/slug lookup misses.
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([]);
        // Personal-tier alias hits on the FIRST alias query.
        vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValueOnce({
          personalityId: 'personal-target',
        } as any);
        vi.mocked(mockPrisma.personality.findFirst).mockResolvedValueOnce(mockPersonality as any);

        const result = await loader.loadFromDatabase('mommy', '123456789012345678');

        expect(result?.id).toBe('personal-target');
        // Exactly one alias query: the personal tier short-circuits global.
        expect(vi.mocked(mockPrisma.personalityAlias.findFirst)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(mockPrisma.personalityAlias.findFirst)).toHaveBeenCalledWith({
          where: {
            alias: { equals: 'mommy', mode: 'insensitive' },
            userId: 'user-uuid-1',
          },
          select: { personalityId: true },
        });
        // Perf regression pin: a regular user's uuid feeds BOTH the access
        // filter and the personal-alias tier from ONE users lookup.
        expect(vi.mocked(mockPrisma.user.findUnique)).toHaveBeenCalledTimes(1);
      });

      it('resolves the BOT OWNER΄s personal aliases via the lazy alias-step lookup', async () => {
        const BOT_OWNER_DISCORD_ID = '999999999999999999';
        vi.mocked(isBotOwner).mockReturnValue(true);
        const mockPersonality = createMockPersonality({ id: 'owner-personal', name: 'Mine' });

        // Bot owner: access resolution is a no-lookup bypass, so the ONLY
        // user lookup happens lazily at the alias step.
        vi.mocked(mockPrisma.user.findUnique).mockResolvedValue({ id: 'owner-uuid' } as any);
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([]);
        vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValueOnce({
          personalityId: 'owner-personal',
        } as any);
        vi.mocked(mockPrisma.personality.findFirst).mockResolvedValueOnce(mockPersonality as any);

        const result = await loader.loadFromDatabase('mommy', BOT_OWNER_DISCORD_ID);

        expect(result?.id).toBe('owner-personal');
        // The personal tier queried with the OWNER's uuid — the bypass that
        // skips the access filter must NOT skip personal-alias resolution.
        expect(vi.mocked(mockPrisma.personalityAlias.findFirst)).toHaveBeenCalledWith({
          where: {
            alias: { equals: 'mommy', mode: 'insensitive' },
            userId: 'owner-uuid',
          },
          select: { personalityId: true },
        });
        // Exactly one user lookup, and only at the alias step.
        expect(vi.mocked(mockPrisma.user.findUnique)).toHaveBeenCalledTimes(1);
      });

      it('treats an EMPTY-STRING userId as an internal call: no user lookup, global tier only', async () => {
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([]);
        vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValue(null);

        await loader.loadFromDatabase('mommy', '');

        expect(vi.mocked(mockPrisma.user.findUnique)).not.toHaveBeenCalled();
        // Only the GLOBAL tier is consulted — no personal rows can exist.
        expect(vi.mocked(mockPrisma.personalityAlias.findFirst)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(mockPrisma.personalityAlias.findFirst)).toHaveBeenCalledWith({
          where: {
            alias: { equals: 'mommy', mode: 'insensitive' },
            userId: null,
          },
          select: { personalityId: true },
        });
      });

      it('falls through to the GLOBAL tier when the personal alias points at an inaccessible personality', async () => {
        const globalTarget = createMockPersonality({ id: 'global-target', name: 'Public' });

        vi.mocked(mockPrisma.user.findUnique).mockResolvedValue({ id: 'user-uuid-1' } as any);
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([]);
        // Personal alias exists…
        vi.mocked(mockPrisma.personalityAlias.findFirst)
          .mockResolvedValueOnce({ personalityId: 'now-private' } as any)
          // …global alias also exists.
          .mockResolvedValueOnce({ personalityId: 'global-target' } as any);
        // Personal target fails the access filter (null), global target loads.
        vi.mocked(mockPrisma.personality.findFirst)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(globalTarget as any);

        const result = await loader.loadFromDatabase('mommy', '123456789012345678');

        expect(result?.id).toBe('global-target');
        expect(vi.mocked(mockPrisma.personalityAlias.findFirst)).toHaveBeenCalledTimes(2);
        // Second call is the global tier.
        expect(vi.mocked(mockPrisma.personalityAlias.findFirst)).toHaveBeenNthCalledWith(2, {
          where: {
            alias: { equals: 'mommy', mode: 'insensitive' },
            userId: null,
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

      it('logs a debug line naming the input when every tier misses', async () => {
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([]);
        vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValueOnce(null);

        const result = await loader.loadFromDatabase('nonexistent');

        expect(result).toBeNull();
        expect(mockLogger.debug).toHaveBeenCalledWith(
          { nameOrId: 'nonexistent' },
          'Personality not found'
        );
      });
    });

    describe('resolveBotOwnerAliasUuid guard', () => {
      it('skips the owner user lookup when userId is undefined even if isBotOwner returns true', async () => {
        vi.mocked(isBotOwner).mockReturnValue(true);
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([]);
        vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValueOnce(null);

        await loader.loadFromDatabase('mommy');

        expect(vi.mocked(mockPrisma.user.findUnique)).not.toHaveBeenCalled();
      });

      it('skips the owner user lookup when userId is an empty string even if isBotOwner returns true', async () => {
        vi.mocked(isBotOwner).mockReturnValue(true);
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([]);
        vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValueOnce(null);

        await loader.loadFromDatabase('mommy', '');

        expect(vi.mocked(mockPrisma.user.findUnique)).not.toHaveBeenCalled();
      });

      it('does not perform a second user lookup for a regular user with no database row', async () => {
        vi.mocked(isBotOwner).mockReturnValue(false);
        vi.mocked(mockPrisma.user.findUnique).mockResolvedValueOnce(null);
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([]);
        vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValueOnce(null);

        await loader.loadFromDatabase('mommy', 'discord-user-1');

        expect(vi.mocked(mockPrisma.user.findUnique)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(mockPrisma.personalityAlias.findFirst)).toHaveBeenCalledTimes(1);
      });
    });

    describe('resolveBotOwnerAliasUuid query seam', () => {
      it('queries the owner lazy alias lookup by discordId selecting only id', async () => {
        vi.mocked(isBotOwner).mockReturnValue(true);
        vi.mocked(mockPrisma.user.findUnique).mockResolvedValueOnce({ id: 'owner-uuid' } as any);
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([]);
        // Not `Once`: an owner with a resolved uuid reaches BOTH alias tiers,
        // so this path makes two findFirst calls. A single Once would leave the
        // second on the bare vi.fn()'s `undefined`, which the `!aliasMatch`
        // guard happens to treat like null — passing on incidental behavior.
        vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValue(null);

        await loader.loadFromDatabase('mommy', '999999999999999999');

        expect(vi.mocked(mockPrisma.user.findUnique)).toHaveBeenCalledWith({
          where: { discordId: '999999999999999999' },
          select: { id: true },
        });
      });
    });

    describe('optional-chained owner uuid in resolveBotOwnerAliasUuid', () => {
      it('resolves via the global alias tier when the bot owner has no database row', async () => {
        const globalTarget = createMockPersonality({ id: 'global-target', name: 'Mommy' });
        vi.mocked(isBotOwner).mockReturnValue(true);
        vi.mocked(mockPrisma.user.findUnique).mockResolvedValueOnce(null);
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([]);
        vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValueOnce({
          personalityId: 'global-target',
        } as any);
        vi.mocked(mockPrisma.personality.findFirst).mockResolvedValueOnce(globalTarget as any);

        const result = await loader.loadFromDatabase('mommy', '999999999999999999');

        expect(result?.id).toBe('global-target');
      });
    });

    describe('findPersonalityViaAlias not-found guard', () => {
      it('falls through to the global tier when the personal alias tier has no match', async () => {
        const globalTarget = createMockPersonality({ id: 'global-target', name: 'Mommy' });
        vi.mocked(mockPrisma.user.findUnique).mockResolvedValueOnce({ id: 'user-uuid-1' } as any);
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([]);
        vi.mocked(mockPrisma.personalityAlias.findFirst)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ personalityId: 'global-target' } as any);
        vi.mocked(mockPrisma.personality.findFirst).mockResolvedValueOnce(globalTarget as any);

        const result = await loader.loadFromDatabase('mommy', 'discord-user-1');

        expect(result?.id).toBe('global-target');
        expect(vi.mocked(mockPrisma.personalityAlias.findFirst)).toHaveBeenCalledTimes(2);
      });
    });

    describe('alias tier label reaching the debug log', () => {
      it('logs tier: personal on a personal-tier alias hit', async () => {
        const mockPersonality = createMockPersonality({ id: 'personal-target', name: 'Mine' });
        vi.mocked(mockPrisma.user.findUnique).mockResolvedValueOnce({ id: 'user-uuid-1' } as any);
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([]);
        vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValueOnce({
          personalityId: 'personal-target',
        } as any);
        vi.mocked(mockPrisma.personality.findFirst).mockResolvedValueOnce(mockPersonality as any);

        await loader.loadFromDatabase('mommy', 'discord-user-1');

        expect(mockLogger.debug).toHaveBeenCalledWith(
          expect.objectContaining({ tier: 'personal' }),
          '[PersonalityLoader] Found personality via alias'
        );
      });

      it('logs tier: global on a global-tier alias hit', async () => {
        const mockPersonality = createMockPersonality({ id: 'global-target', name: 'Lilith' });
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([]);
        vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValueOnce({
          personalityId: 'global-target',
        } as any);
        vi.mocked(mockPrisma.personality.findFirst).mockResolvedValueOnce(mockPersonality as any);

        await loader.loadFromDatabase('lilith');

        expect(mockLogger.debug).toHaveBeenCalledWith(
          expect.objectContaining({ tier: 'global' }),
          '[PersonalityLoader] Found personality via alias'
        );
      });
    });

    describe('accessFilter spread into the alias personality query', () => {
      it('applies no access filter to an internal alias lookup (single-element AND)', async () => {
        const mockPersonality = createMockPersonality({ id: 'global-target', name: 'Lilith' });
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([]);
        vi.mocked(mockPrisma.personalityAlias.findFirst).mockResolvedValueOnce({
          personalityId: 'global-target',
        } as any);
        vi.mocked(mockPrisma.personality.findFirst).mockResolvedValueOnce(mockPersonality as any);

        await loader.loadFromDatabase('lilith');

        expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledWith({
          where: { AND: [{ id: 'global-target' }] },
          select: expect.any(Object),
        });
      });
    });

    describe('alias matched but personality inaccessible', () => {
      it('logs the fall-through debug line', async () => {
        const globalTarget = createMockPersonality({ id: 'global-target', name: 'Public' });
        vi.mocked(mockPrisma.user.findUnique).mockResolvedValue({ id: 'user-uuid-1' } as any);
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([]);
        vi.mocked(mockPrisma.personalityAlias.findFirst)
          .mockResolvedValueOnce({ personalityId: 'now-private' } as any)
          .mockResolvedValueOnce({ personalityId: 'global-target' } as any);
        vi.mocked(mockPrisma.personality.findFirst)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(globalTarget as any);

        await loader.loadFromDatabase('mommy', '123456789012345678');

        expect(mockLogger.debug).toHaveBeenCalledWith(
          expect.anything(),
          '[PersonalityLoader] Alias matched but personality inaccessible — falling through'
        );
      });
    });

    describe('accessFilter spread in the UUID branch', () => {
      it('carries the access filter for a regular user UUID lookup', async () => {
        const mockPersonality = createMockPersonality({
          id: '00000000-0000-0000-0000-000000000001',
          name: 'PrivateBot',
          isPublic: false,
          ownerId: 'user-uuid-9',
        });
        vi.mocked(mockPrisma.user.findUnique).mockResolvedValueOnce({ id: 'user-uuid-9' } as any);
        vi.mocked(mockPrisma.personality.findFirst).mockResolvedValueOnce(mockPersonality as any);

        await loader.loadFromDatabase('00000000-0000-0000-0000-000000000001', 'discord-user-9');

        expect(vi.mocked(mockPrisma.personality.findFirst)).toHaveBeenCalledWith({
          where: {
            AND: [
              { id: '00000000-0000-0000-0000-000000000001' },
              { OR: [{ isPublic: true }, { ownerId: 'user-uuid-9' }] },
            ],
          },
          select: expect.any(Object),
        });
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

      // On the CORRECT path, scoring never runs: the name filter leaves one
      // match and `nameMatches.length === 1` returns it directly. The slug row
      // is public (and so higher-scoring) for the mutated path — drop the name
      // filter and both rows reach pickBestCandidate, where the public slug row
      // wins. That asymmetry is what makes this test able to fail.
      it('prefers a name match over a HIGHER-SCORING slug match (name filter must not be dropped)', async () => {
        const nameRow = createMockPersonality({
          id: 'name-row',
          name: 'Lilith',
          slug: 'lilith-proper',
          isPublic: false,
          ownerId: 'other-owner',
        });
        const slugRow = createMockPersonality({
          id: 'slug-row',
          name: 'Alpha',
          slug: 'lilith',
          isPublic: true,
          ownerId: 'other-owner',
        });

        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([nameRow, slugRow] as any);
        vi.mocked(getConfig).mockReturnValue({ BOT_OWNER_ID: undefined } as any);

        const result = await loader.loadFromDatabase('Lilith');

        expect(result?.id).toBe('name-row');
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
        vi.mocked(getConfig).mockReturnValue({ BOT_OWNER_ID: undefined } as any);

        const result = await loader.loadFromDatabase('Lilith');

        expect(result).not.toBeNull();
        expect(result?.id).toBe('public-newer');
      });

      it('breaks equal-score ties by oldest createdAt', async () => {
        const newer = createMockPersonality({
          id: 'public-newer',
          name: 'Lilith',
          slug: 'lilith-newer',
          isPublic: true,
          ownerId: OTHER_OWNER,
          createdAt: new Date('2026-02-01T00:00:00Z'),
        });
        const older = createMockPersonality({
          id: 'public-older',
          name: 'Lilith',
          slug: 'lilith-older',
          isPublic: true,
          ownerId: OTHER_OWNER,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        });

        // Same score (both public, neither admin-owned): the OLDER row wins,
        // regardless of array order (newer listed first here).
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([newer, older] as any);
        vi.mocked(getConfig).mockReturnValue({ BOT_OWNER_ID: undefined } as any);

        const result = await loader.loadFromDatabase('Lilith');

        expect(result?.id).toBe('public-older');
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
        vi.mocked(getConfig).mockReturnValue({
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

        vi.mocked(getConfig).mockReturnValue({
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

        vi.mocked(getConfig).mockReturnValue({ BOT_OWNER_ID: undefined } as any);

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
        vi.mocked(getConfig).mockReturnValue({
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

        vi.mocked(getConfig).mockReturnValue({
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
        vi.mocked(getConfig).mockReturnValue({
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

      it('does not let a lower-scoring but OLDER candidate displace the best (diff < 0 early return)', async () => {
        const publicNewer = createMockPersonality({
          id: 'public-newer',
          name: 'Lilith',
          slug: 'lilith-public-newer',
          isPublic: true,
          ownerId: 'owner-a',
          createdAt: new Date('2026-02-01T00:00:00Z'),
        });
        const privateOlder = createMockPersonality({
          id: 'private-older',
          name: 'Lilith',
          slug: 'lilith-private-older',
          isPublic: false,
          ownerId: 'owner-b',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        });

        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([
          publicNewer,
          privateOlder,
        ] as any);
        vi.mocked(getConfig).mockReturnValue({ BOT_OWNER_ID: undefined } as any);

        const result = await loader.loadFromDatabase('Lilith');

        expect(result?.id).toBe('public-newer');
      });

      it('picks the FIRST candidate when two equal-score matches share an identical createdAt', async () => {
        const first = createMockPersonality({
          id: 'first-tied',
          name: 'Lilith',
          slug: 'lilith-first-tied',
          isPublic: true,
          ownerId: 'owner-a',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        });
        const second = createMockPersonality({
          id: 'second-tied',
          name: 'Lilith',
          slug: 'lilith-second-tied',
          isPublic: true,
          ownerId: 'owner-b',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        });

        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([first, second] as any);
        vi.mocked(getConfig).mockReturnValue({ BOT_OWNER_ID: undefined } as any);

        const result = await loader.loadFromDatabase('Lilith');

        expect(result?.id).toBe('first-tied');
      });

      it('should retry admin UUID lookup after transient failure', async () => {
        vi.mocked(getConfig).mockReturnValue({
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

    describe('resolveBotAdminUuid config guard', () => {
      // Deliberately does NOT claim to pin the `botAdminUuid = null` cache
      // write: with the config unset on both calls, the second one takes the
      // same no-lookup branch whether or not the write happened, so the two
      // are observationally identical here. The cache write itself is pinned
      // by 'should cache bot admin UUID across multiple calls'.
      it('performs no admin lookup when BOT_OWNER_ID is unset, on a repeat collision too', async () => {
        vi.mocked(getConfig).mockReturnValue({ BOT_OWNER_ID: undefined } as any);

        const matchA1 = createMockPersonality({ id: 'a1', name: 'Lilith', slug: 'lilith-a1' });
        const matchA2 = createMockPersonality({ id: 'a2', name: 'Lilith', slug: 'lilith-a2' });
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([matchA1, matchA2] as any);
        await loader.loadFromDatabase('Lilith');

        expect(vi.mocked(mockPrisma.user.findUnique)).not.toHaveBeenCalled();

        const matchB1 = createMockPersonality({ id: 'b1', name: 'Eve', slug: 'eve-b1' });
        const matchB2 = createMockPersonality({ id: 'b2', name: 'Eve', slug: 'eve-b2' });
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([matchB1, matchB2] as any);
        await loader.loadFromDatabase('Eve');

        expect(vi.mocked(mockPrisma.user.findUnique)).not.toHaveBeenCalled();
      });

      it('performs no admin lookup when BOT_OWNER_ID is an empty string', async () => {
        vi.mocked(getConfig).mockReturnValue({ BOT_OWNER_ID: '' } as any);

        const matchA1 = createMockPersonality({ id: 'a1', name: 'Lilith', slug: 'lilith-a1' });
        const matchA2 = createMockPersonality({ id: 'a2', name: 'Lilith', slug: 'lilith-a2' });
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([matchA1, matchA2] as any);

        await loader.loadFromDatabase('Lilith');

        expect(vi.mocked(mockPrisma.user.findUnique)).not.toHaveBeenCalled();
      });
    });

    describe('resolveBotAdminUuid admin-not-found', () => {
      it('does not warn and does not cache when the configured admin is absent from the database', async () => {
        vi.mocked(getConfig).mockReturnValue({ BOT_OWNER_ID: 'discord-admin-id' } as any);
        vi.mocked(mockPrisma.user.findUnique).mockResolvedValue(null);

        const matchA1 = createMockPersonality({ id: 'a1', name: 'Lilith', slug: 'lilith-a1' });
        const matchA2 = createMockPersonality({ id: 'a2', name: 'Lilith', slug: 'lilith-a2' });
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([matchA1, matchA2] as any);
        await loader.loadFromDatabase('Lilith');

        const matchB1 = createMockPersonality({ id: 'b1', name: 'Eve', slug: 'eve-b1' });
        const matchB2 = createMockPersonality({ id: 'b2', name: 'Eve', slug: 'eve-b2' });
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([matchB1, matchB2] as any);
        await loader.loadFromDatabase('Eve');

        expect(mockLogger.warn).not.toHaveBeenCalled();
        expect(vi.mocked(mockPrisma.user.findUnique)).toHaveBeenCalledTimes(2);
      });
    });

    describe('resolveBotAdminUuid catch block', () => {
      it('warns with the expected message on an admin-lookup database error', async () => {
        vi.mocked(getConfig).mockReturnValue({ BOT_OWNER_ID: 'discord-admin-id' } as any);
        vi.mocked(mockPrisma.user.findUnique).mockRejectedValueOnce(
          new Error('Connection refused')
        );

        const matchA1 = createMockPersonality({ id: 'a1', name: 'Lilith', slug: 'lilith-a1' });
        const matchA2 = createMockPersonality({ id: 'a2', name: 'Lilith', slug: 'lilith-a2' });
        vi.mocked(mockPrisma.personality.findMany).mockResolvedValueOnce([matchA1, matchA2] as any);

        await loader.loadFromDatabase('Lilith');

        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.anything(),
          '[PersonalityLoader] Failed to resolve bot admin UUID, skipping admin preference'
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
        vi.mocked(isBotOwner).mockReturnValueOnce(true);

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
    const mockConfig = {
      model: 'global-model',
      provider: 'openrouter',
      temperature: 0.7,
      topP: null,
      topK: null,
      frequencyPenalty: null,
      presencePenalty: null,
      maxTokens: 4096,
      contextWindowTokens: 200000,
    };

    it('should load the global default via the AdminSettings pointer relation (not the isDefault column)', async () => {
      vi.mocked(mockPrisma.adminSettings.findUnique).mockResolvedValue({
        globalDefaultLlmConfig: mockConfig,
      } as any);

      const result = await loader.loadGlobalDefaultConfig();

      expect(result).not.toBeNull();
      expect(result?.model).toBe('global-model');
      // One nested-select query on the pointer relation — never the stale isDefault
      // column (no findFirst) and no separate config round-trip (no findUnique).
      expect(vi.mocked(mockPrisma.adminSettings.findUnique)).toHaveBeenCalledWith(
        expect.objectContaining({
          select: { globalDefaultLlmConfig: { select: expect.any(Object) } },
        })
      );
      expect(vi.mocked(mockPrisma.llmConfig.findFirst)).not.toHaveBeenCalled();
      expect(vi.mocked(mockPrisma.llmConfig.findUnique)).not.toHaveBeenCalled();
    });

    it('should return null when no global default is set (null pointer relation)', async () => {
      // onDelete:SetNull means a deleted target also surfaces as a null relation,
      // so "unset" and "target gone" collapse to the same null case.
      vi.mocked(mockPrisma.adminSettings.findUnique).mockResolvedValue({
        globalDefaultLlmConfig: null,
      } as any);

      const result = await loader.loadGlobalDefaultConfig();

      expect(result).toBeNull();
    });

    it('queries the AdminSettings singleton row by id', async () => {
      vi.mocked(mockPrisma.adminSettings.findUnique).mockResolvedValue({
        globalDefaultLlmConfig: mockConfig,
      } as any);

      await loader.loadGlobalDefaultConfig();

      expect(vi.mocked(mockPrisma.adminSettings.findUnique)).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ADMIN_SETTINGS_SINGLETON_ID } })
      );
    });

    it('should return null when the AdminSettings row itself is absent (fresh DB)', async () => {
      // Bootstrap scenario — no AdminSettings singleton yet. The `settings?.…`
      // optional chain short-circuits to null, same as an unset pointer.
      vi.mocked(mockPrisma.adminSettings.findUnique).mockResolvedValue(null);

      const result = await loader.loadGlobalDefaultConfig();

      expect(result).toBeNull();
    });

    it('treats an absent AdminSettings row as an unset pointer, not as a load failure', async () => {
      vi.mocked(mockPrisma.adminSettings.findUnique).mockResolvedValue(null);

      const result = await loader.loadGlobalDefaultConfig();

      expect(result).toBeNull();
      // Asserting the whole call list, not `not.toHaveBeenCalledWith(...)`: the
      // failure path warns with two args (`{ err }, message`) while this path
      // warns with one, so a two-arg negative matcher can never match either
      // call and would pass whatever the code did.
      expect(mockLogger.warn.mock.calls).toEqual([
        ['[PersonalityLoader] No global default LLM config set'],
      ]);
    });

    it('warns that no global default is set when the pointer is unset', async () => {
      vi.mocked(mockPrisma.adminSettings.findUnique).mockResolvedValue({
        globalDefaultLlmConfig: null,
      } as any);

      const result = await loader.loadGlobalDefaultConfig();

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[PersonalityLoader] No global default LLM config set'
      );
    });

    it('should handle database errors gracefully', async () => {
      vi.mocked(mockPrisma.adminSettings.findUnique).mockRejectedValue(
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
