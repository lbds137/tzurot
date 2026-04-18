/**
 * Tests for /user/config-overrides routes
 *
 * Tests config cascade CRUD endpoints:
 * - GET /resolve-defaults - Resolve admin → user-default cascade
 * - GET /defaults - Get user's global config defaults
 * - PATCH /defaults - Update user's global config defaults
 * - DELETE /defaults - Clear user's global config defaults
 * - GET /resolve/:personalityId - Resolve cascade overrides
 * - PATCH /:personalityId - Update per-personality overrides
 * - DELETE /:personalityId - Clear per-personality overrides
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Hoisted mocks for service classes
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

// Mock dependencies before imports
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
    generateUserPersonalityConfigUuid: vi.fn(
      (userId: string, personalityId: string) => `upc-${userId}-${personalityId}`
    ),
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

// Mock Prisma
const mockPrisma = {
  adminSettings: {
    findUnique: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  userPersonalityConfig: {
    findUnique: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
};

import { createConfigOverrideRoutes } from './config-overrides.js';
import { getRouteHandler, findRoute } from '../../test/expressRouterUtils.js';
import { HARDCODED_CONFIG_DEFAULTS, type PrismaClient } from '@tzurot/common-types';

const TEST_DISCORD_USER_ID = 'discord-user-123';
const TEST_PERSONALITY_ID = '00000000-0000-0000-0000-000000000003';

function createMockReqRes(
  body: Record<string, unknown> = {},
  params: Record<string, string> = {},
  query: Record<string, string> = {}
) {
  const req = {
    body,
    params,
    query,
    userId: TEST_DISCORD_USER_ID,
  } as unknown as Request & { userId: string };

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

function getHandler(
  router: ReturnType<typeof createConfigOverrideRoutes>,
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string
) {
  return getRouteHandler(router, method, path);
}

describe('/user/config-overrides routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma.adminSettings.findUnique.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue({
      configDefaults: null,
    });
    mockPrisma.user.update.mockResolvedValue({});
    mockPrisma.userPersonalityConfig.findUnique.mockResolvedValue(null);
    mockPrisma.userPersonalityConfig.update.mockResolvedValue({});
    mockPrisma.userPersonalityConfig.upsert.mockResolvedValue({});
  });

  describe('route factory', () => {
    it('should create a router with all expected routes', () => {
      const router = createConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);

      expect(router).toBeDefined();
      expect(findRoute(router, 'get', '/resolve-defaults')).toBeDefined();
      expect(findRoute(router, 'get', '/defaults')).toBeDefined();
      expect(findRoute(router, 'patch', '/defaults')).toBeDefined();
      expect(findRoute(router, 'delete', '/defaults')).toBeDefined();
      expect(findRoute(router, 'get', '/resolve/:personalityId')).toBeDefined();
      expect(findRoute(router, 'patch', '/:personalityId')).toBeDefined();
      expect(findRoute(router, 'delete', '/:personalityId')).toBeDefined();
    });
  });

  describe('GET /resolve-defaults', () => {
    it('should return hardcoded defaults when no overrides exist', async () => {
      const router = createConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/resolve-defaults');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          maxMessages: HARDCODED_CONFIG_DEFAULTS.maxMessages,
          maxImages: HARDCODED_CONFIG_DEFAULTS.maxImages,
          sources: expect.objectContaining({
            maxMessages: 'hardcoded',
            maxImages: 'hardcoded',
          }),
          userOverrides: null,
        })
      );
    });

    it('should return admin values when admin has set overrides', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        configDefaults: { maxMessages: 75, focusModeEnabled: true },
      });

      const router = createConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/resolve-defaults');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          maxMessages: 75,
          focusModeEnabled: true,
          maxImages: HARDCODED_CONFIG_DEFAULTS.maxImages,
          sources: expect.objectContaining({
            maxMessages: 'admin',
            focusModeEnabled: 'admin',
            maxImages: 'hardcoded',
          }),
          userOverrides: null,
        })
      );
    });

    it('should return user values as highest priority', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        configDefaults: { maxMessages: 75 },
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        configDefaults: { maxMessages: 30, maxImages: 5 },
      });

      const router = createConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/resolve-defaults');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          maxMessages: 30,
          maxImages: 5,
          sources: expect.objectContaining({
            maxMessages: 'user-default',
            maxImages: 'user-default',
          }),
          userOverrides: { maxMessages: 30, maxImages: 5 },
        })
      );
    });

    it('should track sources accurately across tiers', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        configDefaults: { maxMessages: 75 },
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        configDefaults: { maxImages: 5 },
      });

      const router = createConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/resolve-defaults');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          maxMessages: 75,
          maxImages: 5,
          memoryLimit: HARDCODED_CONFIG_DEFAULTS.memoryLimit,
          sources: expect.objectContaining({
            maxMessages: 'admin',
            maxImages: 'user-default',
            memoryLimit: 'hardcoded',
          }),
        })
      );
    });
  });

  describe('GET /defaults', () => {
    it('should return null when no config defaults set', async () => {
      const router = createConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/defaults');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ configDefaults: null }));
    });

    it('should return existing config defaults', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        configDefaults: { maxMessages: 30, maxImages: 5 },
      });

      const router = createConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/defaults');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          configDefaults: { maxMessages: 30, maxImages: 5 },
        })
      );
    });
  });

  describe('PATCH /defaults', () => {
    it('should merge valid overrides with existing defaults', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        configDefaults: { maxMessages: 30 },
      });

      const router = createConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'patch', '/defaults');
      const { req, res } = createMockReqRes({ maxImages: 5 });

      await handler(req, res);

      expect(mockPrisma.user.update).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          configDefaults: { maxMessages: 30, maxImages: 5 },
        })
      );
    });

    it('should reject non-object request body', async () => {
      const router = createConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'patch', '/defaults');
      const { req, res } = createMockReqRes();
      req.body = 'not-an-object' as unknown as Record<string, unknown>;

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: 'Request body must be a JSON object',
        })
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('should reject invalid config format', async () => {
      const router = createConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'patch', '/defaults');
      const { req, res } = createMockReqRes({ maxMessages: 'not-a-number' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
        })
      );
    });
  });

  describe('DELETE /defaults', () => {
    it('should clear user config defaults', async () => {
      const router = createConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/defaults');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'internal-user-id' },
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('GET /resolve/:personalityId', () => {
    it('should return resolved cascade overrides', async () => {
      const router = createConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/resolve/:personalityId');
      const { req, res } = createMockReqRes({}, { personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          maxMessages: 50,
          sources: expect.objectContaining({
            maxMessages: 'hardcoded',
          }),
        })
      );
    });

    it('should pass channelId query param to resolver', async () => {
      const router = createConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/resolve/:personalityId');
      const { req, res } = createMockReqRes(
        {},
        { personalityId: TEST_PERSONALITY_ID },
        { channelId: '999888777666555444' }
      );

      await handler(req, res);

      expect(mockResolveOverrides).toHaveBeenCalledWith(
        TEST_DISCORD_USER_ID,
        TEST_PERSONALITY_ID,
        '999888777666555444'
      );
    });

    it('should reject invalid channelId format', async () => {
      const router = createConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/resolve/:personalityId');
      const { req, res } = createMockReqRes(
        {},
        { personalityId: TEST_PERSONALITY_ID },
        { channelId: 'not-a-snowflake' }
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockResolveOverrides).not.toHaveBeenCalled();
    });

    it('should pass undefined channelId when query param not provided', async () => {
      const router = createConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/resolve/:personalityId');
      const { req, res } = createMockReqRes({}, { personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(mockResolveOverrides).toHaveBeenCalledWith(
        TEST_DISCORD_USER_ID,
        TEST_PERSONALITY_ID,
        undefined
      );
    });
  });

  describe('PATCH /:personalityId', () => {
    it('should reject non-UUID personalityId', async () => {
      const router = createConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'patch', '/:personalityId');
      const { req, res } = createMockReqRes(
        { maxMessages: 25 },
        { personalityId: 'resolve-defaults' }
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: 'Invalid personalityId format',
        })
      );
      expect(mockPrisma.userPersonalityConfig.upsert).not.toHaveBeenCalled();
    });

    it('should reject non-object request body', async () => {
      const router = createConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'patch', '/:personalityId');
      const { req, res } = createMockReqRes(undefined as unknown as Record<string, unknown>, {
        personalityId: TEST_PERSONALITY_ID,
      });
      // Simulate non-object body (e.g., array)
      req.body = [1, 2, 3] as unknown as Record<string, unknown>;

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: 'Request body must be a JSON object',
        })
      );
    });

    it('should upsert valid per-personality overrides', async () => {
      const router = createConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'patch', '/:personalityId');
      const { req, res } = createMockReqRes(
        { maxMessages: 25 },
        { personalityId: TEST_PERSONALITY_ID }
      );

      await handler(req, res);

      expect(mockPrisma.userPersonalityConfig.upsert).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          configOverrides: { maxMessages: 25 },
        })
      );
    });

    it('should reject invalid config format', async () => {
      const router = createConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'patch', '/:personalityId');
      const { req, res } = createMockReqRes(
        { maxMessages: -5 },
        { personalityId: TEST_PERSONALITY_ID }
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
        })
      );
    });

    it('should merge with existing per-personality overrides', async () => {
      mockPrisma.userPersonalityConfig.findUnique.mockResolvedValue({
        configOverrides: { maxImages: 5 },
      });

      const router = createConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'patch', '/:personalityId');
      const { req, res } = createMockReqRes(
        { maxMessages: 25 },
        { personalityId: TEST_PERSONALITY_ID }
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          configOverrides: { maxImages: 5, maxMessages: 25 },
        })
      );
    });
  });

  describe('DELETE /:personalityId', () => {
    it('should reject non-UUID personalityId', async () => {
      const router = createConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:personalityId');
      const { req, res } = createMockReqRes({}, { personalityId: 'resolve-defaults' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: 'Invalid personalityId format',
        })
      );
      expect(mockPrisma.userPersonalityConfig.findUnique).not.toHaveBeenCalled();
    });

    it('should clear per-personality overrides when they exist', async () => {
      mockPrisma.userPersonalityConfig.findUnique.mockResolvedValue({
        configOverrides: { maxMessages: 30 },
      });

      const router = createConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:personalityId');
      const { req, res } = createMockReqRes({}, { personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(mockPrisma.userPersonalityConfig.update).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should succeed even when no overrides exist', async () => {
      mockPrisma.userPersonalityConfig.findUnique.mockResolvedValue(null);

      const router = createConfigOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:personalityId');
      const { req, res } = createMockReqRes({}, { personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(mockPrisma.userPersonalityConfig.update).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('cascade invalidation', () => {
    it('should publish invalidation event on PATCH /defaults', async () => {
      const mockInvalidation = {
        invalidateUser: vi.fn().mockResolvedValue(undefined),
      };

      const router = createConfigOverrideRoutes(
        mockPrisma as unknown as PrismaClient,
        mockInvalidation as unknown as Parameters<typeof createConfigOverrideRoutes>[1]
      );
      const handler = getHandler(router, 'patch', '/defaults');
      const { req, res } = createMockReqRes({ maxMessages: 25 });

      await handler(req, res);

      expect(mockInvalidation.invalidateUser).toHaveBeenCalledWith(TEST_DISCORD_USER_ID);
    });

    it('should not fail when invalidation throws', async () => {
      const mockInvalidation = {
        invalidateUser: vi.fn().mockRejectedValue(new Error('Redis down')),
      };

      const router = createConfigOverrideRoutes(
        mockPrisma as unknown as PrismaClient,
        mockInvalidation as unknown as Parameters<typeof createConfigOverrideRoutes>[1]
      );
      const handler = getHandler(router, 'delete', '/defaults');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      // Should still succeed despite invalidation error
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
