/**
 * Tests for /user/timezone routes
 *
 * Comprehensive tests for getting and setting user timezones.
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
    // Keep actual implementations for timezone functions
    isValidTimezone: actual.isValidTimezone,
    getTimezoneInfo: actual.getTimezoneInfo,
  };
});

vi.mock('../../services/AuthMiddleware.js', () => ({
  requireUserAuth: vi.fn(() => vi.fn((_req: unknown, _res: unknown, next: () => void) => next())),
  requireProvisionedUser: vi.fn(() =>
    vi.fn((_req: unknown, _res: unknown, next: () => void) => next())
  ),
}));

vi.mock('../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

// Mock Prisma - includes methods needed by UserService
const mockPrisma = {
  user: {
    findFirst: vi.fn(),
    // findUnique is called by BOTH getOrCreateUserShell (select: { id }) and
    // the timezone handler (select: { timezone }). Default returns a user with
    // both fields so either call shape resolves; individual tests override.
    findUnique: vi.fn().mockResolvedValue({ id: 'user-uuid-123', timezone: 'UTC' }),
    create: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
    update: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
    upsert: vi.fn(),
  },
  persona: {
    create: vi.fn().mockResolvedValue({ id: 'persona-uuid-123' }),
  },
  $executeRaw: vi.fn().mockResolvedValue(1),
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

import { createTimezoneRoutes } from './timezone.js';
import type { PrismaClient } from '@tzurot/common-types';
import { getRouteHandler, findRoute } from '../../test/expressRouterUtils.js';

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

// Helper to get handler from router
function getHandler(
  router: ReturnType<typeof createTimezoneRoutes>,
  method: 'get' | 'put',
  path: string
) {
  return getRouteHandler(router, method, path);
}

describe('/user/timezone routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-uuid-123', timezone: 'UTC' });
  });

  describe('route factory', () => {
    it('should create a router', () => {
      const router = createTimezoneRoutes(mockPrisma as unknown as PrismaClient);

      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });

    it('should have GET route registered', () => {
      const router = createTimezoneRoutes(mockPrisma as unknown as PrismaClient);

      expect(router.stack).toBeDefined();
      expect(router.stack.length).toBeGreaterThan(0);

      expect(findRoute(router, 'get', '/')).toBeDefined();
    });

    it('should have PUT route registered', () => {
      const router = createTimezoneRoutes(mockPrisma as unknown as PrismaClient);

      expect(findRoute(router, 'put', '/')).toBeDefined();
    });
  });

  describe('GET /user/timezone', () => {
    // Each GET/PUT handler here issues TWO `user.findUnique` calls in sequence:
    //   1. Inside `getOrCreateUserShell` (shadow-mode UUID resolution) — returns { id }
    //   2. The handler's actual data read — returns the row (or null for the 404 branch)
    // The `mockResolvedValueOnce` pairs below mirror that call order. If
    // `resolveProvisionedUserId`'s shadow-mode path ever changes (e.g., swaps
    // `findUnique` for `findFirst`, or adds an intermediate query), these
    // pairs need to match the new sequence.

    it('should return 404 when user row is missing', async () => {
      // Simulate both the shadow-fallback resolver read AND the timezone
      // read failing to find a row — exercises the defensive 404 branch.
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'user-uuid-123' });
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      const router = createTimezoneRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return user timezone', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'user-uuid-123' });
      mockPrisma.user.findUnique.mockResolvedValueOnce({ timezone: 'America/New_York' });

      const router = createTimezoneRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          timezone: 'America/New_York',
          isDefault: false,
        })
      );
    });

    it('should return isDefault=true for UTC timezone', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'user-uuid-123' });
      mockPrisma.user.findUnique.mockResolvedValueOnce({ timezone: 'UTC' });

      const router = createTimezoneRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          timezone: 'UTC',
          isDefault: true,
        })
      );
    });

    it('should query user timezone by internal UUID', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'user-uuid-123' });
      mockPrisma.user.findUnique.mockResolvedValueOnce({ timezone: 'UTC' });

      const router = createTimezoneRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      // Second findUnique call (after the shadow-resolver one) queries by UUID
      expect(mockPrisma.user.findUnique).toHaveBeenNthCalledWith(2, {
        where: { id: 'user-uuid-123' },
        select: { timezone: true },
      });
    });
  });

  describe('PUT /user/timezone', () => {
    it('should reject missing timezone', async () => {
      const router = createTimezoneRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/');
      const { req, res } = createMockReqRes({});

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: expect.stringContaining('timezone'),
        })
      );
    });

    it('should reject null timezone', async () => {
      const router = createTimezoneRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/');
      const { req, res } = createMockReqRes({ timezone: null });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject empty timezone', async () => {
      const router = createTimezoneRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/');
      const { req, res } = createMockReqRes({ timezone: '' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject invalid timezone', async () => {
      const router = createTimezoneRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/');
      const { req, res } = createMockReqRes({ timezone: 'Invalid/Timezone' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Invalid timezone'),
        })
      );
    });

    it('should accept valid IANA timezone', async () => {
      const router = createTimezoneRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/');
      const { req, res } = createMockReqRes({ timezone: 'America/New_York' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          timezone: 'America/New_York',
        })
      );
    });

    it('should accept UTC timezone', async () => {
      const router = createTimezoneRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/');
      const { req, res } = createMockReqRes({ timezone: 'UTC' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          timezone: 'UTC',
        })
      );
    });

    it('should resolve user via provisioning fallback and update timezone', async () => {
      const router = createTimezoneRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/');
      const { req, res } = createMockReqRes({ timezone: 'Europe/London' });

      await handler(req, res);

      // Shadow-mode fallback: resolveProvisionedUserId calls
      // getOrCreateUserShell which reads the user by discordId.
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { discordId: 'discord-user-123' } })
      );

      // Timezone is then updated via direct update by internal UUID.
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-123' },
        data: { timezone: 'Europe/London' },
      });
    });

    it('should return timezone info in response', async () => {
      const router = createTimezoneRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/');
      const { req, res } = createMockReqRes({ timezone: 'America/Los_Angeles' });

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          timezone: 'America/Los_Angeles',
          label: expect.any(String),
          offset: expect.any(String),
        })
      );
    });
  });
});
