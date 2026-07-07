/**
 * Tests for /user/memory batch operations
 *
 * Handlers are now (deps: RouteDeps) => RequestHandler factories. The
 * MemoryActionTokenService is `new`-constructed per request from
 * `deps.redis`, so we mock the service class via vi.hoisted/vi.mock and
 * have every `new MemoryActionTokenService(redis)` return the same
 * shared mock instance. Tests configure that instance's methods.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import type { BatchDeletePreviewInput } from '@tzurot/common-types/schemas/api/memory';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { ProvisionedRequest } from '../../types.js';
import type { RouteDeps } from '../routeDeps.js';

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

vi.mock('./memoryHelpers.js', () => ({
  getDefaultPersonaId: vi.fn(),
  getPersonalityById: vi.fn(),
  parseTimeframeFilter: vi.fn(),
}));

vi.mock('../../utils/resolveProvisionedUserId.js', () => ({
  resolveProvisionedUserId: vi.fn(),
}));

// vi.hoisted so the mock instance is available before vi.mock evaluates.
// Every `new MemoryActionTokenService(redis)` inside a handler returns this
// same shared instance; tests configure its method mocks directly.
const { mockTokenService } = vi.hoisted(() => ({
  mockTokenService: {
    issuePreviewToken: vi.fn(),
    peekPreviewToken: vi.fn(),
    consumePreviewToken: vi.fn(),
    issuePurgeToken: vi.fn(),
    peekPurgeToken: vi.fn(),
    consumePurgeToken: vi.fn(),
  },
}));

vi.mock('../../services/MemoryActionTokenService.js', () => ({
  // `function` (not arrow) so `new MemoryActionTokenService(redis)` is a
  // valid constructor invocation. Constructor ignores redis and returns the
  // shared mockTokenService — every handler in a single test sees the same
  // instance, so configuring mockTokenService.method.mockResolvedValue(...)
  // controls all 4 handlers' behavior in lockstep.

  MemoryActionTokenService: vi.fn().mockImplementation(function (this: any) {
    return mockTokenService;
  }),
}));

import {
  handleBatchDelete,
  handleBatchDeletePreview,
  handleIssuePurgeToken,
  handlePurge,
} from './memoryBatch.js';
import { getDefaultPersonaId, getPersonalityById, parseTimeframeFilter } from './memoryHelpers.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { stubRouteResolvers } from '../../test/shared-route-test-utils.js';

const mockResolveProvisionedUserId = vi.mocked(resolveProvisionedUserId);
const mockGetDefaultPersonaId = vi.mocked(getDefaultPersonaId);
const mockGetPersonalityById = vi.mocked(getPersonalityById);
const mockParseTimeframeFilter = vi.mocked(parseTimeframeFilter);

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_PERSONA_ID = '00000000-0000-0000-0000-000000000002';
const TEST_PERSONALITY_ID = '00000000-0000-0000-0000-000000000003';
const TEST_DISCORD_USER_ID = 'discord-user-123';

const VALID_PREVIEW_TOKEN = 'preview_test0000test0000';
const VALID_PURGE_TOKEN = 'purge_test0000test0000';

const mockPrisma = {
  memory: {
    count: vi.fn(),
    updateMany: vi.fn(),
  },
  persona: {
    findUnique: vi.fn(),
  },
};

/** Deps with Redis present (the common case — service constructs over it). */
function depsWithRedis(): RouteDeps {
  return {
    ...stubRouteResolvers(),
    prisma: mockPrisma as unknown as PrismaClient,
    redis: {} as Redis, // shape only; the mocked service class ignores it
  };
}

/** Deps without Redis — exercises the 503 guard inside each handler. */
function depsWithoutRedis(): RouteDeps {
  return { prisma: mockPrisma as unknown as PrismaClient, ...stubRouteResolvers() };
}

