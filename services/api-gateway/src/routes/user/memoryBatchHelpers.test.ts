/**
 * Tests for memoryBatchHelpers.
 *
 * The three exports are exercised by the handler-level tests in
 * memoryBatch.test.ts; this file covers their edge-cases in isolation.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { RouteDeps } from '../routeDeps.js';
vi.mock('./memoryHelpers.js', () => ({
  parseTimeframeFilter: vi.fn(),
}));

import { stubRouteResolvers } from '../../test/shared-route-test-utils.js';
import {
  requireRedis,
  resolvePersonaIdForBatch,
  executeBatchDelete,
} from './memoryBatchHelpers.js';

function createMockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe('requireRedis', () => {
  it('returns the Redis client when deps.redis is configured', () => {
    const redis = {} as Redis;
    const deps: RouteDeps = {
      ...stubRouteResolvers(),
      prisma: {} as PrismaClient,
      redis,
    };
    const res = createMockRes();

    const result = requireRedis(deps, res);

    expect(result).toBe(redis);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('sends 503 and returns null when deps.redis is undefined', () => {
    const deps: RouteDeps = {
      ...stubRouteResolvers(),
      prisma: {} as PrismaClient,
    };
    const res = createMockRes();

    const result = requireRedis(deps, res);

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'SERVICE_UNAVAILABLE',
        message: expect.stringContaining('Redis'),
      })
    );
  });
});

describe('resolvePersonaIdForBatch', () => {
  const TEST_USER_ID = 'user-123';
  const TEST_PERSONA_ID = 'persona-456';

  function createMockPrisma(personaResult: { id: string; ownerId: string } | null) {
    return {
      persona: {
        findUnique: vi.fn().mockResolvedValue(personaResult),
      },
    } as unknown as PrismaClient;
  }

  it('returns the supplied persona ID when ownership checks out', async () => {
    const prisma = createMockPrisma({ id: TEST_PERSONA_ID, ownerId: TEST_USER_ID });
    const res = createMockRes();
    const getDefaultPersonaId = vi.fn();

    const result = await resolvePersonaIdForBatch(
      prisma,
      TEST_USER_ID,
      TEST_PERSONA_ID,
      res,
      getDefaultPersonaId
    );

    expect(result).toBe(TEST_PERSONA_ID);
    expect(getDefaultPersonaId).not.toHaveBeenCalled();
  });

  it('falls back to the default persona when requested ID is undefined', async () => {
    const prisma = createMockPrisma({ id: TEST_PERSONA_ID, ownerId: TEST_USER_ID });
    const res = createMockRes();
    const getDefaultPersonaId = vi.fn().mockResolvedValue(TEST_PERSONA_ID);

    const result = await resolvePersonaIdForBatch(
      prisma,
      TEST_USER_ID,
      undefined,
      res,
      getDefaultPersonaId
    );

    expect(result).toBe(TEST_PERSONA_ID);
    expect(getDefaultPersonaId).toHaveBeenCalledWith(prisma, TEST_USER_ID);
  });

  it('falls back to the default persona when requested ID is empty string', async () => {
    const prisma = createMockPrisma({ id: TEST_PERSONA_ID, ownerId: TEST_USER_ID });
    const res = createMockRes();
    const getDefaultPersonaId = vi.fn().mockResolvedValue(TEST_PERSONA_ID);

    const result = await resolvePersonaIdForBatch(
      prisma,
      TEST_USER_ID,
      '',
      res,
      getDefaultPersonaId
    );

    expect(result).toBe(TEST_PERSONA_ID);
    expect(getDefaultPersonaId).toHaveBeenCalled();
  });

  it('sends 400 when no default persona exists', async () => {
    const prisma = createMockPrisma(null);
    const res = createMockRes();
    const getDefaultPersonaId = vi.fn().mockResolvedValue(null);

    const result = await resolvePersonaIdForBatch(
      prisma,
      TEST_USER_ID,
      undefined,
      res,
      getDefaultPersonaId
    );

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('sends 403 when persona belongs to a different user', async () => {
    const prisma = createMockPrisma({ id: TEST_PERSONA_ID, ownerId: 'different-user' });
    const res = createMockRes();
    const getDefaultPersonaId = vi.fn();

    const result = await resolvePersonaIdForBatch(
      prisma,
      TEST_USER_ID,
      TEST_PERSONA_ID,
      res,
      getDefaultPersonaId
    );

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('sends 403 when persona lookup returns null (not found)', async () => {
    const prisma = createMockPrisma(null);
    const res = createMockRes();
    const getDefaultPersonaId = vi.fn();

    const result = await resolvePersonaIdForBatch(
      prisma,
      TEST_USER_ID,
      TEST_PERSONA_ID,
      res,
      getDefaultPersonaId
    );

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('executeBatchDelete', () => {
  // The body is exhaustively covered by handler-level tests in
  // memoryBatch.test.ts (counts, soft-delete, locked-skipped messaging,
  // zero-exit short-circuit). One smoke test here confirms the function
  // is callable in isolation; deeper behavior is exercised through the
  // handler suite.

  it('is callable with a minimal valid params object', async () => {
    const { parseTimeframeFilter } = await import('./memoryHelpers.js');
    vi.mocked(parseTimeframeFilter).mockReturnValue({ filter: null });

    const prisma = {
      memory: {
        count: vi.fn().mockResolvedValue(0),
        updateMany: vi.fn(),
      },
    } as unknown as PrismaClient;
    const res = createMockRes();

    await executeBatchDelete({
      prisma,
      res,
      discordUserId: 'discord-123',
      personalityId: 'p1',
      personalityName: 'Test',
      personaId: 'persona-abc',
      timeframe: undefined,
    });

    // count==0 path: zero-exit response, no updateMany call
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ deletedCount: 0, skippedLocked: 0 })
    );
    expect(prisma.memory.updateMany).not.toHaveBeenCalled();
  });
});
