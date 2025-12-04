/**
 * Tests for DELETE /wallet/:provider route
 *
 * Comprehensive tests for API key removal including validation,
 * user lookup, and deletion.
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
  userApiKey: {
    findFirst: vi.fn(),
    delete: vi.fn(),
  },
};

import { createRemoveKeyRoute } from './removeKey.js';
import { AIProvider, type PrismaClient } from '@tzurot/common-types';

// Helper to create mock request/response
function createMockReqRes(provider: string) {
  const req = {
    params: { provider },
    userId: 'discord-user-123',
  } as unknown as Request & { userId: string };

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

// Helper to call the handler directly
async function callHandler(
  prisma: unknown,
  req: Request & { userId: string },
  res: Response
): Promise<void> {
  const handlers = createRemoveKeyRoute(prisma as PrismaClient);
  // handlers[0] is auth middleware, handlers[1] is the actual handler
  const handler = handlers[1] as (req: Request, res: Response) => Promise<void>;
  await handler(req, res);
}

describe('DELETE /wallet/:provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-uuid-123' });
    mockPrisma.userApiKey.findFirst.mockResolvedValue({ id: 'key-uuid-123' });
    mockPrisma.userApiKey.delete.mockResolvedValue({ id: 'key-uuid-123' });
  });

  describe('route factory', () => {
    it('should create an array of handlers', () => {
      const handlers = createRemoveKeyRoute(mockPrisma as unknown as PrismaClient);

      expect(handlers).toBeDefined();
      expect(Array.isArray(handlers)).toBe(true);
      expect(handlers.length).toBe(2); // [auth middleware, handler]
    });

    it('should have auth middleware as first handler', () => {
      const handlers = createRemoveKeyRoute(mockPrisma as unknown as PrismaClient);

      expect(typeof handlers[0]).toBe('function');
    });

    it('should have request handler as second handler', () => {
      const handlers = createRemoveKeyRoute(mockPrisma as unknown as PrismaClient);

      expect(typeof handlers[1]).toBe('function');
    });
  });

  describe('validation', () => {
    it('should reject request with invalid provider', async () => {
      const { req, res } = createMockReqRes('invalid-provider');

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: expect.stringContaining('Invalid provider'),
        })
      );
    });

    it('should accept valid OpenRouter provider', async () => {
      const { req, res } = createMockReqRes(AIProvider.OpenRouter);

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });

  });

  describe('user lookup', () => {
    it('should return 404 when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const { req, res } = createMockReqRes(AIProvider.OpenRouter);

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'NOT_FOUND',
        })
      );
    });

    it('should query user by Discord ID', async () => {
      const { req, res } = createMockReqRes(AIProvider.OpenRouter);

      await callHandler(mockPrisma, req, res);

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { discordId: 'discord-user-123' },
        select: { id: true },
      });
    });
  });

  describe('API key lookup', () => {
    it('should return 404 when API key not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-uuid-123' });
      mockPrisma.userApiKey.findFirst.mockResolvedValue(null);

      const { req, res } = createMockReqRes(AIProvider.OpenRouter);

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'NOT_FOUND',
        })
      );
    });

    it('should query API key by user ID and provider', async () => {
      const { req, res } = createMockReqRes(AIProvider.OpenRouter);

      await callHandler(mockPrisma, req, res);

      expect(mockPrisma.userApiKey.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 'user-uuid-123',
          provider: AIProvider.OpenRouter,
        },
      });
    });
  });

  describe('key deletion', () => {
    it('should delete the API key by ID', async () => {
      mockPrisma.userApiKey.findFirst.mockResolvedValue({ id: 'key-uuid-456' });

      const { req, res } = createMockReqRes(AIProvider.OpenRouter);

      await callHandler(mockPrisma, req, res);

      expect(mockPrisma.userApiKey.delete).toHaveBeenCalledWith({
        where: { id: 'key-uuid-456' },
      });
    });

    it('should return success response after deletion', async () => {
      const { req, res } = createMockReqRes(AIProvider.OpenRouter);

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          provider: AIProvider.OpenRouter,
          message: expect.stringContaining('removed'),
          timestamp: expect.any(String),
        })
      );
    });

    it('should include provider in success message', async () => {
      const { req, res } = createMockReqRes(AIProvider.OpenRouter);

      await callHandler(mockPrisma, req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining(AIProvider.OpenRouter),
        })
      );
    });
  });
});
