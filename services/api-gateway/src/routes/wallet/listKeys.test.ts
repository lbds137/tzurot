/**
 * Tests for GET /wallet/list route
 *
 * Comprehensive tests for listing API keys including user lookup,
 * empty lists, and metadata formatting.
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
  };
});

vi.mock('../../services/AuthMiddleware.js', () => ({
  requireUserAuth: vi.fn(() => vi.fn((_req: unknown, _res: unknown, next: () => void) => next())),
}));

vi.mock('../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

// Mock Prisma
const mockPrisma = {
  user: {
    findFirst: vi.fn(),
  },
  userApiKey: {
    findMany: vi.fn(),
  },
};

import { createListKeysRoute } from './listKeys.js';
import { AIProvider, type PrismaClient } from '@tzurot/common-types';
import { findRoute, getRouteHandler } from '../../test/expressRouterUtils.js';

// Helper to create mock request/response
function createMockReqRes() {
  const req = {
    userId: 'discord-user-123',
  } as unknown as Request & { userId: string };

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

// Helper to call the route handler directly
async function callHandler(
  prisma: unknown,
  req: Request & { userId: string },
  res: Response
): Promise<void> {
  const router = createListKeysRoute(prisma as PrismaClient);
  const handler = getRouteHandler(router, 'get');
  await handler(req, res);
}

describe('GET /wallet/list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-uuid-123' });
    mockPrisma.userApiKey.findMany.mockResolvedValue([]);
  });

  describe('route factory', () => {
    it('should create a router', () => {
      const router = createListKeysRoute(mockPrisma as unknown as PrismaClient);

      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });

    it('should have a GET route registered', () => {
      const router = createListKeysRoute(mockPrisma as unknown as PrismaClient);

      expect(router.stack).toBeDefined();
      expect(router.stack.length).toBeGreaterThan(0);

      expect(findRoute(router, 'get')).toBeDefined();
    });
  });

  describe('user lookup', () => {
    it('should query user by Discord ID', async () => {
      const { req, res } = createMockReqRes();

      await callHandler(mockPrisma, req, res);

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { discordId: 'discord-user-123' },
        select: { id: true },
      });
    });

    it('should return empty list when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const { req, res } = createMockReqRes();

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          keys: [],
          timestamp: expect.any(String),
        })
      );
    });

    it('should not query userApiKey when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const { req, res } = createMockReqRes();

      await callHandler(mockPrisma, req, res);

      expect(mockPrisma.userApiKey.findMany).not.toHaveBeenCalled();
    });
  });

  describe('key listing', () => {
    it('should query API keys for user', async () => {
      const { req, res } = createMockReqRes();

      await callHandler(mockPrisma, req, res);

      expect(mockPrisma.userApiKey.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-uuid-123' },
        select: {
          provider: true,
          isActive: true,
          createdAt: true,
          lastUsedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty list when user has no keys', async () => {
      mockPrisma.userApiKey.findMany.mockResolvedValue([]);

      const { req, res } = createMockReqRes();

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          keys: [],
        })
      );
    });

    it('should return keys with formatted metadata', async () => {
      const createdAt = new Date('2025-01-15T10:00:00Z');
      const lastUsedAt = new Date('2025-01-20T15:30:00Z');

      mockPrisma.userApiKey.findMany.mockResolvedValue([
        {
          provider: AIProvider.OpenRouter,
          isActive: true,
          createdAt,
          lastUsedAt,
        },
      ]);

      const { req, res } = createMockReqRes();

      await callHandler(mockPrisma, req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          keys: [
            {
              provider: AIProvider.OpenRouter,
              isActive: true,
              createdAt: createdAt.toISOString(),
              lastUsedAt: lastUsedAt.toISOString(),
            },
          ],
        })
      );
    });

    it('should handle null lastUsedAt', async () => {
      const createdAt = new Date('2025-01-15T10:00:00Z');

      mockPrisma.userApiKey.findMany.mockResolvedValue([
        {
          provider: AIProvider.OpenRouter,
          isActive: true,
          createdAt,
          lastUsedAt: null,
        },
      ]);

      const { req, res } = createMockReqRes();

      await callHandler(mockPrisma, req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          keys: [
            {
              provider: AIProvider.OpenRouter,
              isActive: true,
              createdAt: createdAt.toISOString(),
              lastUsedAt: null,
            },
          ],
        })
      );
    });

    it('should return multiple keys in order', async () => {
      const date1 = new Date('2025-01-20T10:00:00Z');
      const date2 = new Date('2025-01-15T10:00:00Z');

      mockPrisma.userApiKey.findMany.mockResolvedValue([
        {
          provider: AIProvider.OpenRouter,
          isActive: true,
          createdAt: date1,
          lastUsedAt: null,
        },
        {
          provider: AIProvider.OpenRouter,
          isActive: false,
          createdAt: date2,
          lastUsedAt: null,
        },
      ]);

      const { req, res } = createMockReqRes();

      await callHandler(mockPrisma, req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          keys: [
            expect.objectContaining({ provider: AIProvider.OpenRouter }),
            expect.objectContaining({ provider: AIProvider.OpenRouter }),
          ],
        })
      );
    });

    it('should include timestamp in response', async () => {
      const { req, res } = createMockReqRes();

      await callHandler(mockPrisma, req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
        })
      );
    });
  });

  describe('security', () => {
    it('should not return actual key content', async () => {
      mockPrisma.userApiKey.findMany.mockResolvedValue([
        {
          provider: AIProvider.OpenRouter,
          isActive: true,
          createdAt: new Date(),
          lastUsedAt: null,
          // These should NOT be included in select, but verify response doesn't have them
          iv: 'should-not-appear',
          content: 'should-not-appear',
          tag: 'should-not-appear',
        },
      ]);

      const { req, res } = createMockReqRes();

      await callHandler(mockPrisma, req, res);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.keys[0]).not.toHaveProperty('iv');
      expect(response.keys[0]).not.toHaveProperty('content');
      expect(response.keys[0]).not.toHaveProperty('tag');
    });
  });
});
