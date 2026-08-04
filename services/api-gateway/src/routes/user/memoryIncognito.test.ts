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

import {
  handleGetIncognitoStatus,
  handleEnableIncognito,
  handleDisableIncognito,
  handleIncognitoForget,
} from './memoryIncognito.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
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
    provisionedUserId: TEST_USER_ID,
    provisionedDefaultPersonaId: 'persona-uuid-default',
  } as unknown as Request & { userId: string };

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

// Standard handler deps (prisma + redis) — the shape mounts.ts wires in prod.
function modeDeps() {
  return {
    prisma: mockPrisma as unknown as PrismaClient,
    redis: mockRedis as unknown as Redis,
  };
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

  // Route wiring (paths, middleware, registration) is owned by the generated
  // mounts.ts — `pnpm ops codegen:routes --check` pins it against the
  // manifest, so these tests exercise the handlers directly.
  describe('GET /api/user/memory/incognito (status)', () => {
    it('should return inactive status when no sessions', async () => {
      mockRedis.scan.mockResolvedValue(['0', []]);

      const handler = handleGetIncognitoStatus(modeDeps());
      const { req, res } = createMockReqRes();

      await handler(req, res, vi.fn());

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

      const handler = handleGetIncognitoStatus(modeDeps());
      const { req, res } = createMockReqRes();

      await handler(req, res, vi.fn());

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

  describe('POST /api/user/memory/incognito (enable)', () => {
    it('should reject missing personalityId', async () => {
      const handler = handleEnableIncognito(modeDeps());
      const { req, res } = createMockReqRes({ duration: '1h' });

      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
        })
      );
    });

    it('should reject missing duration', async () => {
      const handler = handleEnableIncognito(modeDeps());
      const { req, res } = createMockReqRes({ personalityId: TEST_PERSONALITY_ID });

      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
        })
      );
    });

    it('should reject invalid duration', async () => {
      const handler = handleEnableIncognito(modeDeps());
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        duration: 'invalid',
      });

      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
        })
      );
    });

    it('should return 404 when personality not found', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue(null);

      const handler = handleEnableIncognito(modeDeps());
      const { req, res } = createMockReqRes({
        personalityId: TEST_NONEXISTENT_ID, // Valid UUID format, but not in DB
        duration: '1h',
      });

      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'NOT_FOUND',
        })
      );
    });

    it('should enable incognito mode with TTL', async () => {
      mockRedis.get.mockResolvedValue(null); // No existing session

      const handler = handleEnableIncognito(modeDeps());
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        duration: '1h',
      });

      await handler(req, res, vi.fn());

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

      const handler = handleEnableIncognito(modeDeps());
      const { req, res } = createMockReqRes({
        personalityId: 'all',
        duration: 'forever',
      });

      await handler(req, res, vi.fn());

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

      const handler = handleEnableIncognito(modeDeps());
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        duration: '4h', // Different duration
      });

      await handler(req, res, vi.fn());

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

      const handler = handleEnableIncognito(modeDeps());
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        duration: '1h',
      });

      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          wasAlreadyActive: false,
        })
      );
    });
  });

  describe('DELETE /api/user/memory/incognito (disable)', () => {
    it('should reject missing personalityId', async () => {
      const handler = handleDisableIncognito(modeDeps());
      const { req, res } = createMockReqRes({});

      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
        })
      );
    });

    it('should disable incognito mode', async () => {
      mockRedis.del.mockResolvedValue(1);

      const handler = handleDisableIncognito(modeDeps());
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
      });

      await handler(req, res, vi.fn());

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

      const handler = handleDisableIncognito(modeDeps());
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
      });

      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          disabled: false,
        })
      );
    });
  });

  describe('POST /api/user/memory/incognito/forget', () => {
    it('should reject missing personalityId', async () => {
      const handler = handleIncognitoForget(modeDeps());
      const { req, res } = createMockReqRes({ timeframe: '15m' });

      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
        })
      );
    });

    it('should reject missing timeframe', async () => {
      const handler = handleIncognitoForget(modeDeps());
      const { req, res } = createMockReqRes({ personalityId: TEST_PERSONALITY_ID });

      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
        })
      );
    });

    it('should reject invalid timeframe', async () => {
      const handler = handleIncognitoForget(modeDeps());
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        timeframe: 'invalid',
      });

      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
        })
      );
    });

    it('filters to live memories only — deleteMany where carries visibility normal', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: TEST_USER_ID,
        discordId: TEST_DISCORD_USER_ID,
        defaultPersonaId: 'persona-1',
      });
      mockPrisma.memory.findMany.mockResolvedValue([]);
      mockPrisma.memory.deleteMany.mockResolvedValue({ count: 0 });

      const handler = handleIncognitoForget(modeDeps());
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        timeframe: '15m',
      });

      await handler(req, res, vi.fn());

      // Without the visibility filter, already-soft-deleted rows are re-counted
      // and the reported "forgot N memories" total is inflated.
      expect(mockPrisma.memory.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ visibility: 'normal' }),
        })
      );
      expect(mockPrisma.memory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ visibility: 'normal' }),
        })
      );
    });

    it('should return zero count when no persona', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: TEST_USER_ID,
        discordId: TEST_DISCORD_USER_ID,
        defaultPersonaId: null, // No persona
      });

      const handler = handleIncognitoForget(modeDeps());
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        timeframe: '15m',
      });

      await handler(req, res, vi.fn());

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

      const handler = handleIncognitoForget(modeDeps());
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        timeframe: '15m',
      });

      await handler(req, res, vi.fn());

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

      const handler = handleIncognitoForget(modeDeps());
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        timeframe: '15m',
      });

      await handler(req, res, vi.fn());

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

      const handler = handleIncognitoForget(modeDeps());
      const { req, res } = createMockReqRes({
        personalityId: 'all',
        timeframe: '1h',
      });

      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          deletedCount: 10,
          personalities: expect.arrayContaining(['Personality 1', 'Personality 2']),
        })
      );
    });
  });

  describe('redis-missing 503 guards (handler factories)', () => {
    // The handlers each guard `deps.redis === undefined` and short-circuit
    // with 503 before constructing the IncognitoSessionManager. These
    // exercise the guard branch the modeDeps()-based tests don't reach
    // (modeDeps() always includes a redis instance).

    it('handleGetIncognitoStatus returns 503 when redis is undefined', async () => {
      const handler = handleGetIncognitoStatus({ prisma: mockPrisma as unknown as PrismaClient });
      const { req, res } = createMockReqRes();

      await handler(req as unknown as Request, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('handleEnableIncognito returns 503 when redis is undefined', async () => {
      const handler = handleEnableIncognito({ prisma: mockPrisma as unknown as PrismaClient });
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        duration: '1h',
      });

      await handler(req as unknown as Request, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('handleDisableIncognito returns 503 when redis is undefined', async () => {
      const handler = handleDisableIncognito({ prisma: mockPrisma as unknown as PrismaClient });
      const { req, res } = createMockReqRes({ personalityId: TEST_PERSONALITY_ID });

      await handler(req as unknown as Request, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(503);
    });
  });
});
