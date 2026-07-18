/**
 * Tests for the tiered alias routes: list / add / remove
 * (/user/personality/:slug/aliases) and the cross-character overview
 * (/user/personality/my-aliases).
 *
 * Policy under test: all verbs visibility-gated (invisible == missing ==
 * 404); global writes bot-owner-only; user-scoped writes for any caller on
 * any visible character; list returns global rows + the caller's own only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generatePersonalityAliasUuid,
  generateUserPersonalityAliasUuid,
} from '@tzurot/common-types/utils/deterministicUuid';
import { Prisma } from '@tzurot/common-types/services/prisma';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createMockReqRes, MOCK_USER_ID, mockIsBotOwner } from './test-utils.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

vi.mock('../../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

// The real canUserViewPersonality chain runs over the mocked prisma
// (helpers.ts calls its own exports internally, so export-level mocks can't
// intercept). Only the bot-owner env check is stubbed, per the sibling test
// convention.
vi.mock('@tzurot/common-types/utils/ownerMiddleware', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/ownerMiddleware')>(
    '@tzurot/common-types/utils/ownerMiddleware'
  );
  const { mockIsBotOwner: mockFn } = await import('./test-utils.js');
  return {
    ...actual,
    isBotOwner: (...args: unknown[]) => (mockFn as (...args: unknown[]) => boolean)(...args),
  };
});

import {
  handleListPersonalityAliases,
  handleAddPersonalityAlias,
  handleRemovePersonalityAlias,
  handleListMyAliases,
} from './aliases.js';
import type { RouteDeps } from '../../routeDeps.js';

// Owned by the requester (private) — visible via ownership.
const PERSONALITY = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  slug: 'lila-elyona',
  ownerId: MOCK_USER_ID,
  isPublic: false,
};
const OTHER_OWNER_ID = 'c1d2e3f4-0000-4000-8000-000000000002';
const CREATED_AT = new Date('2026-07-17T00:00:00.000Z');

const mockPrisma = {
  personality: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  personalityOwner: { findUnique: vi.fn() },
  personalityAlias: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
};

const mockInvalidate = vi.fn();

function deps(): RouteDeps {
  return {
    prisma: mockPrisma as unknown as PrismaClient,
    cacheInvalidationService: {
      invalidatePersonality: (...args: unknown[]) => mockInvalidate(...args),
    },
  } as unknown as RouteDeps;
}

describe('personality alias routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.personality.findUnique.mockResolvedValue(PERSONALITY);
    mockPrisma.personalityOwner.findUnique.mockResolvedValue(null);
    mockPrisma.personalityAlias.count.mockResolvedValue(0);
    mockIsBotOwner.mockReturnValue(false);
    mockInvalidate.mockResolvedValue(undefined);
  });

  describe('GET list (visibility-gated)', () => {
    it('404s on an unknown slug', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue(null);
      const { req, res } = createMockReqRes({}, { slug: 'ghost' });

      await handleListPersonalityAliases(deps())(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
      expect(mockPrisma.personalityAlias.findMany).not.toHaveBeenCalled();
    });

    it('404s (not 403) for an INVISIBLE character — existence never leaks', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        ...PERSONALITY,
        ownerId: OTHER_OWNER_ID,
        isPublic: false,
      });
      const { req, res } = createMockReqRes({}, { slug: PERSONALITY.slug });

      await handleListPersonalityAliases(deps())(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
      // Seam: co-ownership was actually consulted before denying.
      expect(mockPrisma.personalityOwner.findUnique).toHaveBeenCalledWith({
        where: {
          personalityId_userId: { personalityId: PERSONALITY.id, userId: MOCK_USER_ID },
        },
      });
      expect(mockPrisma.personalityAlias.findMany).not.toHaveBeenCalled();
    });

    it('serves a PUBLIC character to a non-editor: global rows + own rows only, scope-tagged', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        ...PERSONALITY,
        ownerId: OTHER_OWNER_ID,
        isPublic: true,
      });
      mockPrisma.personalityAlias.findMany.mockResolvedValue([
        { alias: 'lila', userId: null, createdAt: CREATED_AT },
        { alias: 'mine', userId: MOCK_USER_ID, createdAt: CREATED_AT },
      ]);
      const { req, res } = createMockReqRes({}, { slug: PERSONALITY.slug });

      await handleListPersonalityAliasesDeps(req, res);

      // Seam: the query itself excludes other users' personal rows.
      expect(mockPrisma.personalityAlias.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            personalityId: PERSONALITY.id,
            OR: [{ userId: null }, { userId: MOCK_USER_ID }],
          },
          orderBy: { alias: 'asc' },
        })
      );
      expect(res.json).toHaveBeenCalledWith({
        aliases: [
          { alias: 'lila', scope: 'global', createdAt: '2026-07-17T00:00:00.000Z' },
          { alias: 'mine', scope: 'user', createdAt: '2026-07-17T00:00:00.000Z' },
        ],
        truncated: false,
      });
    });

    it('flags truncation when rows exceed the read cap', async () => {
      mockPrisma.personalityAlias.findMany.mockResolvedValue(
        Array.from({ length: 101 }, (_, index) => ({
          alias: `alias-${String(index).padStart(3, '0')}`,
          userId: null,
          createdAt: CREATED_AT,
        }))
      );
      const { req, res } = createMockReqRes({}, { slug: PERSONALITY.slug });

      await handleListPersonalityAliasesDeps(req, res);

      const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
        aliases: unknown[];
        truncated: boolean;
      };
      expect(payload.truncated).toBe(true);
      expect(payload.aliases).toHaveLength(100);
    });

    async function handleListPersonalityAliasesDeps(
      req: Parameters<ReturnType<typeof handleListPersonalityAliases>>[0],
      res: Parameters<ReturnType<typeof handleListPersonalityAliases>>[1]
    ): Promise<void> {
      await handleListPersonalityAliases(deps())(req, res, vi.fn());
    }
  });

  describe('POST add — user tier (default)', () => {
    it('creates a PERSONAL alias on a visible character with the user-scoped id', async () => {
      // Public character owned by someone else — visible, not editable.
      mockPrisma.personality.findUnique.mockResolvedValue({
        ...PERSONALITY,
        ownerId: OTHER_OWNER_ID,
        isPublic: true,
      });
      mockPrisma.personality.findFirst.mockResolvedValue(null);
      mockPrisma.personalityAlias.create.mockResolvedValue({
        alias: 'Mommy',
        userId: MOCK_USER_ID,
        createdAt: CREATED_AT,
      });
      const { req, res } = createMockReqRes({ alias: 'Mommy' }, { slug: PERSONALITY.slug });

      await handleAddPersonalityAlias(deps())(req, res, vi.fn());

      expect(mockPrisma.personalityAlias.create).toHaveBeenCalledWith({
        data: {
          id: generateUserPersonalityAliasUuid(MOCK_USER_ID, 'mommy'),
          alias: 'Mommy',
          personalityId: PERSONALITY.id,
          userId: MOCK_USER_ID,
        },
      });
      expect(res.status).toHaveBeenCalledWith(201);
      const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
        alias: { scope: string };
      };
      expect(payload.alias.scope).toBe('user');
      // Routing caches must drop eagerly — alias add changes name resolution.
      expect(mockInvalidate).toHaveBeenCalledWith(PERSONALITY.id);
    });

    it('shadow-checks against the CALLER-visible scope and discloses nothing', async () => {
      mockPrisma.personality.findFirst.mockResolvedValue({ id: 'shadow-id' });
      const { req, res } = createMockReqRes({ alias: 'Sapphomet' }, { slug: PERSONALITY.slug });

      await handleAddPersonalityAlias(deps())(req, res, vi.fn());

      // Seam: the shadow probe must use the resolver's own predicates —
      // case-insensitive name / lowercased slug — AND its public-or-owned
      // access scope, so an invisible private character can't be probed.
      expect(mockPrisma.personality.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              {
                OR: [{ name: { equals: 'Sapphomet', mode: 'insensitive' } }, { slug: 'sapphomet' }],
              },
              { OR: [{ isPublic: true }, { ownerId: MOCK_USER_ID }] },
            ],
          },
        })
      );
      expect(res.status).toHaveBeenCalledWith(400);
      const body = JSON.stringify((res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
      expect(body).not.toContain('shadow-id');
      expect(body).toContain('matches an existing character');
      expect(mockPrisma.personalityAlias.create).not.toHaveBeenCalled();
      expect(mockInvalidate).not.toHaveBeenCalled();
    });

    it('rejects at the per-user cap, counting the CALLER΄s rows across characters', async () => {
      mockPrisma.personality.findFirst.mockResolvedValue(null);
      mockPrisma.personalityAlias.count.mockResolvedValue(25);
      const { req, res } = createMockReqRes({ alias: 'one-more' }, { slug: PERSONALITY.slug });

      await handleAddPersonalityAlias(deps())(req, res, vi.fn());

      expect(mockPrisma.personalityAlias.count).toHaveBeenCalledWith({
        where: { userId: MOCK_USER_ID },
      });
      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockPrisma.personalityAlias.create).not.toHaveBeenCalled();
    });

    it('maps the tier unique-constraint violation to a 409 conflict', async () => {
      mockPrisma.personality.findFirst.mockResolvedValue(null);
      mockPrisma.personalityAlias.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('taken', {
          code: 'P2002',
          clientVersion: 'test',
        })
      );
      const { req, res } = createMockReqRes({ alias: 'taken' }, { slug: PERSONALITY.slug });

      await handleAddPersonalityAlias(deps())(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('still returns 201 when cache invalidation throws', async () => {
      mockInvalidate.mockRejectedValue(new Error('redis down'));
      mockPrisma.personality.findFirst.mockResolvedValue(null);
      mockPrisma.personalityAlias.create.mockResolvedValue({
        alias: 'Li',
        userId: MOCK_USER_ID,
        createdAt: CREATED_AT,
      });
      const { req, res } = createMockReqRes({ alias: 'Li' }, { slug: PERSONALITY.slug });

      await handleAddPersonalityAlias(deps())(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('rejects an alias containing @ at the schema boundary', async () => {
      const { req, res } = createMockReqRes({ alias: '@lila' }, { slug: PERSONALITY.slug });

      await handleAddPersonalityAlias(deps())(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockPrisma.personality.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('POST add — global tier (bot-owner only)', () => {
    it('403s a non-bot-owner before touching anything', async () => {
      const { req, res } = createMockReqRes(
        { alias: 'Lila', scope: 'global' },
        { slug: PERSONALITY.slug }
      );

      await handleAddPersonalityAlias(deps())(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockPrisma.personality.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.personalityAlias.create).not.toHaveBeenCalled();
    });

    it('lets the bot owner create a GLOBAL row (null userId, global id, unscoped shadow check)', async () => {
      mockIsBotOwner.mockReturnValue(true);
      mockPrisma.personality.findFirst.mockResolvedValue(null);
      mockPrisma.personalityAlias.create.mockResolvedValue({
        alias: 'Lila',
        userId: null,
        createdAt: CREATED_AT,
      });
      const { req, res } = createMockReqRes(
        { alias: 'Lila', scope: 'global' },
        { slug: PERSONALITY.slug }
      );

      await handleAddPersonalityAlias(deps())(req, res, vi.fn());

      // A global alias resolves for EVERYONE, so the shadow probe is
      // unscoped — any character name/slug kills it for someone.
      expect(mockPrisma.personality.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [{ name: { equals: 'Lila', mode: 'insensitive' } }, { slug: 'lila' }],
          },
        })
      );
      // The cap counts THIS character's global rows, not the caller's.
      expect(mockPrisma.personalityAlias.count).toHaveBeenCalledWith({
        where: { personalityId: PERSONALITY.id, userId: null },
      });
      expect(mockPrisma.personalityAlias.create).toHaveBeenCalledWith({
        data: {
          id: generatePersonalityAliasUuid('lila'),
          alias: 'Lila',
          personalityId: PERSONALITY.id,
          userId: null,
        },
      });
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe('DELETE remove', () => {
    it('defaults to the USER tier: removes only the caller΄s own row', async () => {
      mockPrisma.personalityAlias.findFirst.mockResolvedValue({
        id: 'row-1',
        alias: 'lila',
        userId: MOCK_USER_ID,
      });
      mockPrisma.personalityAlias.delete.mockResolvedValue({});
      const { req, res } = createMockReqRes({}, { slug: PERSONALITY.slug, alias: 'LILA' });

      await handleRemovePersonalityAlias(deps())(req, res, vi.fn());

      expect(mockPrisma.personalityAlias.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            personalityId: PERSONALITY.id,
            alias: { equals: 'LILA', mode: 'insensitive' },
            userId: MOCK_USER_ID,
          },
        })
      );
      expect(mockPrisma.personalityAlias.delete).toHaveBeenCalledWith({ where: { id: 'row-1' } });
      expect(res.json).toHaveBeenCalledWith({ removedAlias: 'lila', removedScope: 'user' });
      expect(mockInvalidate).toHaveBeenCalledWith(PERSONALITY.id);
    });

    it('403s a non-bot-owner asking for the global tier', async () => {
      const { req, res } = createMockReqRes(
        {},
        { slug: PERSONALITY.slug, alias: 'lila' },
        { scope: 'global' }
      );

      await handleRemovePersonalityAlias(deps())(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockPrisma.personalityAlias.delete).not.toHaveBeenCalled();
    });

    it('lets the bot owner remove a GLOBAL row via ?scope=global', async () => {
      mockIsBotOwner.mockReturnValue(true);
      mockPrisma.personalityAlias.findFirst.mockResolvedValue({
        id: 'row-g',
        alias: 'lila',
        userId: null,
      });
      mockPrisma.personalityAlias.delete.mockResolvedValue({});
      const { req, res } = createMockReqRes(
        {},
        { slug: PERSONALITY.slug, alias: 'lila' },
        { scope: 'global' }
      );

      await handleRemovePersonalityAlias(deps())(req, res, vi.fn());

      expect(mockPrisma.personalityAlias.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: null }),
        })
      );
      expect(res.json).toHaveBeenCalledWith({ removedAlias: 'lila', removedScope: 'global' });
    });

    it('404s when the alias does not exist in the requested tier', async () => {
      mockPrisma.personalityAlias.findFirst.mockResolvedValue(null);
      const { req, res } = createMockReqRes({}, { slug: PERSONALITY.slug, alias: 'ghost' });

      await handleRemovePersonalityAlias(deps())(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
      expect(mockPrisma.personalityAlias.delete).not.toHaveBeenCalled();
    });
  });

  describe('GET my-aliases (cross-character overview)', () => {
    it('returns the caller΄s personal rows with personality context and shadow flags', async () => {
      mockPrisma.personalityAlias.findMany.mockResolvedValue([
        {
          alias: 'mommy',
          userId: MOCK_USER_ID,
          createdAt: CREATED_AT,
          personality: { id: 'p-1', name: 'Lilith', slug: 'lilith' },
        },
        {
          alias: 'sapph',
          userId: MOCK_USER_ID,
          createdAt: CREATED_AT,
          personality: { id: 'p-2', name: 'Sapphomet', slug: 'sapphomet' },
        },
      ]);
      // A visible character named "mommy" shadows the first alias.
      mockPrisma.personality.findMany.mockResolvedValue([{ name: 'Mommy', slug: 'mommy-char' }]);
      const { req, res } = createMockReqRes({});

      await handleListMyAliases(deps())(req, res, vi.fn());

      // Seam: only the caller's rows — never other users', never global.
      expect(mockPrisma.personalityAlias.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: MOCK_USER_ID },
          include: { personality: { select: { id: true, name: true, slug: true } } },
        })
      );
      // Seam: shadow probe is batched over the page's alias texts and
      // scoped to the caller's visible characters.
      expect(mockPrisma.personality.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              {
                OR: [
                  { name: { in: ['mommy', 'sapph'], mode: 'insensitive' } },
                  { slug: { in: ['mommy', 'sapph'] } },
                ],
              },
              { OR: [{ isPublic: true }, { ownerId: MOCK_USER_ID }] },
            ],
          },
        })
      );
      expect(res.json).toHaveBeenCalledWith({
        aliases: [
          {
            alias: 'mommy',
            scope: 'user',
            personality: { id: 'p-1', name: 'Lilith', slug: 'lilith' },
            shadowed: true,
            createdAt: '2026-07-17T00:00:00.000Z',
          },
          {
            alias: 'sapph',
            scope: 'user',
            personality: { id: 'p-2', name: 'Sapphomet', slug: 'sapphomet' },
            shadowed: false,
            createdAt: '2026-07-17T00:00:00.000Z',
          },
        ],
        truncated: false,
      });
    });

    it('includes ALL global rows for the bot owner, with an unscoped shadow probe', async () => {
      mockIsBotOwner.mockReturnValue(true);
      mockPrisma.personalityAlias.findMany.mockResolvedValue([
        {
          alias: 'lila',
          userId: null,
          createdAt: CREATED_AT,
          personality: { id: 'p-1', name: 'Lilith', slug: 'lilith' },
        },
      ]);
      mockPrisma.personality.findMany.mockResolvedValue([]);
      const { req, res } = createMockReqRes({});

      await handleListMyAliases(deps())(req, res, vi.fn());

      expect(mockPrisma.personalityAlias.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ userId: MOCK_USER_ID }, { userId: null }] },
        })
      );
      expect(mockPrisma.personality.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [{ name: { in: ['lila'], mode: 'insensitive' } }, { slug: { in: ['lila'] } }],
          },
        })
      );
      const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
        aliases: { scope: string }[];
      };
      expect(payload.aliases[0].scope).toBe('global');
    });

    it('skips the shadow probe entirely when the caller has no aliases', async () => {
      mockPrisma.personalityAlias.findMany.mockResolvedValue([]);
      const { req, res } = createMockReqRes({});

      await handleListMyAliases(deps())(req, res, vi.fn());

      expect(mockPrisma.personality.findMany).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ aliases: [], truncated: false });
    });
  });
});
