/**
 * Tests for /user/personality/:slug/aliases (list / add / remove).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generatePersonalityAliasUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { Prisma } from '@tzurot/common-types/services/prisma';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createMockReqRes, MOCK_USER_ID } from './test-utils.js';

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

// Edit-permission boundary is mocked — helpers.ts has its own tests; these
// tests pin THIS route's behavior on either side of the gate.
const mockCanEdit = vi.fn();
vi.mock('./helpers.js', () => ({
  canUserEditPersonality: (...args: unknown[]) => mockCanEdit(...args),
}));

import {
  handleListPersonalityAliases,
  handleAddPersonalityAlias,
  handleRemovePersonalityAlias,
} from './aliases.js';
import type { RouteDeps } from '../../routeDeps.js';

const PERSONALITY = { id: 'a1b2c3d4-0000-4000-8000-000000000001', slug: 'lila-elyona' };
const CREATED_AT = new Date('2026-07-17T00:00:00.000Z');

const mockPrisma = {
  personality: { findUnique: vi.fn(), findFirst: vi.fn() },
  personalityAlias: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
};

function deps(): RouteDeps {
  return { prisma: mockPrisma as unknown as PrismaClient } as unknown as RouteDeps;
}

describe('personality alias routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.personality.findUnique.mockResolvedValue(PERSONALITY);
    mockCanEdit.mockResolvedValue(true);
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
      mockCanEdit.mockResolvedValue(false);
      const { req, res } = createMockReqRes({}, { slug: PERSONALITY.slug });

      await handleListPersonalityAliases(deps())(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockCanEdit).toHaveBeenCalledWith(
        expect.anything(),
        MOCK_USER_ID,
        PERSONALITY.id,
        expect.anything()
      );
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
    it('rejects an alias that exact-matches an existing character name or slug (would be shadowed)', async () => {
      mockPrisma.personality.findFirst.mockResolvedValue({ slug: 'other-char' });
      const { req, res } = createMockReqRes({ alias: 'Sapphomet' }, { slug: PERSONALITY.slug });

      await handleAddPersonalityAlias(deps())(req, res, vi.fn());

      // Seam: the shadow probe must be case-insensitive on name and
      // lowercased on slug — the exact predicates the resolver itself uses.
      expect(mockPrisma.personality.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [{ name: { equals: 'Sapphomet', mode: 'insensitive' } }, { slug: 'sapphomet' }],
          },
        })
      );
      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockPrisma.personalityAlias.create).not.toHaveBeenCalled();
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
