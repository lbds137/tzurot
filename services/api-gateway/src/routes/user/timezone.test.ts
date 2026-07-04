/**
 * Tests for /user/timezone routes
 *
 * Comprehensive tests for getting and setting user timezones.
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
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { getRouteHandler, findRoute } from '../../test/expressRouterUtils.js';

// Helper to create mock request/response
function createMockReqRes(body: Record<string, unknown> = {}) {
  const req = {
    body,
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
      const router = createTimezoneRoutes({ prisma: mockPrisma as unknown as PrismaClient });

      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });

    it('should have GET route registered', () => {
      const router = createTimezoneRoutes({ prisma: mockPrisma as unknown as PrismaClient });

      expect(router.stack).toBeDefined();
      expect(router.stack.length).toBeGreaterThan(0);

      expect(findRoute(router, 'get', '/')).toBeDefined();
    });

    it('should have PUT route registered', () => {
      const router = createTimezoneRoutes({ prisma: mockPrisma as unknown as PrismaClient });

      expect(findRoute(router, 'put', '/')).toBeDefined();
    });
  });

  describe('GET /user/timezone', () => {
    // Provisioning middleware sets `req.provisionedUserId`; route reads it
    // directly (no shadow-mode resolver call). Each GET/PUT handler issues a
    // SINGLE `user.findUnique` call: the timezone data read.

    it('should return 404 when user row is missing', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      const router = createTimezoneRoutes({ prisma: mockPrisma as unknown as PrismaClient });
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return user timezone', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ timezone: 'America/New_York' });

      const router = createTimezoneRoutes({ prisma: mockPrisma as unknown as PrismaClient });
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
      mockPrisma.user.findUnique.mockResolvedValueOnce({ timezone: 'UTC' });

      const router = createTimezoneRoutes({ prisma: mockPrisma as unknown as PrismaClient });
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
      mockPrisma.user.findUnique.mockResolvedValueOnce({ timezone: 'UTC' });

      const router = createTimezoneRoutes({ prisma: mockPrisma as unknown as PrismaClient });
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-uuid-123' },
        select: { timezone: true },
      });
    });
  });

  describe('PUT /user/timezone', () => {
    it('should reject missing timezone', async () => {
      const router = createTimezoneRoutes({ prisma: mockPrisma as unknown as PrismaClient });
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
      const router = createTimezoneRoutes({ prisma: mockPrisma as unknown as PrismaClient });
      const handler = getHandler(router, 'put', '/');
      const { req, res } = createMockReqRes({ timezone: null });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject empty timezone', async () => {
      const router = createTimezoneRoutes({ prisma: mockPrisma as unknown as PrismaClient });
      const handler = getHandler(router, 'put', '/');
      const { req, res } = createMockReqRes({ timezone: '' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject invalid timezone', async () => {
      const router = createTimezoneRoutes({ prisma: mockPrisma as unknown as PrismaClient });
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
      const router = createTimezoneRoutes({ prisma: mockPrisma as unknown as PrismaClient });
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
      const router = createTimezoneRoutes({ prisma: mockPrisma as unknown as PrismaClient });
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

    it('should return timezone info in response', async () => {
      const router = createTimezoneRoutes({ prisma: mockPrisma as unknown as PrismaClient });
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
