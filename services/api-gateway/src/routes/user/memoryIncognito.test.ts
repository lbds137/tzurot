/**
 * Tests for /user/memory/incognito routes
 *
 * Tests Incognito Mode endpoints:
 * - GET / - Get incognito status for user
 * - POST / - Enable incognito mode
 * - DELETE / - Disable incognito mode
 * - POST /forget - Retroactively delete recent memories
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
    findUnique: vi.fn(),
  },
  personality: {
    findUnique: vi.fn(),
  },
  memory: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
};

// Mock Redis
const mockRedis = {
  setex: vi.fn().mockResolvedValue('OK'),
  set: vi.fn().mockResolvedValue('OK'),
  get: vi.fn().mockResolvedValue(null),
  del: vi.fn().mockResolvedValue(1),
  scan: vi.fn().mockResolvedValue(['0', []]),
  mget: vi.fn().mockResolvedValue([]),
};

import { createIncognitoRoutes } from './memoryIncognito.js';
import { getRouteHandler, findRoute } from '../../test/expressRouterUtils.js';
import type { PrismaClient } from '@tzurot/common-types';
import type { Redis } from 'ioredis';

// Test constants - Must be valid v4 UUIDs (position 14 = '4', position 19 = 8/9/a/b)
const TEST_USER_ID = '00000000-0000-4000-8000-000000000001';
const TEST_PERSONA_ID = '00000000-0000-4000-8000-000000000002';
const TEST_PERSONALITY_ID = '00000000-0000-4000-8000-000000000003';
const TEST_NONEXISTENT_ID = '00000000-0000-4000-8000-000000000099';
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
  router: ReturnType<typeof createIncognitoRoutes>,
  method: 'get' | 'post' | 'delete',
  path: string
) {
  return getRouteHandler(router, method, path);
}

describe('/user/memory/incognito routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'));

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

    mockRedis.scan.mockResolvedValue(['0', []]);
    mockRedis.get.mockResolvedValue(null);
  });

  describe('route factory', () => {
    it('should create a router', () => {
      const router = createIncognitoRoutes(
        mockPrisma as unknown as PrismaClient,
        mockRedis as unknown as Redis
      );

      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });

    it('should have GET / route registered', () => {
      const router = createIncognitoRoutes(
        mockPrisma as unknown as PrismaClient,
        mockRedis as unknown as Redis
      );

      expect(findRoute(router, 'get', '/')).toBeDefined();
    });

    it('should have POST / route registered', () => {
      const router = createIncognitoRoutes(
        mockPrisma as unknown as PrismaClient,
        mockRedis as unknown as Redis
      );

      expect(findRoute(router, 'post', '/')).toBeDefined();
    });

    it('should have DELETE / route registered', () => {
      const router = createIncognitoRoutes(
        mockPrisma as unknown as PrismaClient,
        mockRedis as unknown as Redis
      );

      expect(findRoute(router, 'delete', '/')).toBeDefined();
    });

    it('should have POST /forget route registered', () => {
      const router = createIncognitoRoutes(
        mockPrisma as unknown as PrismaClient,
        mockRedis as unknown as Redis
      );

      expect(findRoute(router, 'post', '/forget')).toBeDefined();
    });
  });

  describe('GET /user/memory/incognito (status)', () => {
    it('should return inactive status when no sessions', async () => {
      mockRedis.scan.mockResolvedValue(['0', []]);

      const router = createIncognitoRoutes(
        mockPrisma as unknown as PrismaClient,
        mockRedis as unknown as Redis
      );
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          active: false,
        })
      );
    });

    it('should return active status with sessions', async () => {
      const session = {
        userId: TEST_DISCORD_USER_ID,
        personalityId: TEST_PERSONALITY_ID,
        enabledAt: '2026-01-15T11:00:00.000Z',
        expiresAt: '2026-01-15T13:00:00.000Z',
        duration: '1h',
      };

      mockRedis.scan.mockResolvedValue([
        '0',
        [`incognito:${TEST_DISCORD_USER_ID}:${TEST_PERSONALITY_ID}`],
      ]);
      mockRedis.mget.mockResolvedValue([JSON.stringify(session)]);

      const router = createIncognitoRoutes(
        mockPrisma as unknown as PrismaClient,
        mockRedis as unknown as Redis
      );
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          active: true,
          sessions: expect.arrayContaining([
            expect.objectContaining({
              personalityId: TEST_PERSONALITY_ID,
            }),
          ]),
        })
      );
    });
  });

  describe('POST /user/memory/incognito (enable)', () => {
    it('should reject missing personalityId', async () => {
      const router = createIncognitoRoutes(
        mockPrisma as unknown as PrismaClient,
        mockRedis as unknown as Redis
      );
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({ duration: '1h' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
        })
      );
    });

    it('should reject missing duration', async () => {
      const router = createIncognitoRoutes(
        mockPrisma as unknown as PrismaClient,
        mockRedis as unknown as Redis
      );
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({ personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
        })
      );
    });

    it('should reject invalid duration', async () => {
      const router = createIncognitoRoutes(
        mockPrisma as unknown as PrismaClient,
        mockRedis as unknown as Redis
      );
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        duration: 'invalid',
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
        })
      );
    });

    it('should return 404 when personality not found', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue(null);

      const router = createIncognitoRoutes(
        mockPrisma as unknown as PrismaClient,
        mockRedis as unknown as Redis
      );
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        personalityId: TEST_NONEXISTENT_ID, // Valid UUID format, but not in DB
        duration: '1h',
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'NOT_FOUND',
        })
      );
    });

    it('should enable incognito mode with TTL', async () => {
      mockRedis.get.mockResolvedValue(null); // No existing session

      const router = createIncognitoRoutes(
        mockPrisma as unknown as PrismaClient,
        mockRedis as unknown as Redis
      );
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        duration: '1h',
      });

      await handler(req, res);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.stringContaining(TEST_PERSONALITY_ID),
        3600, // 1 hour in seconds
        expect.any(String)
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          session: expect.objectContaining({
            personalityId: TEST_PERSONALITY_ID,
            duration: '1h',
          }),
        })
      );
    });

    it('should enable incognito for "all" without TTL', async () => {
      mockRedis.get.mockResolvedValue(null);

      const router = createIncognitoRoutes(
        mockPrisma as unknown as PrismaClient,
        mockRedis as unknown as Redis
      );
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        personalityId: 'all',
        duration: 'forever',
      });

      await handler(req, res);

      // 'forever' uses SET not SETEX
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining(':all'),
        expect.any(String)
      );
      expect(mockRedis.setex).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('should return existing session if already active', async () => {
      const existingSession = {
        userId: TEST_DISCORD_USER_ID,
        personalityId: TEST_PERSONALITY_ID,
        enabledAt: '2026-01-15T11:00:00.000Z',
        expiresAt: '2026-01-15T13:00:00.000Z',
        duration: '1h',
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(existingSession));

      const router = createIncognitoRoutes(
        mockPrisma as unknown as PrismaClient,
        mockRedis as unknown as Redis
      );
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        duration: '4h', // Different duration
      });

      await handler(req, res);

      // Should NOT create new session
      expect(mockRedis.setex).not.toHaveBeenCalled();
      expect(mockRedis.set).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          wasAlreadyActive: true,
          message: expect.stringContaining('already active'),
        })
      );
    });

    it('should return wasAlreadyActive: false when creating new session', async () => {
      mockRedis.get.mockResolvedValue(null);

      const router = createIncognitoRoutes(
        mockPrisma as unknown as PrismaClient,
        mockRedis as unknown as Redis
      );
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        duration: '1h',
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          wasAlreadyActive: false,
        })
      );
    });
  });

  describe('DELETE /user/memory/incognito (disable)', () => {
    it('should reject missing personalityId', async () => {
      const router = createIncognitoRoutes(
        mockPrisma as unknown as PrismaClient,
        mockRedis as unknown as Redis
      );
      const handler = getHandler(router, 'delete', '/');
      const { req, res } = createMockReqRes({});

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
        })
      );
    });

    it('should disable incognito mode', async () => {
      mockRedis.del.mockResolvedValue(1);

      const router = createIncognitoRoutes(
        mockPrisma as unknown as PrismaClient,
        mockRedis as unknown as Redis
      );
      const handler = getHandler(router, 'delete', '/');
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
      });

      await handler(req, res);

      expect(mockRedis.del).toHaveBeenCalledWith(expect.stringContaining(TEST_PERSONALITY_ID));
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          disabled: true,
        })
      );
    });

    it('should return disabled=false when session did not exist', async () => {
      mockRedis.del.mockResolvedValue(0);

      const router = createIncognitoRoutes(
        mockPrisma as unknown as PrismaClient,
        mockRedis as unknown as Redis
      );
      const handler = getHandler(router, 'delete', '/');
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          disabled: false,
        })
      );
    });
  });

  describe('POST /user/memory/incognito/forget', () => {
    it('should reject missing personalityId', async () => {
      const router = createIncognitoRoutes(
        mockPrisma as unknown as PrismaClient,
        mockRedis as unknown as Redis
      );
      const handler = getHandler(router, 'post', '/forget');
      const { req, res } = createMockReqRes({ timeframe: '15m' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
        })
      );
    });

    it('should reject missing timeframe', async () => {
      const router = createIncognitoRoutes(
        mockPrisma as unknown as PrismaClient,
        mockRedis as unknown as Redis
      );
      const handler = getHandler(router, 'post', '/forget');
      const { req, res } = createMockReqRes({ personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
        })
      );
    });

    it('should reject invalid timeframe', async () => {
      const router = createIncognitoRoutes(
        mockPrisma as unknown as PrismaClient,
        mockRedis as unknown as Redis
      );
      const handler = getHandler(router, 'post', '/forget');
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        timeframe: 'invalid',
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
        })
      );
    });

    it('should return 404 when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const router = createIncognitoRoutes(
        mockPrisma as unknown as PrismaClient,
        mockRedis as unknown as Redis
      );
      const handler = getHandler(router, 'post', '/forget');
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        timeframe: '15m',
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'NOT_FOUND',
        })
      );
    });

    it('should return zero count when no persona', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: TEST_USER_ID,
        discordId: TEST_DISCORD_USER_ID,
        defaultPersonaId: null, // No persona
      });

      const router = createIncognitoRoutes(
        mockPrisma as unknown as PrismaClient,
        mockRedis as unknown as Redis
      );
      const handler = getHandler(router, 'post', '/forget');
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        timeframe: '15m',
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          deletedCount: 0,
        })
      );
    });

    it('should delete recent memories and return count', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([
        { personalityId: TEST_PERSONALITY_ID, personality: { name: 'Test Personality' } },
      ]);
      mockPrisma.memory.deleteMany.mockResolvedValue({ count: 5 });

      const router = createIncognitoRoutes(
        mockPrisma as unknown as PrismaClient,
        mockRedis as unknown as Redis
      );
      const handler = getHandler(router, 'post', '/forget');
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        timeframe: '15m',
      });

      await handler(req, res);

      expect(mockPrisma.memory.deleteMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          personaId: TEST_PERSONA_ID,
          isLocked: false, // Should NOT delete locked memories
        }),
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          deletedCount: 5,
          personalities: ['Test Personality'],
        })
      );
    });

    it('should not delete locked memories (verified via where clause)', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([]);
      mockPrisma.memory.deleteMany.mockResolvedValue({ count: 0 });

      const router = createIncognitoRoutes(
        mockPrisma as unknown as PrismaClient,
        mockRedis as unknown as Redis
      );
      const handler = getHandler(router, 'post', '/forget');
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        timeframe: '15m',
      });

      await handler(req, res);

      // Verify isLocked: false is in the where clause
      expect(mockPrisma.memory.deleteMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          isLocked: false,
        }),
      });
    });

    it('should delete for all personalities when "all" specified', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([
        { personalityId: 'p1', personality: { name: 'Personality 1' } },
        { personalityId: 'p2', personality: { name: 'Personality 2' } },
      ]);
      mockPrisma.memory.deleteMany.mockResolvedValue({ count: 10 });

      const router = createIncognitoRoutes(
        mockPrisma as unknown as PrismaClient,
        mockRedis as unknown as Redis
      );
      const handler = getHandler(router, 'post', '/forget');
      const { req, res } = createMockReqRes({
        personalityId: 'all',
        timeframe: '1h',
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          deletedCount: 10,
          personalities: expect.arrayContaining(['Personality 1', 'Personality 2']),
        })
      );
    });
  });
});
