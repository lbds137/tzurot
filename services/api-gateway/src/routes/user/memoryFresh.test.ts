/**
 * Tests for /user/memory/fresh routes
 *
 * Fresh mode shares its status/enable/disable machinery with incognito
 * (memoryModeHandlers.ts — mechanics covered in depth there and in
 * memoryIncognito.test.ts); these tests pin what is fresh-SPECIFIC: the
 * route wiring, the `fresh:` key prefix, and the user-facing copy, which
 * must make "memories are kept, just not used" unmissable.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

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

vi.mock('../../services/AuthMiddleware.js');

vi.mock('../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

const mockPrisma = {
  personality: {
    findUnique: vi.fn(),
  },
};

const mockRedis = {
  setex: vi.fn().mockResolvedValue('OK'),
  set: vi.fn().mockResolvedValue('OK'),
  get: vi.fn().mockResolvedValue(null),
  del: vi.fn().mockResolvedValue(1),
  scan: vi.fn().mockResolvedValue(['0', []]),
  mget: vi.fn().mockResolvedValue([]),
};

import { createFreshRoutes } from './memoryFresh.js';
import { getRouteHandler, findRoute } from '../../test/expressRouterUtils.js';
import { REDIS_KEY_PREFIXES } from '@tzurot/common-types/constants/queue';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { Redis } from 'ioredis';

const TEST_PERSONALITY_ID = '00000000-0000-4000-8000-000000000003';
const TEST_DISCORD_USER_ID = 'discord-user-123';

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

function buildRouter() {
  return createFreshRoutes(mockPrisma as unknown as PrismaClient, mockRedis as unknown as Redis);
}

describe('/user/memory/fresh routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'));

    mockPrisma.personality.findUnique.mockResolvedValue({
      id: TEST_PERSONALITY_ID,
      name: 'Test Personality',
    });

    mockRedis.scan.mockResolvedValue(['0', []]);
    mockRedis.get.mockResolvedValue(null);
  });

  describe('route factory', () => {
    it('registers GET, POST, and DELETE at the root', () => {
      const router = buildRouter();
      expect(findRoute(router, 'get', '/')).toBeDefined();
      expect(findRoute(router, 'post', '/')).toBeDefined();
      expect(findRoute(router, 'delete', '/')).toBeDefined();
    });
  });

  describe('POST / (enable)', () => {
    it('stores the session under the fresh: prefix and says memories are kept', async () => {
      const handler = getRouteHandler(buildRouter(), 'post', '/');
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        duration: '1h',
      });

      await handler(req, res);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.FRESH}${TEST_DISCORD_USER_ID}:${TEST_PERSONALITY_ID}`,
        3600,
        expect.any(String)
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          wasAlreadyActive: false,
          message: expect.stringContaining('memories are kept, just not used'),
        })
      );
    });

    it('supports the global "all" scope', async () => {
      const handler = getRouteHandler(buildRouter(), 'post', '/');
      const { req, res } = createMockReqRes({ personalityId: 'all', duration: 'forever' });

      await handler(req, res);

      expect(mockRedis.set).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.FRESH}${TEST_DISCORD_USER_ID}:all`,
        expect.any(String)
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('all personalities'),
        })
      );
    });
  });

  describe('DELETE / (disable)', () => {
    it('deletes the fresh session and says memories will be used again', async () => {
      const handler = getRouteHandler(buildRouter(), 'delete', '/');
      const { req, res } = createMockReqRes({ personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(mockRedis.del).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.FRESH}${TEST_DISCORD_USER_ID}:${TEST_PERSONALITY_ID}`
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          disabled: true,
          message: expect.stringContaining('will use their memories of you again'),
        })
      );
    });
  });

  describe('GET / (status)', () => {
    it('scans the fresh: keyspace, not incognito', async () => {
      const handler = getRouteHandler(buildRouter(), 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(mockRedis.scan).toHaveBeenCalledWith(
        '0',
        'MATCH',
        `${REDIS_KEY_PREFIXES.FRESH}${TEST_DISCORD_USER_ID}:*`,
        'COUNT',
        100
      );
      expect(res.json).toHaveBeenCalledWith({ active: false, sessions: [] });
    });
  });
});
