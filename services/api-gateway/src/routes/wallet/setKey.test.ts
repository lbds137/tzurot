/**
 * Tests for POST /wallet/set route
 *
 * Comprehensive tests for API key storage including validation,
 * encryption, and error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { AIProvider } from '@tzurot/common-types';

// Mock apiKeyValidation module
vi.mock('../../utils/apiKeyValidation.js', () => ({
  validateApiKey: vi.fn(),
}));

// Import after mock setup to get the mocked version
import { validateApiKey } from '../../utils/apiKeyValidation.js';
const mockValidateApiKey = vi.mocked(validateApiKey);

// Mock config for bot owner testing
let mockBotOwnerId: string | undefined = undefined;

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
    getConfig: () => ({
      BOT_OWNER_ID: mockBotOwnerId,
    }),
    // Must mock isBotOwner separately since it uses getConfig internally,
    // and the actual isBotOwner wouldn't see our mocked getConfig
    isBotOwner: (discordId: string) => {
      return mockBotOwnerId !== undefined && mockBotOwnerId === discordId;
    },
    encryptApiKey: vi.fn().mockReturnValue({
      iv: 'mock-iv-12345678901234567890123456789012',
      content: 'mock-encrypted-content',
      tag: 'mock-tag-12345678901234567890123456',
    }),
  };
});

vi.mock('../../services/AuthMiddleware.js', () => ({
  requireUserAuth: vi.fn(() => vi.fn((_req: unknown, _res: unknown, next: () => void) => next())),
}));

vi.mock('../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

// Mock Prisma - includes methods needed by UserService
const mockPrisma = {
  user: {
    findUnique: vi.fn().mockResolvedValue(null), // No existing user - triggers create
    create: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
    update: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
    upsert: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
  },
  persona: {
    create: vi.fn().mockResolvedValue({ id: 'persona-uuid-123' }),
  },
  userApiKey: {
    upsert: vi.fn().mockResolvedValue({ id: 'key-uuid-123' }),
  },
  $transaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
    const mockTx = {
      user: {
        create: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
        update: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }), // For new user creation
        updateMany: vi.fn().mockResolvedValue({ count: 1 }), // Idempotent backfill
        findUnique: vi.fn().mockResolvedValue({ defaultPersonaId: null }), // For backfill check
      },
      persona: {
        create: vi.fn().mockResolvedValue({ id: 'persona-uuid-123' }),
      },
    };
    await callback(mockTx);
  }),
};

import { createSetKeyRoute } from './setKey.js';
import type { PrismaClient } from '@tzurot/common-types';
import { findRoute, getRouteHandler } from '../../test/expressRouterUtils.js';

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
  const router = createSetKeyRoute(prisma as PrismaClient);
  const handler = getRouteHandler(router, 'post');
  await handler(req, res);
}

describe('POST /wallet/set', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateApiKey.mockResolvedValue({ valid: true, credits: 100 });
    mockBotOwnerId = undefined; // Reset bot owner for each test
  });

  describe('route factory', () => {
    it('should create a router', () => {
      const router = createSetKeyRoute(mockPrisma as unknown as PrismaClient);

      expect(router).toBeDefined();
      expect(typeof router).toBe('function'); // Express routers are functions
    });

    it('should have a POST route registered', () => {
      const router = createSetKeyRoute(mockPrisma as unknown as PrismaClient);

      // Check that the router has routes registered
      expect(router.stack).toBeDefined();
      expect(router.stack.length).toBeGreaterThan(0);

      expect(findRoute(router, 'post')).toBeDefined();
    });
  });

  describe('validation', () => {
    it('should reject request with missing provider', async () => {
      const { req, res } = createMockReqRes({ apiKey: 'test-key' });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
        })
      );
    });

    it('should reject request with missing apiKey', async () => {
      const { req, res } = createMockReqRes({ provider: 'openrouter' });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
        })
      );
    });

    it('should reject request with empty apiKey', async () => {
      const { req, res } = createMockReqRes({ provider: 'openrouter', apiKey: '' });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject invalid provider', async () => {
      const { req, res } = createMockReqRes({ provider: 'invalid-provider', apiKey: 'test-key' });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: expect.stringContaining('provider'),
        })
      );
    });
  });

  describe('API key validation', () => {
    it('should validate API key with provider', async () => {
      const { req, res } = createMockReqRes({
        provider: AIProvider.OpenRouter,
        apiKey: 'sk-valid-key',
      });

      await callHandler(mockPrisma, req, res);

      expect(mockValidateApiKey).toHaveBeenCalledWith('sk-valid-key', AIProvider.OpenRouter);
    });

    it('should return 403 for invalid API key', async () => {
      mockValidateApiKey.mockResolvedValue({
        valid: false,
        errorCode: 'INVALID_KEY',
        error: 'Invalid API key',
      });

      const { req, res } = createMockReqRes({
        provider: AIProvider.OpenRouter,
        apiKey: 'sk-invalid-key',
      });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'UNAUTHORIZED',
        })
      );
    });

    it('should return 402 for quota exceeded', async () => {
      mockValidateApiKey.mockResolvedValue({
        valid: false,
        errorCode: 'QUOTA_EXCEEDED',
        error: 'Insufficient credits',
      });

      const { req, res } = createMockReqRes({
        provider: AIProvider.OpenRouter,
        apiKey: 'sk-no-credits',
      });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'PAYMENT_REQUIRED',
        })
      );
    });

    it('should return 400 for other validation errors', async () => {
      mockValidateApiKey.mockResolvedValue({
        valid: false,
        errorCode: 'UNKNOWN',
        error: 'Could not reach provider',
      });

      const { req, res } = createMockReqRes({
        provider: AIProvider.OpenRouter,
        apiKey: 'sk-test-key',
      });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('successful key storage', () => {
    it('should create user via UserService if not exists', async () => {
      const { req, res } = createMockReqRes({
        provider: AIProvider.OpenRouter,
        apiKey: 'sk-valid-key',
      });

      await callHandler(mockPrisma, req, res);

      // UserService uses findUnique then $transaction for user creation
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { discordId: 'discord-user-123' },
        })
      );
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('should encrypt and store API key', async () => {
      const { req, res } = createMockReqRes({
        provider: AIProvider.OpenRouter,
        apiKey: 'sk-valid-key',
      });

      await callHandler(mockPrisma, req, res);

      // UserService now generates deterministic UUIDs for users
      expect(mockPrisma.userApiKey.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_provider: {
              userId: expect.any(String), // Deterministic UUID generated by UserService
              provider: AIProvider.OpenRouter,
            },
          },
          create: expect.objectContaining({
            provider: AIProvider.OpenRouter,
            iv: expect.any(String),
            content: expect.any(String),
            tag: expect.any(String),
          }),
        })
      );
    });

    it('should return success with credits', async () => {
      mockValidateApiKey.mockResolvedValue({ valid: true, credits: 50.25 });

      const { req, res } = createMockReqRes({
        provider: AIProvider.OpenRouter,
        apiKey: 'sk-valid-key',
      });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          provider: AIProvider.OpenRouter,
          credits: 50.25,
        })
      );
    });

    it('should return success without credits when not provided', async () => {
      mockValidateApiKey.mockResolvedValue({ valid: true });

      const { req, res } = createMockReqRes({
        provider: AIProvider.OpenRouter,
        apiKey: 'sk-valid-key',
      });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          provider: AIProvider.OpenRouter,
          credits: undefined,
        })
      );
    });
  });

  describe('provider validation', () => {
    it('should support OpenRouter provider', () => {
      expect(AIProvider.OpenRouter).toBe('openrouter');
    });
  });

  describe('user creation via UserService', () => {
    // Note: Bot owner auto-promotion tests are in UserService.test.ts
    // These tests verify the route correctly uses UserService for user creation

    it('should create user via UserService when storing API key', async () => {
      mockBotOwnerId = undefined;

      const { req, res } = createMockReqRes({
        provider: AIProvider.OpenRouter,
        apiKey: 'sk-valid-key',
      });

      await callHandler(mockPrisma, req, res);

      // User creation is now handled by UserService which uses $transaction
      // Verify user was created by checking the transaction was called
      expect(mockPrisma.$transaction).toHaveBeenCalled();

      // API key should be stored with the user ID returned by UserService
      expect(mockPrisma.userApiKey.upsert).toHaveBeenCalled();

      // Response should be successful
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
