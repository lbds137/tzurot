/**
 * Tests for POST /wallet/test route
 *
 * Comprehensive tests for API key testing including validation,
 * decryption, and provider validation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Mock apiKeyValidation module
vi.mock('../../utils/apiKeyValidation.js', () => ({
  validateApiKey: vi.fn(),
}));

import { validateApiKey } from '../../utils/apiKeyValidation.js';
const mockValidateApiKey = vi.mocked(validateApiKey);

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
    decryptApiKey: vi.fn().mockReturnValue('decrypted-api-key'),
  };
});

import { decryptApiKey } from '@tzurot/common-types';
const mockDecryptApiKey = vi.mocked(decryptApiKey);

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
    updateMany: vi.fn(),
  },
};

import { createTestKeyRoute } from './testKey.js';
import { AIProvider, type PrismaClient } from '@tzurot/common-types';

// Helper to create mock request/response
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

// Helper to call the route handler directly
async function callHandler(
  prisma: unknown,
  req: Request & { userId: string },
  res: Response
): Promise<void> {
  const router = createTestKeyRoute(prisma as PrismaClient);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Express router internals are untyped
  const layer = (router.stack as any[]).find(l => l.route?.methods?.post);
  const handler = (layer as { route: { stack: Array<{ handle: Function }> } }).route.stack[
    (layer as { route: { stack: Array<{ handle: Function }> } }).route.stack.length - 1
  ].handle;
  await handler(req, res);
}

describe('POST /wallet/test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateApiKey.mockResolvedValue({ valid: true, credits: 50 });
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-uuid-123' });
    mockPrisma.userApiKey.findFirst.mockResolvedValue({
      iv: 'mock-iv',
      content: 'mock-content',
      tag: 'mock-tag',
    });
    mockPrisma.userApiKey.updateMany.mockResolvedValue({ count: 1 });
  });

  describe('route factory', () => {
    it('should create a router', () => {
      const router = createTestKeyRoute(mockPrisma as unknown as PrismaClient);

      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });

    it('should have POST route registered', () => {
      const router = createTestKeyRoute(mockPrisma as unknown as PrismaClient);

      expect(router.stack).toBeDefined();
      expect(router.stack.length).toBeGreaterThan(0);

      const postRoute = (
        router.stack as unknown as Array<{
          route?: { path?: string; methods?: { post?: boolean } };
        }>
      ).find(layer => layer.route?.path === '/' && layer.route?.methods?.post);
      expect(postRoute).toBeDefined();
    });
  });

  describe('validation', () => {
    it('should reject request with missing provider', async () => {
      const { req, res } = createMockReqRes({});

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
        })
      );
    });

    it('should reject request with invalid provider', async () => {
      const { req, res } = createMockReqRes({ provider: 'invalid-provider' });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Invalid or missing provider'),
        })
      );
    });

    it('should reject null provider', async () => {
      const { req, res } = createMockReqRes({ provider: null });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('user and key lookup', () => {
    it('should return 404 when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const { req, res } = createMockReqRes({ provider: AIProvider.OpenRouter });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'NOT_FOUND',
        })
      );
    });

    it('should return 404 when API key not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-uuid-123' });
      mockPrisma.userApiKey.findFirst.mockResolvedValue(null);

      const { req, res } = createMockReqRes({ provider: AIProvider.OpenRouter });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('key decryption', () => {
    it('should decrypt stored key', async () => {
      const { req, res } = createMockReqRes({ provider: AIProvider.OpenRouter });

      await callHandler(mockPrisma, req, res);

      expect(mockDecryptApiKey).toHaveBeenCalledWith({
        iv: 'mock-iv',
        content: 'mock-content',
        tag: 'mock-tag',
      });
    });

    it('should return 500 when decryption fails', async () => {
      mockDecryptApiKey.mockImplementationOnce(() => {
        throw new Error('Decryption failed');
      });

      const { req, res } = createMockReqRes({ provider: AIProvider.OpenRouter });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'INTERNAL_ERROR',
        })
      );
    });
  });

  describe('key validation', () => {
    it('should validate decrypted key with provider', async () => {
      const { req, res } = createMockReqRes({ provider: AIProvider.OpenRouter });

      await callHandler(mockPrisma, req, res);

      expect(mockValidateApiKey).toHaveBeenCalledWith('decrypted-api-key', AIProvider.OpenRouter);
    });

    it('should return valid=false when key is invalid', async () => {
      mockValidateApiKey.mockResolvedValue({
        valid: false,
        error: 'Invalid API key',
      });

      const { req, res } = createMockReqRes({ provider: AIProvider.OpenRouter });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          valid: false,
          provider: AIProvider.OpenRouter,
          error: 'Invalid API key',
        })
      );
    });

    it('should update lastUsedAt on successful validation', async () => {
      const { req, res } = createMockReqRes({ provider: AIProvider.OpenRouter });

      await callHandler(mockPrisma, req, res);

      expect(mockPrisma.userApiKey.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-uuid-123',
          provider: AIProvider.OpenRouter,
        },
        data: {
          lastUsedAt: expect.any(Date),
        },
      });
    });

    it('should return success with credits', async () => {
      mockValidateApiKey.mockResolvedValue({ valid: true, credits: 75.5 });

      const { req, res } = createMockReqRes({ provider: AIProvider.OpenRouter });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          valid: true,
          provider: AIProvider.OpenRouter,
          credits: 75.5,
        })
      );
    });
  });
});
