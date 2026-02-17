/**
 * Tests for Shapes.inc List Route
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

import { createShapesListRoutes } from './list.js';
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

function createMockReqRes() {
  const req = {
    body: {},
    userId: 'discord-user-123',
  } as unknown as Request & { userId: string };

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

describe('Shapes List Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('route factory', () => {
    it('should create a router with GET route', () => {
      const router = createShapesListRoutes(mockPrisma as unknown as PrismaClient);
      expect(router).toBeDefined();
      expect(findRoute(router, 'get', '/')).toBeDefined();
    });
  });

  describe('GET / (list shapes)', () => {
    async function callListHandler(
      prisma = mockPrisma
    ): Promise<{ req: Request & { userId: string }; res: Response }> {
      const { req, res } = createMockReqRes();
      const router = createShapesListRoutes(prisma as unknown as PrismaClient);
      const handler = getRouteHandler(router, 'get', '/');
      await handler(req, res);
      return { req, res };
    }

    it('should return 401 when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      const { res } = await callListHandler();

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 403 when credential not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-uuid-123' });
      mockPrisma.userCredential.findFirst.mockResolvedValue(null);
      const { res } = await callListHandler();

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should decrypt cookie and fetch from shapes.inc', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-uuid-123' });
      mockPrisma.userCredential.findFirst.mockResolvedValue({
        iv: 'iv',
        content: 'content',
        tag: 'tag',
      });

      // Mock global fetch
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        url: 'https://shapes.inc/api/shapes?category=self',
        json: vi
          .fn()
          .mockResolvedValue([{ id: 'shape-1', name: 'Test', username: 'test', avatar: '' }]),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { res } = await callListHandler();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('shapes.inc/api/shapes'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Cookie: 'appSession.0=abc; appSession.1=def',
          }),
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          shapes: expect.arrayContaining([expect.objectContaining({ username: 'test' })]),
          total: 1,
        })
      );

      vi.unstubAllGlobals();
    });
  });
});