function createMockBodyReq(body: Record<string, unknown> = {}) {
  const req = {
    userId: TEST_DISCORD_USER_ID,
    body,
    params: {},
    query: {},
  } as unknown as ProvisionedRequest;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

const defaultPersonality = {
  id: TEST_PERSONALITY_ID,
  name: 'test-personality',
};

const defaultPersona = {
  id: TEST_PERSONA_ID,
  ownerId: TEST_USER_ID,
};

const defaultFilter: BatchDeletePreviewInput = {
  personalityId: TEST_PERSONALITY_ID,
  personaId: TEST_PERSONA_ID,
};

describe('memoryBatch handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockResolveProvisionedUserId.mockReturnValue(TEST_USER_ID);
    mockGetDefaultPersonaId.mockResolvedValue(TEST_PERSONA_ID);
    mockGetPersonalityById.mockResolvedValue(defaultPersonality);
    mockParseTimeframeFilter.mockReturnValue({ filter: null });
    mockPrisma.persona.findUnique.mockResolvedValue(defaultPersona);
    mockPrisma.memory.count.mockResolvedValue(0);
    mockPrisma.memory.updateMany.mockResolvedValue({ count: 0 });

    // Default happy-path token service behavior; individual tests override.
    mockTokenService.issuePreviewToken.mockResolvedValue(VALID_PREVIEW_TOKEN);
    mockTokenService.peekPreviewToken.mockResolvedValue(defaultFilter);
    mockTokenService.consumePreviewToken.mockResolvedValue(defaultFilter);
    mockTokenService.issuePurgeToken.mockResolvedValue(VALID_PURGE_TOKEN);
    mockTokenService.peekPurgeToken.mockResolvedValue({ personalityId: TEST_PERSONALITY_ID });
    mockTokenService.consumePurgeToken.mockResolvedValue({ personalityId: TEST_PERSONALITY_ID });
  });

  describe('handleBatchDeletePreview', () => {
    it('returns 503 when Redis is unavailable', async () => {
      const { req, res } = createMockBodyReq({ personalityId: TEST_PERSONALITY_ID });
      await handleBatchDeletePreview(depsWithoutRedis())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('rejects missing personalityId', async () => {
      const { req, res } = createMockBodyReq({});
      await handleBatchDeletePreview(depsWithRedis())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: expect.stringContaining('personalityId'),
        })
      );
    });

    it('returns early when personality not found', async () => {
      mockGetPersonalityById.mockResolvedValue(null);
      const { req, res } = createMockBodyReq({ personalityId: TEST_PERSONALITY_ID });
      await handleBatchDeletePreview(depsWithRedis())(req, res, () => undefined);
      expect(mockGetPersonalityById).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 400 when user has no persona', async () => {
      mockGetDefaultPersonaId.mockResolvedValue(null);
      const { req, res } = createMockBodyReq({ personalityId: TEST_PERSONALITY_ID });
      await handleBatchDeletePreview(depsWithRedis())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('rejects invalid timeframe format', async () => {
      mockParseTimeframeFilter.mockReturnValue({
        filter: null,
        error: 'Invalid timeframe format. Use: 1h, 24h, 7d, 30d, etc.',
      });
      const { req, res } = createMockBodyReq({
        personalityId: TEST_PERSONALITY_ID,
        timeframe: 'invalid',
      });
      await handleBatchDeletePreview(depsWithRedis())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns preview counts plus a previewToken for a valid request', async () => {
      mockPrisma.memory.count.mockResolvedValueOnce(10).mockResolvedValueOnce(2);

      const { req, res } = createMockBodyReq({ personalityId: TEST_PERSONALITY_ID });
      await handleBatchDeletePreview(depsWithRedis())(req, res, () => undefined);

      expect(mockTokenService.issuePreviewToken).toHaveBeenCalledWith(
        TEST_DISCORD_USER_ID,
        expect.objectContaining({
          personalityId: TEST_PERSONALITY_ID,
          personaId: TEST_PERSONA_ID,
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          wouldDelete: 10,
          lockedWouldSkip: 2,
          personalityId: TEST_PERSONALITY_ID,
          personalityName: 'test-personality',
          timeframe: 'all',
          previewToken: VALID_PREVIEW_TOKEN,
        })
      );
    });

    it('applies timeframe filter when provided and binds it into the token payload', async () => {
      const cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      mockParseTimeframeFilter.mockReturnValue({ filter: { gte: cutoffDate } });
      mockPrisma.memory.count.mockResolvedValue(3);

      const { req, res } = createMockBodyReq({
        personalityId: TEST_PERSONALITY_ID,
        timeframe: '7d',
      });
      await handleBatchDeletePreview(depsWithRedis())(req, res, () => undefined);

      expect(mockTokenService.issuePreviewToken).toHaveBeenCalledWith(
        TEST_DISCORD_USER_ID,
        expect.objectContaining({ timeframe: '7d' })
      );
    });
  });

  describe('handleBatchDelete', () => {
    it('returns 503 when Redis is unavailable', async () => {
      const { req, res } = createMockBodyReq({ previewToken: VALID_PREVIEW_TOKEN });
      await handleBatchDelete(depsWithoutRedis())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('rejects missing previewToken', async () => {
      const { req, res } = createMockBodyReq({});
      await handleBatchDelete(depsWithRedis())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('rejects malformed previewToken (wrong prefix)', async () => {
      const { req, res } = createMockBodyReq({ previewToken: 'purge_test0000test0000' });
      await handleBatchDelete(depsWithRedis())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when token is unknown / expired (peek miss)', async () => {
      mockTokenService.peekPreviewToken.mockResolvedValue(null);
      const { req, res } = createMockBodyReq({ previewToken: VALID_PREVIEW_TOKEN });
      await handleBatchDelete(depsWithRedis())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Preview token'),
        })
      );
      // Token is NOT consumed on peek miss — user can retry without restarting preview.
      expect(mockTokenService.consumePreviewToken).not.toHaveBeenCalled();
    });

    it('returns 400 when token is concurrently consumed between peek and consume', async () => {
      mockTokenService.consumePreviewToken.mockResolvedValue(null);
      const { req, res } = createMockBodyReq({ previewToken: VALID_PREVIEW_TOKEN });
      await handleBatchDelete(depsWithRedis())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('concurrent'),
        })
      );
    });

    it('does NOT consume the token when personality lookup fails post-peek', async () => {
      mockGetPersonalityById.mockResolvedValue(null);
      const { req, res } = createMockBodyReq({ previewToken: VALID_PREVIEW_TOKEN });
      await handleBatchDelete(depsWithRedis())(req, res, () => undefined);
      // Personality 404 is rendered by getPersonalityById itself; importantly,
      // the token survives the failure so the user can retry.
      expect(mockTokenService.peekPreviewToken).toHaveBeenCalled();
      expect(mockTokenService.consumePreviewToken).not.toHaveBeenCalled();
    });

    it('returns 403 when token-bound persona does not belong to user, without consuming token', async () => {
      mockPrisma.persona.findUnique.mockResolvedValue({
        id: TEST_PERSONA_ID,
        ownerId: 'different-user-id',
      });
      const { req, res } = createMockBodyReq({ previewToken: VALID_PREVIEW_TOKEN });
      await handleBatchDelete(depsWithRedis())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(403);
      // Token NOT consumed on persona-ownership failure — user can retry.
      expect(mockTokenService.consumePreviewToken).not.toHaveBeenCalled();
    });

    it('returns zero-count success when no memories match', async () => {
      mockPrisma.memory.count.mockResolvedValue(0);
      const { req, res } = createMockBodyReq({ previewToken: VALID_PREVIEW_TOKEN });
      await handleBatchDelete(depsWithRedis())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ deletedCount: 0 }));
      expect(mockPrisma.memory.updateMany).not.toHaveBeenCalled();
    });

    it('deletes memories and returns counts using the token-bound filter', async () => {
      mockPrisma.memory.count.mockResolvedValueOnce(5).mockResolvedValueOnce(2);
      mockPrisma.memory.updateMany.mockResolvedValue({ count: 5 });

      const { req, res } = createMockBodyReq({ previewToken: VALID_PREVIEW_TOKEN });
      await handleBatchDelete(depsWithRedis())(req, res, () => undefined);

      expect(mockPrisma.memory.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          personaId: TEST_PERSONA_ID,
          personalityId: TEST_PERSONALITY_ID,
          visibility: 'normal',
          isLocked: false,
        }),
        data: expect.objectContaining({
          visibility: 'deleted',
          updatedAt: expect.any(Date),
        }),
      });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          deletedCount: 5,
          skippedLocked: 2,
          personalityId: TEST_PERSONALITY_ID,
        })
      );
    });

    it('applies timeframe filter from the token-bound payload', async () => {
      const filterWithTimeframe: BatchDeletePreviewInput = {
        personalityId: TEST_PERSONALITY_ID,
        personaId: TEST_PERSONA_ID,
        timeframe: '30d',
      };
      mockTokenService.peekPreviewToken.mockResolvedValue(filterWithTimeframe);
      mockTokenService.consumePreviewToken.mockResolvedValue(filterWithTimeframe);
      const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      mockParseTimeframeFilter.mockReturnValue({ filter: { gte: cutoffDate } });
      mockPrisma.memory.count.mockResolvedValue(2);
      mockPrisma.memory.updateMany.mockResolvedValue({ count: 2 });

      const { req, res } = createMockBodyReq({ previewToken: VALID_PREVIEW_TOKEN });
      await handleBatchDelete(depsWithRedis())(req, res, () => undefined);

      expect(mockParseTimeframeFilter).toHaveBeenCalledWith('30d');
      expect(mockPrisma.memory.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({ gte: expect.any(Date) }),
          }),
        })
      );
    });
  });

  describe('handleIssuePurgeToken', () => {
    it('returns 503 when Redis is unavailable', async () => {
      const { req, res } = createMockBodyReq({
        personalityId: TEST_PERSONALITY_ID,
        confirmationPhrase: 'DELETE TEST-PERSONALITY MEMORIES',
      });
      await handleIssuePurgeToken(depsWithoutRedis())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('rejects missing personalityId', async () => {
      const { req, res } = createMockBodyReq({ confirmationPhrase: 'DELETE X MEMORIES' });
      await handleIssuePurgeToken(depsWithRedis())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('rejects missing confirmation phrase', async () => {
      const { req, res } = createMockBodyReq({ personalityId: TEST_PERSONALITY_ID });
      await handleIssuePurgeToken(depsWithRedis())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('rejects incorrect confirmation phrase', async () => {
      const { req, res } = createMockBodyReq({
        personalityId: TEST_PERSONALITY_ID,
        confirmationPhrase: 'wrong phrase',
      });
      await handleIssuePurgeToken(depsWithRedis())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('DELETE TEST-PERSONALITY MEMORIES'),
        })
      );
      expect(mockTokenService.issuePurgeToken).not.toHaveBeenCalled();
    });

    it('accepts case-insensitive confirmation phrase and issues a token', async () => {
      const { req, res } = createMockBodyReq({
        personalityId: TEST_PERSONALITY_ID,
        confirmationPhrase: 'delete test-personality memories',
      });
      await handleIssuePurgeToken(depsWithRedis())(req, res, () => undefined);
      expect(mockTokenService.issuePurgeToken).toHaveBeenCalledWith(
        TEST_DISCORD_USER_ID,
        TEST_PERSONALITY_ID
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          purgeToken: VALID_PURGE_TOKEN,
          personalityId: TEST_PERSONALITY_ID,
          personalityName: 'test-personality',
        })
      );
    });

    it('returns early when personality not found', async () => {
      mockGetPersonalityById.mockResolvedValue(null);
      const { req, res } = createMockBodyReq({
        personalityId: TEST_PERSONALITY_ID,
        confirmationPhrase: 'DELETE TEST-PERSONALITY MEMORIES',
      });
      await handleIssuePurgeToken(depsWithRedis())(req, res, () => undefined);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('handlePurge', () => {
    it('returns 503 when Redis is unavailable', async () => {
      const { req, res } = createMockBodyReq({ purgeToken: VALID_PURGE_TOKEN });
      await handlePurge(depsWithoutRedis())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('rejects missing purgeToken', async () => {
      const { req, res } = createMockBodyReq({});
      await handlePurge(depsWithRedis())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('rejects malformed purgeToken (wrong prefix)', async () => {
      const { req, res } = createMockBodyReq({ purgeToken: 'preview_test0000test0000' });
      await handlePurge(depsWithRedis())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when token is unknown / expired (peek miss)', async () => {
      mockTokenService.peekPurgeToken.mockResolvedValue(null);
      const { req, res } = createMockBodyReq({ purgeToken: VALID_PURGE_TOKEN });
      await handlePurge(depsWithRedis())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Purge token'),
        })
      );
      // Token survives the failure — no destructive consume on peek miss.
      expect(mockTokenService.consumePurgeToken).not.toHaveBeenCalled();
    });

    it('returns 400 when token is concurrently consumed between peek and consume', async () => {
      mockTokenService.consumePurgeToken.mockResolvedValue(null);
      const { req, res } = createMockBodyReq({ purgeToken: VALID_PURGE_TOKEN });
      await handlePurge(depsWithRedis())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('concurrent'),
        })
      );
    });

    it('does NOT consume the token when personality lookup fails post-peek', async () => {
      mockGetPersonalityById.mockResolvedValue(null);
      const { req, res } = createMockBodyReq({ purgeToken: VALID_PURGE_TOKEN });
      await handlePurge(depsWithRedis())(req, res, () => undefined);
      // Token survives the personality-missing case — user can retry.
      expect(mockTokenService.peekPurgeToken).toHaveBeenCalled();
      expect(mockTokenService.consumePurgeToken).not.toHaveBeenCalled();
    });

    it('returns 400 when user has no persona, without consuming the token', async () => {
      mockGetDefaultPersonaId.mockResolvedValue(null);
      const { req, res } = createMockBodyReq({ purgeToken: VALID_PURGE_TOKEN });
      await handlePurge(depsWithRedis())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(400);
      // Persona check happens BEFORE consume — token survives so the user
      // can fix the missing-persona condition and retry.
      expect(mockTokenService.consumePurgeToken).not.toHaveBeenCalled();
    });

    it('purges all non-locked memories for the token-bound personality', async () => {
      mockPrisma.memory.count.mockResolvedValueOnce(10).mockResolvedValueOnce(3);
      mockPrisma.memory.updateMany.mockResolvedValue({ count: 7 });

      const { req, res } = createMockBodyReq({ purgeToken: VALID_PURGE_TOKEN });
      await handlePurge(depsWithRedis())(req, res, () => undefined);

      expect(mockPrisma.memory.updateMany).toHaveBeenCalledWith({
        where: {
          personaId: TEST_PERSONA_ID,
          personalityId: TEST_PERSONALITY_ID,
          visibility: 'normal',
          isLocked: false,
        },
        data: expect.objectContaining({
          visibility: 'deleted',
          updatedAt: expect.any(Date),
        }),
      });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          deletedCount: 7,
          lockedPreserved: 3,
          personalityId: TEST_PERSONALITY_ID,
        })
      );
    });

    it('includes locked-preserved message when locked memories remain', async () => {
      mockPrisma.memory.count.mockResolvedValueOnce(5).mockResolvedValueOnce(2);
      mockPrisma.memory.updateMany.mockResolvedValue({ count: 3 });

      const { req, res } = createMockBodyReq({ purgeToken: VALID_PURGE_TOKEN });
      await handlePurge(depsWithRedis())(req, res, () => undefined);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('locked (core) memories were preserved'),
        })
      );
    });

    it('returns early when token-bound personality is missing', async () => {
      mockGetPersonalityById.mockResolvedValue(null);
      const { req, res } = createMockBodyReq({ purgeToken: VALID_PURGE_TOKEN });
      await handlePurge(depsWithRedis())(req, res, () => undefined);
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
