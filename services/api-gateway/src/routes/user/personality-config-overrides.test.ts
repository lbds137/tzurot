/**
 * Tests for personality config override routes
 *
 * Tests the personality-tier config cascade endpoints:
 * - GET /resolve-personality/:personalityId - 3-tier cascade resolve
 * - PATCH /personality/:personalityId - Update Personality.configDefaults
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Hoisted mocks
const { mockGetOrCreateUser, mockGetOrCreateUserShell, mockResolveOverrides } = vi.hoisted(() => ({
  mockGetOrCreateUser: vi.fn().mockResolvedValue('internal-user-id'),
  mockGetOrCreateUserShell: vi.fn().mockResolvedValue('internal-user-id'),
  mockResolveOverrides: vi.fn().mockResolvedValue({
    maxMessages: 50,
    maxAge: null,
    maxImages: 10,
    memoryScoreThreshold: 0.5,
    memoryLimit: 20,
    focusModeEnabled: false,
    crossChannelHistoryEnabled: false,
    shareLtmAcrossPersonalities: false,
    showModelFooter: true,
    sources: {
      maxMessages: 'hardcoded',
      maxAge: 'hardcoded',
      maxImages: 'hardcoded',
      memoryScoreThreshold: 'hardcoded',
      memoryLimit: 'hardcoded',
      focusModeEnabled: 'hardcoded',
      crossChannelHistoryEnabled: 'hardcoded',
      shareLtmAcrossPersonalities: 'hardcoded',
      showModelFooter: 'hardcoded',
    },
  }),
}));

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');

  class MockUserService {
    getOrCreateUser = mockGetOrCreateUser;
    getOrCreateUserShell = mockGetOrCreateUserShell;
  }

  class MockConfigCascadeResolver {
    resolveOverrides = mockResolveOverrides;
  }

  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    UserService: MockUserService,
    ConfigCascadeResolver: MockConfigCascadeResolver,
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

const mockPrisma = {
  personality: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
};

import { createPersonalityConfigOverrideRoutes } from './personality-config-overrides.js';
import { getRouteHandler, findRoute } from '../../test/expressRouterUtils.js';
import type { PrismaClient } from '@tzurot/common-types';

const TEST_DISCORD_USER_ID = 'discord-user-123';
const TEST_PERSONALITY_ID = '00000000-0000-0000-0000-000000000003';

function createMockReqRes(body: Record<string, unknown> = {}, params: Record<string, string> = {}) {
  const req = {
    body,
    params,
    query: {},
    userId: TEST_DISCORD_USER_ID,
  } as unknown as Request & { userId: string };

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

function getHandler(
  router: ReturnType<typeof createPersonalityConfigOverrideRoutes>,
  method: 'get' | 'patch',
  path: string
) {
  return getRouteHandler(router, method, path);
}

describe('/user/config-overrides personality routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.personality.findUnique.mockResolvedValue(null);
    mockPrisma.personality.update.mockResolvedValue({});
  });

  describe('route factory', () => {
    it('should create a router with personality routes', () => {
      const router = createPersonalityConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);

      expect(router).toBeDefined();
      expect(findRoute(router, 'get', '/resolve-personality/:personalityId')).toBeDefined();
      expect(findRoute(router, 'patch', '/personality/:personalityId')).toBeDefined();
    });
  });

  describe('GET /resolve-personality/:personalityId', () => {
    it('should return resolved 3-tier cascade', async () => {
      const router = createPersonalityConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/resolve-personality/:personalityId');
      const { req, res } = createMockReqRes({}, { personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(mockResolveOverrides).toHaveBeenCalledWith(undefined, TEST_PERSONALITY_ID, undefined);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should reject non-UUID personalityId', async () => {
      const router = createPersonalityConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/resolve-personality/:personalityId');
      const { req, res } = createMockReqRes({}, { personalityId: 'not-a-uuid' });

      await handler(req, res);

      expect(mockResolveOverrides).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('PATCH /personality/:personalityId', () => {
    it('should reject non-UUID personalityId', async () => {
      const router = createPersonalityConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'patch', '/personality/:personalityId');
      const { req, res } = createMockReqRes({ maxMessages: 25 }, { personalityId: 'not-a-uuid' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 when personality not found', async () => {
      const router = createPersonalityConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'patch', '/personality/:personalityId');
      const { req, res } = createMockReqRes(
        { maxMessages: 25 },
        { personalityId: TEST_PERSONALITY_ID }
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 403 when user is not the creator', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        ownerId: 'different-user-id',
        configDefaults: null,
      });

      const router = createPersonalityConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'patch', '/personality/:personalityId');
      const { req, res } = createMockReqRes(
        { maxMessages: 25 },
        { personalityId: TEST_PERSONALITY_ID }
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should update config defaults when user is creator', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        ownerId: 'internal-user-id',
        configDefaults: null,
      });

      const router = createPersonalityConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'patch', '/personality/:personalityId');
      const { req, res } = createMockReqRes(
        { maxMessages: 25 },
        { personalityId: TEST_PERSONALITY_ID }
      );

      await handler(req, res);

      expect(mockPrisma.personality.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TEST_PERSONALITY_ID },
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          configDefaults: { maxMessages: 25 },
        })
      );
    });

    it('should merge with existing config defaults', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        ownerId: 'internal-user-id',
        configDefaults: { maxImages: 5 },
      });

      const router = createPersonalityConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'patch', '/personality/:personalityId');
      const { req, res } = createMockReqRes(
        { maxMessages: 25 },
        { personalityId: TEST_PERSONALITY_ID }
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          configDefaults: { maxImages: 5, maxMessages: 25 },
        })
      );
    });

    it('should publish cascade invalidation on success', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        ownerId: 'internal-user-id',
        configDefaults: null,
      });

      const mockInvalidation = {
        invalidatePersonality: vi.fn().mockResolvedValue(undefined),
      };

      const router = createPersonalityConfigOverrideRoutes(
        mockPrisma as unknown as PrismaClient,
        mockInvalidation as unknown as Parameters<typeof createPersonalityConfigOverrideRoutes>[1]
      );
      const handler = getHandler(router, 'patch', '/personality/:personalityId');
      const { req, res } = createMockReqRes(
        { maxMessages: 25 },
        { personalityId: TEST_PERSONALITY_ID }
      );

      await handler(req, res);

      expect(mockInvalidation.invalidatePersonality).toHaveBeenCalledWith(TEST_PERSONALITY_ID);
    });

    it('should still succeed when cascade invalidation fails', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        ownerId: 'internal-user-id',
        configDefaults: null,
      });

      const mockInvalidation = {
        invalidatePersonality: vi.fn().mockRejectedValue(new Error('Redis connection lost')),
      };

      const router = createPersonalityConfigOverrideRoutes(
        mockPrisma as unknown as PrismaClient,
        mockInvalidation as unknown as Parameters<typeof createPersonalityConfigOverrideRoutes>[1]
      );
      const handler = getHandler(router, 'patch', '/personality/:personalityId');
      const { req, res } = createMockReqRes(
        { maxMessages: 25 },
        { personalityId: TEST_PERSONALITY_ID }
      );

      await handler(req, res);

      expect(mockInvalidation.invalidatePersonality).toHaveBeenCalledWith(TEST_PERSONALITY_ID);
      // Should still return 200 despite invalidation failure
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should reject invalid config format', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        ownerId: 'internal-user-id',
        configDefaults: null,
      });

      const router = createPersonalityConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'patch', '/personality/:personalityId');
      const { req, res } = createMockReqRes(
        { maxMessages: -5 },
        { personalityId: TEST_PERSONALITY_ID }
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
