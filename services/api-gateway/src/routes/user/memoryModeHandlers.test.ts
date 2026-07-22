/**
 * Tests for the shared memory-mode handler factories.
 *
 * The full route behavior of each consumer is covered in
 * memoryIncognito.test.ts / memoryFresh.test.ts; this file pins the pieces
 * unique to the shared layer: the optional status character-filter and the
 * no-redis 503 guard.
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

vi.mock('../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

import { createMemoryModeHandlers } from './memoryModeHandlers.js';
import { REDIS_KEY_PREFIXES } from '@tzurot/common-types/constants/queue';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { Redis } from 'ioredis';

const TEST_DISCORD_USER_ID = 'discord-user-123';
const PERSONALITY_A = '00000000-0000-4000-8000-00000000000a';
const PERSONALITY_B = '00000000-0000-4000-8000-00000000000b';

const COPY = {
  alreadyActive: (name: string) => `already ${name}`,
  enabled: (name: string, duration: string) => `enabled ${name} ${duration}`,
  notActive: (name: string) => `not active ${name}`,
  disabled: (name: string) => `disabled ${name}`,
};

function sessionJson(personalityId: string): string {
  return JSON.stringify({
    userId: TEST_DISCORD_USER_ID,
    personalityId,
    enabledAt: '2026-01-15T11:00:00.000Z',
    expiresAt: null,
    duration: 'forever',
  });
}

function createMockReqRes(body: Record<string, unknown> = {}, query: Record<string, unknown> = {}) {
  const req = { body, query, userId: TEST_DISCORD_USER_ID } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

const mockPrisma = { personality: { findUnique: vi.fn() } };

describe('createMemoryModeHandlers', () => {
  const handlers = createMemoryModeHandlers('incognito', COPY);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 503 when redis is not configured', async () => {
    const { req, res } = createMockReqRes();
    await handlers.handleStatus({ prisma: mockPrisma as unknown as PrismaClient })(
      req,
      res,
      vi.fn()
    );
    expect(res.status).toHaveBeenCalledWith(503);
  });

  describe('status character filter', () => {
    function redisWithSessions(): Redis {
      const prefix = REDIS_KEY_PREFIXES.INCOGNITO;
      const keys = [
        `${prefix}${TEST_DISCORD_USER_ID}:${PERSONALITY_A}`,
        `${prefix}${TEST_DISCORD_USER_ID}:${PERSONALITY_B}`,
        `${prefix}${TEST_DISCORD_USER_ID}:all`,
      ];
      return {
        scan: vi.fn().mockResolvedValue(['0', keys]),
        mget: vi
          .fn()
          .mockResolvedValue([
            sessionJson(PERSONALITY_A),
            sessionJson(PERSONALITY_B),
            sessionJson('all'),
          ]),
      } as unknown as Redis;
    }

    it('returns every session when no filter is given', async () => {
      const { req, res } = createMockReqRes();
      await handlers.handleStatus({
        prisma: mockPrisma as unknown as PrismaClient,
        redis: redisWithSessions(),
      })(req, res, vi.fn());

      const payload = vi.mocked(res.json).mock.calls[0][0] as { sessions: unknown[] };
      expect(payload.sessions).toHaveLength(3);
    });

    it('keeps only the specific session plus the global one when filtered', async () => {
      const { req, res } = createMockReqRes({}, { personalityId: PERSONALITY_A });
      await handlers.handleStatus({
        prisma: mockPrisma as unknown as PrismaClient,
        redis: redisWithSessions(),
      })(req, res, vi.fn());

      const payload = vi.mocked(res.json).mock.calls[0][0] as {
        active: boolean;
        sessions: { personalityId: string }[];
      };
      expect(payload.sessions.map(s => s.personalityId).sort()).toEqual([PERSONALITY_A, 'all']);
      expect(payload.active).toBe(true);
    });

    it('rejects a repeated personalityId query key with a 400', async () => {
      const { req, res } = createMockReqRes({}, { personalityId: [PERSONALITY_A, PERSONALITY_B] });
      await handlers.handleStatus({
        prisma: mockPrisma as unknown as PrismaClient,
        redis: redisWithSessions(),
      })(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('reports inactive when the filter matches nothing', async () => {
      const prefix = REDIS_KEY_PREFIXES.INCOGNITO;
      const redis = {
        scan: vi
          .fn()
          .mockResolvedValue(['0', [`${prefix}${TEST_DISCORD_USER_ID}:${PERSONALITY_B}`]]),
        mget: vi.fn().mockResolvedValue([sessionJson(PERSONALITY_B)]),
      } as unknown as Redis;

      const { req, res } = createMockReqRes({}, { personalityId: PERSONALITY_A });
      await handlers.handleStatus({ prisma: mockPrisma as unknown as PrismaClient, redis })(
        req,
        res,
        vi.fn()
      );

      const payload = vi.mocked(res.json).mock.calls[0][0] as { active: boolean };
      expect(payload.active).toBe(false);
    });
  });

  it('threads the injected copy through enable responses', async () => {
    const redis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      setex: vi.fn().mockResolvedValue('OK'),
    } as unknown as Redis;
    mockPrisma.personality.findUnique.mockResolvedValue({ id: PERSONALITY_A });

    const { req, res } = createMockReqRes({ personalityId: 'all', duration: '30m' });
    await handlers.handleEnable({ prisma: mockPrisma as unknown as PrismaClient, redis })(
      req,
      res,
      vi.fn()
    );

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'enabled all personalities 30 minutes' })
    );
  });
});
