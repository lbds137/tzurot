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
}));

vi.mock('../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

// Mock Prisma - includes methods needed by UserService
const mockPrisma = {
  user: {
    findFirst: vi.fn(),
    findUnique: vi.fn().mockResolvedValue(null), // No existing user - triggers create
    create: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
    update: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
    upsert: vi.fn(),
  },
  persona: {
    create: vi.fn().mockResolvedValue({ id: 'persona-uuid-123' }),
  },
  $transaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
    const mockTx = {
      user: {
        create: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
        update: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = (router.stack as any[]).find(
    l => l.route?.path === path && l.route?.methods?.[method]
  );
  return (layer as { route: { stack: Array<{ handle: Function }> } }).route.stack[
    (layer as { route: { stack: Array<{ handle: Function }> } }).route.stack.length - 1
  ].handle;
}

describe('/user/timezone routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findFirst.mockResolvedValue({ timezone: 'UTC' });
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

      const getRoute = (
        router.stack as unknown as Array<{ route?: { path?: string; methods?: { get?: boolean } } }>
      ).find(layer => layer.route?.path === '/' && layer.route?.methods?.get);
      expect(getRoute).toBeDefined();
    });

    it('should have PUT route registered', () => {
      const router = createTimezoneRoutes(mockPrisma as unknown as PrismaClient);

      const putRoute = (
        router.stack as unknown as Array<{ route?: { path?: string; methods?: { put?: boolean } } }>
      ).find(layer => layer.route?.path === '/' && layer.route?.methods?.put);
      expect(putRoute).toBeDefined();
    });
  });

  describe('GET /user/timezone', () => {
    it('should return default UTC when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const router = createTimezoneRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          timezone: 'UTC',
          isDefault: true,
        })
      );
    });

    it('should return user timezone', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ timezone: 'America/New_York' });

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
      mockPrisma.user.findFirst.mockResolvedValue({ timezone: 'UTC' });

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

    it('should query user by Discord ID', async () => {
      const router = createTimezoneRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { discordId: 'discord-user-123' },
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
          message: expect.stringContaining('timezone is required'),
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

    it('should create user via UserService and update timezone', async () => {
      const router = createTimezoneRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/');
      const { req, res } = createMockReqRes({ timezone: 'Europe/London' });

      await handler(req, res);

      // UserService is now used to create/get user
      expect(mockPrisma.$transaction).toHaveBeenCalled();

      // Timezone is then updated via direct update
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: expect.any(String) }, // Deterministic UUID
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
