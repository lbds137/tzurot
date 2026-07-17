/**
 * Tests for /user/personality/:slug/aliases (list / add / remove).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generatePersonalityAliasUuid } from '@tzurot/common-types/utils/deterministicUuid';
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

// The real resolvePersonalityForEdit + canUserEditPersonality chain runs
// over the mocked prisma (helpers.ts calls its own exports internally, so
// export-level mocks can't intercept). Only the bot-owner env check is
// stubbed, per the sibling test convention.
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
} from './aliases.js';
import type { RouteDeps } from '../../routeDeps.js';

// Owned by the requester — the common case for an edit-gated route.
const PERSONALITY = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  slug: 'lila-elyona',
  ownerId: MOCK_USER_ID,
};
const OTHER_OWNER_ID = 'c1d2e3f4-0000-4000-8000-000000000002';
const CREATED_AT = new Date('2026-07-17T00:00:00.000Z');

const mockPrisma = {
  personality: { findUnique: vi.fn(), findFirst: vi.fn() },
  personalityOwner: { findUnique: vi.fn() },
  personalityAlias: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
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
    mockIsBotOwner.mockReturnValue(false);
    mockInvalidate.mockResolvedValue(undefined);
  });

  describe('GET list', () => {
    it('404s on an unknown slug', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue(null);
      const { req, res } = createMockReqRes({}, { slug: 'ghost' });

      await handleListPersonalityAliases(deps())(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
      expect(mockPrisma.personalityAlias.findMany).not.toHaveBeenCalled();
    });

    it('403s for a non-editor and never reads the alias table', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        ...PERSONALITY,
        ownerId: OTHER_OWNER_ID,
      });
      const { req, res } = createMockReqRes({}, { slug: PERSONALITY.slug });

      await handleListPersonalityAliases(deps())(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(403);
      // Seam: co-ownership was actually consulted before denying.
      expect(mockPrisma.personalityOwner.findUnique).toHaveBeenCalledWith({
        where: {
          personalityId_userId: { personalityId: PERSONALITY.id, userId: MOCK_USER_ID },
        },
      });
      expect(mockPrisma.personalityAlias.findMany).not.toHaveBeenCalled();
    });

    it('returns the aliases sorted and ISO-stamped', async () => {
      mockPrisma.personalityAlias.findMany.mockResolvedValue([
        { alias: 'lila', createdAt: CREATED_AT },
      ]);
      const { req, res } = createMockReqRes({}, { slug: PERSONALITY.slug });

      await handleListPersonalityAliases(deps())(req, res, vi.fn());

      expect(mockPrisma.personalityAlias.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { personalityId: PERSONALITY.id },
          orderBy: { alias: 'asc' },
        })
      );
      expect(res.json).toHaveBeenCalledWith({
        aliases: [{ alias: 'lila', createdAt: '2026-07-17T00:00:00.000Z' }],
      });
    });
  });

  describe('POST add', () => {
    it('rejects an alias that exact-matches a visible character name or slug (would be shadowed)', async () => {
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
      // The rejection must not disclose WHICH character shadows the alias.
      const body = JSON.stringify((res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
      expect(body).not.toContain('shadow-id');
      expect(body).toContain('matches an existing character');
      expect(mockPrisma.personalityAlias.create).not.toHaveBeenCalled();
      // No mutation committed → no cache invalidation.
      expect(mockInvalidate).not.toHaveBeenCalled();
    });

    it('creates with the deterministic case-insensitive id and returns 201', async () => {
      mockPrisma.personality.findFirst.mockResolvedValue(null);
      mockPrisma.personalityAlias.create.mockResolvedValue({
        alias: 'Li',
        createdAt: CREATED_AT,
      });
      const { req, res } = createMockReqRes({ alias: 'Li' }, { slug: PERSONALITY.slug });

      await handleAddPersonalityAlias(deps())(req, res, vi.fn());

      expect(mockPrisma.personalityAlias.create).toHaveBeenCalledWith({
        data: {
          id: generatePersonalityAliasUuid('li'),
          alias: 'Li',
          personalityId: PERSONALITY.id,
        },
      });
      expect(res.status).toHaveBeenCalledWith(201);
      // Routing caches must drop eagerly — alias add changes name resolution.
      expect(mockInvalidate).toHaveBeenCalledWith(PERSONALITY.id);
    });

    it('still returns 201 when cache invalidation throws', async () => {
      mockInvalidate.mockRejectedValue(new Error('redis down'));
      mockPrisma.personality.findFirst.mockResolvedValue(null);
      mockPrisma.personalityAlias.create.mockResolvedValue({
        alias: 'Li',
        createdAt: CREATED_AT,
      });
      const { req, res } = createMockReqRes({ alias: 'Li' }, { slug: PERSONALITY.slug });

      await handleAddPersonalityAlias(deps())(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('maps the unique-constraint violation to a 409 conflict', async () => {
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

    it('rejects an alias containing @ at the schema boundary', async () => {
      const { req, res } = createMockReqRes({ alias: '@lila' }, { slug: PERSONALITY.slug });

      await handleAddPersonalityAlias(deps())(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockPrisma.personality.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('DELETE remove', () => {
    it('matches case-insensitively but scoped to THIS personality', async () => {
      mockPrisma.personalityAlias.findFirst.mockResolvedValue({ id: 'row-1', alias: 'lila' });
      mockPrisma.personalityAlias.delete.mockResolvedValue({});
      const { req, res } = createMockReqRes({}, { slug: PERSONALITY.slug, alias: 'LILA' });

      await handleRemovePersonalityAlias(deps())(req, res, vi.fn());

      expect(mockPrisma.personalityAlias.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            personalityId: PERSONALITY.id,
            alias: { equals: 'LILA', mode: 'insensitive' },
          },
        })
      );
      expect(mockPrisma.personalityAlias.delete).toHaveBeenCalledWith({ where: { id: 'row-1' } });
      expect(res.json).toHaveBeenCalledWith({ removedAlias: 'lila' });
      // Routing caches must drop eagerly — a removed alias must stop resolving.
      expect(mockInvalidate).toHaveBeenCalledWith(PERSONALITY.id);
    });

    it('404s when the alias does not exist on this personality', async () => {
      mockPrisma.personalityAlias.findFirst.mockResolvedValue(null);
      const { req, res } = createMockReqRes({}, { slug: PERSONALITY.slug, alias: 'ghost' });

      await handleRemovePersonalityAlias(deps())(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
      expect(mockPrisma.personalityAlias.delete).not.toHaveBeenCalled();
    });
  });
});
