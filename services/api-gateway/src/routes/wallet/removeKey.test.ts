/**
 * Tests for DELETE /wallet/:provider route
 *
 * Comprehensive tests for API key removal including validation,
 * user lookup, and deletion.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Mock dependencies before imports
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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

// Uses the shared mock at `src/services/__mocks__/AuthMiddleware.ts`
// (auto-discovered by vitest). Passes `getOrCreateUserService` through to
// the real implementation and stubs `requireUserAuth` / `requireProvisionedUser`
// as passthrough middleware.
vi.mock('../../services/AuthMiddleware.js');

vi.mock('../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

// Mock Prisma
const mockPrisma = {
  user: {
    findUnique: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
    findFirst: vi.fn(),
    create: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
    update: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
  },
  userApiKey: {
    findFirst: vi.fn(),
    delete: vi.fn(),
  },
  $executeRaw: vi.fn().mockResolvedValue(1),
};

import { handleRemoveWalletKey } from './removeKey.js';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { asRouteHandler } from '../../test/shared-route-test-utils.js';

// Helper to create mock request/response
function createMockReqRes(provider: string) {
  const req = {
    params: { provider },
    userId: 'discord-user-123',
    provisionedUserId: 'user-uuid-123',
    provisionedDefaultPersonaId: 'persona-uuid-default',
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
  const handler = asRouteHandler(handleRemoveWalletKey({ prisma: prisma as PrismaClient }));
  await handler(req, res);
}

describe('DELETE /api/user/wallet/:provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-uuid-123' });
    mockPrisma.userApiKey.findFirst.mockResolvedValue({ id: 'key-uuid-123' });
    mockPrisma.userApiKey.delete.mockResolvedValue({ id: 'key-uuid-123' });
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
