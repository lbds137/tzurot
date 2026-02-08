/**
 * Tests for /user/usage routes
 *
 * Comprehensive tests for token usage statistics including
 * period filtering, aggregation, and empty states.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Mock dependencies before imports
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
  usageLog: {
    findMany: vi.fn(),
  },
};

import { createUsageRoutes } from './usage.js';
import type { PrismaClient } from '@tzurot/common-types';
import { findRoute, getRouteHandler } from '../../test/expressRouterUtils.js';

// Helper to create mock request/response
function createMockReqRes(query: Record<string, string> = {}) {
  const req = {
    query,
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
  const router = createUsageRoutes(prisma as PrismaClient);
  const handler = getRouteHandler(router, 'get');
  await handler(req, res);
}

describe('/user/usage routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-uuid-123' });
    mockPrisma.usageLog.findMany.mockResolvedValue([]);
  });

  describe('route factory', () => {
    it('should create a router', () => {
      const router = createUsageRoutes(mockPrisma as unknown as PrismaClient);

      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });

    it('should have GET route registered', () => {
      const router = createUsageRoutes(mockPrisma as unknown as PrismaClient);

      expect(router.stack).toBeDefined();
      expect(router.stack.length).toBeGreaterThan(0);

      expect(findRoute(router, 'get', '/')).toBeDefined();
    });
  });

  describe('period validation', () => {
    it('should accept day period', async () => {
      const { req, res } = createMockReqRes({ period: 'day' });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ period: 'day' }));
    });

    it('should accept week period', async () => {
      const { req, res } = createMockReqRes({ period: 'week' });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ period: 'week' }));
    });

    it('should accept month period', async () => {
      const { req, res } = createMockReqRes({ period: 'month' });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ period: 'month' }));
    });

    it('should accept all period', async () => {
      const { req, res } = createMockReqRes({ period: 'all' });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ period: 'all' }));
    });

    it('should default to month period', async () => {
      const { req, res } = createMockReqRes({});

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ period: 'month' }));
    });

    it('should reject invalid period', async () => {
      const { req, res } = createMockReqRes({ period: 'invalid' });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
        })
      );
    });
  });

  describe('user lookup', () => {
    it('should query user by Discord ID', async () => {
      const { req, res } = createMockReqRes({});

      await callHandler(mockPrisma, req, res);

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { discordId: 'discord-user-123' },
        select: { id: true },
      });
    });

    it('should return empty stats when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const { req, res } = createMockReqRes({});

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          totalRequests: 0,
          totalTokensIn: 0,
          totalTokensOut: 0,
          totalTokens: 0,
          byProvider: {},
          byModel: {},
          byRequestType: {},
        })
      );
    });

    it('should not query usageLog when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const { req, res } = createMockReqRes({});

      await callHandler(mockPrisma, req, res);

      expect(mockPrisma.usageLog.findMany).not.toHaveBeenCalled();
    });
  });

  describe('usage aggregation', () => {
    it('should return empty stats when no usage logs', async () => {
      mockPrisma.usageLog.findMany.mockResolvedValue([]);

      const { req, res } = createMockReqRes({});

      await callHandler(mockPrisma, req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          totalRequests: 0,
          totalTokensIn: 0,
          totalTokensOut: 0,
          totalTokens: 0,
        })
      );
    });

    it('should aggregate token counts', async () => {
      mockPrisma.usageLog.findMany.mockResolvedValue([
        {
          provider: 'openrouter',
          model: 'gpt-4',
          tokensIn: 100,
          tokensOut: 50,
          requestType: 'chat',
        },
        {
          provider: 'openrouter',
          model: 'gpt-4',
          tokensIn: 200,
          tokensOut: 100,
          requestType: 'chat',
        },
      ]);

      const { req, res } = createMockReqRes({});

      await callHandler(mockPrisma, req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          totalRequests: 2,
          totalTokensIn: 300,
          totalTokensOut: 150,
          totalTokens: 450,
        })
      );
    });

    it('should aggregate by provider', async () => {
      mockPrisma.usageLog.findMany.mockResolvedValue([
        {
          provider: 'openrouter',
          model: 'gpt-4',
          tokensIn: 100,
          tokensOut: 50,
          requestType: 'chat',
        },
        {
          provider: 'openai',
          model: 'gpt-3.5',
          tokensIn: 200,
          tokensOut: 100,
          requestType: 'chat',
        },
      ]);

      const { req, res } = createMockReqRes({});

      await callHandler(mockPrisma, req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          byProvider: {
            openrouter: { requests: 1, tokensIn: 100, tokensOut: 50 },
            openai: { requests: 1, tokensIn: 200, tokensOut: 100 },
          },
        })
      );
    });

    it('should aggregate by model', async () => {
      mockPrisma.usageLog.findMany.mockResolvedValue([
        {
          provider: 'openrouter',
          model: 'gpt-4',
          tokensIn: 100,
          tokensOut: 50,
          requestType: 'chat',
        },
        {
          provider: 'openrouter',
          model: 'claude-3',
          tokensIn: 200,
          tokensOut: 100,
          requestType: 'chat',
        },
        {
          provider: 'openrouter',
          model: 'gpt-4',
          tokensIn: 150,
          tokensOut: 75,
          requestType: 'chat',
        },
      ]);

      const { req, res } = createMockReqRes({});

      await callHandler(mockPrisma, req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          byModel: {
            'gpt-4': { requests: 2, tokensIn: 250, tokensOut: 125 },
            'claude-3': { requests: 1, tokensIn: 200, tokensOut: 100 },
          },
        })
      );
    });

    it('should aggregate by request type', async () => {
      mockPrisma.usageLog.findMany.mockResolvedValue([
        {
          provider: 'openrouter',
          model: 'gpt-4',
          tokensIn: 100,
          tokensOut: 50,
          requestType: 'chat',
        },
        {
          provider: 'openrouter',
          model: 'whisper',
          tokensIn: 0,
          tokensOut: 100,
          requestType: 'transcription',
        },
      ]);

      const { req, res } = createMockReqRes({});

      await callHandler(mockPrisma, req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          byRequestType: {
            chat: { requests: 1, tokensIn: 100, tokensOut: 50 },
            transcription: { requests: 1, tokensIn: 0, tokensOut: 100 },
          },
        })
      );
    });
  });

  describe('period filtering', () => {
    it('should query with date filter for month period', async () => {
      const { req, res } = createMockReqRes({ period: 'month' });

      await callHandler(mockPrisma, req, res);

      expect(mockPrisma.usageLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-uuid-123',
            createdAt: expect.objectContaining({
              gte: expect.any(Date),
            }),
          }),
        })
      );
    });

    it('should query without date filter for all period', async () => {
      const { req, res } = createMockReqRes({ period: 'all' });

      await callHandler(mockPrisma, req, res);

      expect(mockPrisma.usageLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'user-uuid-123',
          },
        })
      );
    });

    it('should include period timestamps in response', async () => {
      const { req, res } = createMockReqRes({ period: 'month' });

      await callHandler(mockPrisma, req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          periodStart: expect.any(String),
          periodEnd: expect.any(String),
        })
      );
    });

    it('should return null periodStart for all period', async () => {
      const { req, res } = createMockReqRes({ period: 'all' });

      await callHandler(mockPrisma, req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          periodStart: null,
        })
      );
    });
  });
});
