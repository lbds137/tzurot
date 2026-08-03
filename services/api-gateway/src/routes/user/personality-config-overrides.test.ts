/**
 * Tests for personality config override routes
 *
 * Tests the personality-tier config cascade endpoints:
 * - GET /resolve-personality/:personalityId - 3-tier cascade resolve
 * - PATCH /personality/:personalityId - Update Personality.configDefaults
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, RequestHandler, Response } from 'express';

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
    crossChannelHistoryEnabled: false,
    shareLtmAcrossPersonalities: false,
    showModelFooter: true,
    sources: {
      maxMessages: 'hardcoded',
      maxAge: 'hardcoded',
      maxImages: 'hardcoded',
      memoryScoreThreshold: 'hardcoded',
      memoryLimit: 'hardcoded',
      crossChannelHistoryEnabled: 'hardcoded',
      shareLtmAcrossPersonalities: 'hardcoded',
      showModelFooter: 'hardcoded',
    },
  }),
}));

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

vi.mock('@tzurot/identity', () => {
  class MockUserService {
    getOrCreateUser = mockGetOrCreateUser;
    getOrCreateUserShell = mockGetOrCreateUserShell;
  }
  return {
    UserService: MockUserService,
  };
});

vi.mock('@tzurot/config-resolver', () => {
  class MockConfigCascadeResolver {
    resolveOverrides = mockResolveOverrides;
  }
  return {
    ConfigCascadeResolver: MockConfigCascadeResolver,
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

const mockPrisma = {
  personality: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
};

const mockDeps = {
  prisma: mockPrisma as unknown as PrismaClient,
  cascadeResolver: {
    resolveOverrides: mockResolveOverrides,
  } as unknown as import('@tzurot/config-resolver').ConfigCascadeResolver,
} as unknown as import('../routeDeps.js').RouteDeps;

import {
  handleResolvePersonalityCascade,
  handleUpdatePersonalityConfigDefaults,
} from './personality-config-overrides.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { asRouteHandler, type RouteHandler } from '../../test/shared-route-test-utils.js';
import type { RouteDeps } from '../routeDeps.js';

const TEST_DISCORD_USER_ID = 'discord-user-123';
const TEST_PERSONALITY_ID = '00000000-0000-0000-0000-000000000003';

function createMockReqRes(body: Record<string, unknown> = {}, params: Record<string, string> = {}) {
  const req = {
    body,
    params,
    query: {},
    userId: TEST_DISCORD_USER_ID,
    provisionedUserId: 'internal-user-id',
    provisionedDefaultPersonaId: 'persona-uuid-default',
  } as unknown as Request & { userId: string };

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

/**
 * Build a bare handler with the given deps — the same export
 * routes/_generated/mounts.ts mounts, invoked directly.
 */
function buildHandler(handler: (deps: RouteDeps) => RequestHandler, deps: RouteDeps): RouteHandler {
  return asRouteHandler(handler(deps));
}

describe('/user/config-overrides personality routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.personality.findUnique.mockResolvedValue(null);
    mockPrisma.personality.update.mockResolvedValue({});
  });

  describe('GET /resolve-personality/:personalityId', () => {
    it('should return resolved 3-tier cascade', async () => {
      const handler = buildHandler(handleResolvePersonalityCascade, mockDeps);
      const { req, res } = createMockReqRes({}, { personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(mockResolveOverrides).toHaveBeenCalledWith(undefined, TEST_PERSONALITY_ID, undefined);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should reject non-UUID personalityId', async () => {
      const handler = buildHandler(handleResolvePersonalityCascade, mockDeps);
      const { req, res } = createMockReqRes({}, { personalityId: 'not-a-uuid' });

      await handler(req, res);

      expect(mockResolveOverrides).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('PATCH /personality/:personalityId', () => {
    it('should reject non-UUID personalityId', async () => {
      const handler = buildHandler(handleUpdatePersonalityConfigDefaults, mockDeps);
      const { req, res } = createMockReqRes({ maxMessages: 25 }, { personalityId: 'not-a-uuid' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 when personality not found', async () => {
      const handler = buildHandler(handleUpdatePersonalityConfigDefaults, mockDeps);
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

      const handler = buildHandler(handleUpdatePersonalityConfigDefaults, mockDeps);
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

      const handler = buildHandler(handleUpdatePersonalityConfigDefaults, mockDeps);
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

      const handler = buildHandler(handleUpdatePersonalityConfigDefaults, mockDeps);
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

      const handler = buildHandler(handleUpdatePersonalityConfigDefaults, {
        ...mockDeps,
        cascadeInvalidation: mockInvalidation as unknown as NonNullable<
          RouteDeps['cascadeInvalidation']
        >,
      });
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

      const handler = buildHandler(handleUpdatePersonalityConfigDefaults, {
        ...mockDeps,
        cascadeInvalidation: mockInvalidation as unknown as NonNullable<
          RouteDeps['cascadeInvalidation']
        >,
      });
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

      const handler = buildHandler(handleUpdatePersonalityConfigDefaults, mockDeps);
      const { req, res } = createMockReqRes(
        { maxMessages: -5 },
        { personalityId: TEST_PERSONALITY_ID }
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
