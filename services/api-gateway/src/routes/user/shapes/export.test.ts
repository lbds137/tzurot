/**
 * Tests for Shapes.inc Export Route
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Mock dependencies
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    decryptApiKey: vi.fn().mockReturnValue('appSession.0=abc; appSession.1=def'),
  };
});

vi.mock('../../../services/AuthMiddleware.js', () => ({
  requireUserAuth: vi.fn(() => vi.fn((_req: unknown, _res: unknown, next: () => void) => next())),
}));

vi.mock('../../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

import { createShapesExportRoutes } from './export.js';
import type { PrismaClient } from '@tzurot/common-types';
import { findRoute, getRouteHandler } from '../../../test/expressRouterUtils.js';

const mockPrisma = {
  user: {
    findFirst: vi.fn().mockResolvedValue(null),
  },
  userCredential: {
    findFirst: vi.fn().mockResolvedValue(null),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
};

function createMockReqRes(body: Record<string, unknown> = {}) {
  const req = {
    body,
    userId: 'discord-user-123',
  } as unknown as Request & { userId: string };

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

describe('Shapes Export Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('route factory', () => {
    it('should create a router with POST route', () => {
      const router = createShapesExportRoutes(mockPrisma as unknown as PrismaClient);
      expect(router).toBeDefined();
      expect(findRoute(router, 'post', '/')).toBeDefined();
    });
  });

  describe('POST / (export shape)', () => {
    async function callExportHandler(
      body: Record<string, unknown>,
      prisma = mockPrisma
    ): Promise<{ req: Request & { userId: string }; res: Response }> {
      const { req, res } = createMockReqRes(body);
      const router = createShapesExportRoutes(prisma as unknown as PrismaClient);
      const handler = getRouteHandler(router, 'post', '/');
      await handler(req, res);
      return { req, res };
    }

    it('should reject missing slug', async () => {
      const { res } = await callExportHandler({});

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'VALIDATION_ERROR' }));
    });

    it('should return 403 when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      const { res } = await callExportHandler({ slug: 'test-shape' });

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 403 when credential not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-uuid-123' });
      mockPrisma.userCredential.findFirst.mockResolvedValue(null);
      const { res } = await callExportHandler({ slug: 'test-shape' });

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should fetch shape data and return export payload', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-uuid-123' });
      mockPrisma.userCredential.findFirst.mockResolvedValue({
        iv: 'iv',
        content: 'content',
        tag: 'tag',
      });

      const shapeConfig = {
        id: 'shape-uuid',
        name: 'Test Shape',
        username: 'test-shape',
      };

      // Mock fetch for config, memories (1 page), stories, user personalization
      // Each mock needs a `url` property matching the request URL (redirect detection)
      let callIndex = -1;
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        callIndex++;
        const responses = [
          // Config
          { ok: true, url, json: vi.fn().mockResolvedValue(shapeConfig) },
          // Memories page 1 (no more pages)
          {
            ok: true,
            url,
            json: vi.fn().mockResolvedValue({
              data: [],
              pagination: { has_next: false, page: 1 },
            }),
          },
          // Stories
          { ok: true, url, json: vi.fn().mockResolvedValue([]) },
          // User personalization
          { ok: true, url, json: vi.fn().mockResolvedValue(null) },
        ];
        return Promise.resolve(responses[callIndex] ?? responses[0]);
      });

      vi.stubGlobal('fetch', mockFetch);

      const { res } = await callExportHandler({ slug: 'test-shape' });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceSlug: 'test-shape',
          config: expect.objectContaining({ username: 'test-shape' }),
          stats: expect.objectContaining({ memoriesCount: 0, storiesCount: 0 }),
        })
      );

      vi.unstubAllGlobals();
    });
  });
});
