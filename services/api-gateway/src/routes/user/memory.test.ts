/**
 * Tests for /user/memory routes
 *
 * Tests LTM (Long-Term Memory) management endpoints:
 * - GET /stats - Get memory statistics for a personality
 * - GET /focus - Get focus mode status
 * - POST /focus - Enable/disable focus mode
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
    generateUserPersonalityConfigUuid: vi.fn(
      (userId: string, personalityId: string) => `config-${userId}-${personalityId}`
    ),
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
    findUnique: vi.fn(),
  },
  personality: {
    findUnique: vi.fn(),
  },
  userPersonalityConfig: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  memory: {
    count: vi.fn(),
    findFirst: vi.fn(),
  },
};

import { createMemoryRoutes } from './memory.js';
import type { PrismaClient } from '@tzurot/common-types';

// Test constants
const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_PERSONA_ID = '00000000-0000-0000-0000-000000000002';
const TEST_PERSONALITY_ID = '00000000-0000-0000-0000-000000000003';
const TEST_DISCORD_USER_ID = 'discord-user-123';

// Helper to create mock request/response
function createMockReqRes(body: Record<string, unknown> = {}, query: Record<string, unknown> = {}) {
  const req = {
    body,
    query,
    userId: TEST_DISCORD_USER_ID,
  } as unknown as Request & { userId: string };

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

// Helper to get handler from router
function getHandler(
  router: ReturnType<typeof createMemoryRoutes>,
  method: 'get' | 'post' | 'delete',
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

describe('/user/memory routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks
    mockPrisma.user.findUnique.mockResolvedValue({
      id: TEST_USER_ID,
      discordId: TEST_DISCORD_USER_ID,
      defaultPersonaId: TEST_PERSONA_ID,
    });

    mockPrisma.personality.findUnique.mockResolvedValue({
      id: TEST_PERSONALITY_ID,
      name: 'Test Personality',
    });

    mockPrisma.userPersonalityConfig.findUnique.mockResolvedValue({
      personaId: TEST_PERSONA_ID,
      focusModeEnabled: false,
    });

    mockPrisma.userPersonalityConfig.upsert.mockResolvedValue({});

    mockPrisma.memory.count.mockResolvedValue(0);
    mockPrisma.memory.findFirst.mockResolvedValue(null);
  });

  describe('route factory', () => {
    it('should create a router', () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);

      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });

    it('should have GET /stats route registered', () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);

      const route = (
        router.stack as unknown as Array<{ route?: { path?: string; methods?: { get?: boolean } } }>
      ).find(layer => layer.route?.path === '/stats' && layer.route?.methods?.get);
      expect(route).toBeDefined();
    });

    it('should have GET /focus route registered', () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);

      const route = (
        router.stack as unknown as Array<{ route?: { path?: string; methods?: { get?: boolean } } }>
      ).find(layer => layer.route?.path === '/focus' && layer.route?.methods?.get);
      expect(route).toBeDefined();
    });

    it('should have POST /focus route registered', () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);

      const route = (
        router.stack as unknown as Array<{
          route?: { path?: string; methods?: { post?: boolean } };
        }>
      ).find(layer => layer.route?.path === '/focus' && layer.route?.methods?.post);
      expect(route).toBeDefined();
    });
  });

  describe('GET /user/memory/stats', () => {
    it('should reject missing personalityId', async () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/stats');
      const { req, res } = createMockReqRes({}, {});

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: expect.stringContaining('personalityId'),
        })
      );
    });

    it('should return 404 when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/stats');
      const { req, res } = createMockReqRes({}, { personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 404 when personality not found', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue(null);

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/stats');
      const { req, res } = createMockReqRes({}, { personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return stats with zero counts when user has no persona', async () => {
      mockPrisma.userPersonalityConfig.findUnique.mockResolvedValue(null);
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: TEST_USER_ID }) // First call - check user
        .mockResolvedValueOnce({ defaultPersonaId: null }); // Second call - get default persona

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/stats');
      const { req, res } = createMockReqRes({}, { personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          personalityId: TEST_PERSONALITY_ID,
          personaId: null,
          totalCount: 0,
          lockedCount: 0,
          oldestMemory: null,
          newestMemory: null,
          focusModeEnabled: false,
        })
      );
    });

    it('should return stats when user has memories', async () => {
      const oldestDate = new Date('2024-01-01');
      const newestDate = new Date('2024-06-01');

      mockPrisma.memory.count
        .mockResolvedValueOnce(42) // total count
        .mockResolvedValueOnce(5); // locked count
      mockPrisma.memory.findFirst
        .mockResolvedValueOnce({ createdAt: oldestDate }) // oldest
        .mockResolvedValueOnce({ createdAt: newestDate }); // newest

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/stats');
      const { req, res } = createMockReqRes({}, { personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          personalityId: TEST_PERSONALITY_ID,
          personalityName: 'Test Personality',
          personaId: TEST_PERSONA_ID,
          totalCount: 42,
          lockedCount: 5,
          oldestMemory: oldestDate.toISOString(),
          newestMemory: newestDate.toISOString(),
          focusModeEnabled: false,
        })
      );
    });

    it('should return focusModeEnabled true when enabled', async () => {
      mockPrisma.userPersonalityConfig.findUnique.mockResolvedValue({
        personaId: TEST_PERSONA_ID,
        focusModeEnabled: true,
      });

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/stats');
      const { req, res } = createMockReqRes({}, { personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          focusModeEnabled: true,
        })
      );
    });
  });

  describe('GET /user/memory/focus', () => {
    it('should reject missing personalityId', async () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/focus');
      const { req, res } = createMockReqRes({}, {});

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('personalityId'),
        })
      );
    });

    it('should return 404 when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/focus');
      const { req, res } = createMockReqRes({}, { personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return focusModeEnabled false when no config exists', async () => {
      mockPrisma.userPersonalityConfig.findUnique.mockResolvedValue(null);

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/focus');
      const { req, res } = createMockReqRes({}, { personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          personalityId: TEST_PERSONALITY_ID,
          focusModeEnabled: false,
        })
      );
    });

    it('should return focusModeEnabled true when enabled', async () => {
      mockPrisma.userPersonalityConfig.findUnique.mockResolvedValue({
        focusModeEnabled: true,
      });

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/focus');
      const { req, res } = createMockReqRes({}, { personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          personalityId: TEST_PERSONALITY_ID,
          focusModeEnabled: true,
        })
      );
    });
  });

  describe('POST /user/memory/focus', () => {
    it('should reject missing personalityId', async () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/focus');
      const { req, res } = createMockReqRes({ enabled: true });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('personalityId'),
        })
      );
    });

    it('should reject missing enabled field', async () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/focus');
      const { req, res } = createMockReqRes({ personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('enabled'),
        })
      );
    });

    it('should reject non-boolean enabled', async () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/focus');
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        enabled: 'true', // string instead of boolean
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/focus');
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        enabled: true,
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 404 when personality not found', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue(null);

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/focus');
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        enabled: true,
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should enable focus mode successfully', async () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/focus');
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        enabled: true,
      });

      await handler(req, res);

      expect(mockPrisma.userPersonalityConfig.upsert).toHaveBeenCalledWith({
        where: {
          userId_personalityId: {
            userId: TEST_USER_ID,
            personalityId: TEST_PERSONALITY_ID,
          },
        },
        update: {
          focusModeEnabled: true,
        },
        create: expect.objectContaining({
          userId: TEST_USER_ID,
          personalityId: TEST_PERSONALITY_ID,
          focusModeEnabled: true,
        }),
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          personalityId: TEST_PERSONALITY_ID,
          personalityName: 'Test Personality',
          focusModeEnabled: true,
          message: expect.stringContaining('enabled'),
        })
      );
    });

    it('should disable focus mode successfully', async () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/focus');
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        enabled: false,
      });

      await handler(req, res);

      expect(mockPrisma.userPersonalityConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: {
            focusModeEnabled: false,
          },
          create: expect.objectContaining({
            focusModeEnabled: false,
          }),
        })
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          focusModeEnabled: false,
          message: expect.stringContaining('disabled'),
        })
      );
    });
  });
});
