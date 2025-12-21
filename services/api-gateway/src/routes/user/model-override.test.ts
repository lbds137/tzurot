/**
 * Tests for /user/model-override routes
 *
 * Comprehensive tests for setting and removing LLM config overrides.
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

// Mock Prisma with UserService dependencies
const mockPrisma = {
  user: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  persona: {
    create: vi.fn().mockResolvedValue({ id: 'test-persona-uuid' }),
  },
  personality: {
    findFirst: vi.fn(),
  },
  llmConfig: {
    findFirst: vi.fn(),
  },
  userPersonalityConfig: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
    const mockTx = {
      user: {
        create: vi.fn().mockResolvedValue({ id: 'test-user-uuid' }),
        update: vi.fn().mockResolvedValue({ id: 'test-user-uuid' }), // For new user creation
        updateMany: vi.fn().mockResolvedValue({ count: 1 }), // Idempotent backfill
        findUnique: vi.fn().mockResolvedValue({ defaultPersonaId: null }), // For backfill check
      },
      persona: {
        create: vi.fn().mockResolvedValue({ id: 'test-persona-uuid' }),
      },
    };
    await callback(mockTx);
  }),
};

import { createModelOverrideRoutes } from './model-override.js';
import type { PrismaClient } from '@tzurot/common-types';

// Helper to create mock request/response
function createMockReqRes(body: Record<string, unknown> = {}, params: Record<string, string> = {}) {
  const req = {
    body,
    params,
    userId: 'discord-user-123',
  } as unknown as Request & { userId: string };

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

// Helper to get handler from router
function getHandler(
  router: ReturnType<typeof createModelOverrideRoutes>,
  method: 'get' | 'put' | 'delete',
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

describe('/user/model-override routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-uuid-123' });
    // UserService uses findUnique to look up users
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-uuid-123',
      username: 'test-user',
      defaultPersonaId: null,
      isSuperuser: false,
    });
    mockPrisma.userPersonalityConfig.findMany.mockResolvedValue([]);
  });

  describe('route factory', () => {
    it('should create a router', () => {
      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);

      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });

    it('should have GET route registered', () => {
      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);

      expect(router.stack).toBeDefined();
      expect(router.stack.length).toBeGreaterThan(0);

      const getRoute = (
        router.stack as unknown as Array<{ route?: { path?: string; methods?: { get?: boolean } } }>
      ).find(layer => layer.route?.path === '/' && layer.route?.methods?.get);
      expect(getRoute).toBeDefined();
    });

    it('should have PUT route registered', () => {
      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);

      const putRoute = (
        router.stack as unknown as Array<{ route?: { path?: string; methods?: { put?: boolean } } }>
      ).find(layer => layer.route?.path === '/' && layer.route?.methods?.put);
      expect(putRoute).toBeDefined();
    });

    it('should have DELETE route registered', () => {
      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);

      const deleteRoute = (
        router.stack as unknown as Array<{
          route?: { path?: string; methods?: { delete?: boolean } };
        }>
      ).find(layer => layer.route?.path === '/:personalityId' && layer.route?.methods?.delete);
      expect(deleteRoute).toBeDefined();
    });
  });

  describe('GET /user/model-override', () => {
    it('should return empty list when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          overrides: [],
        })
      );
    });

    it('should return overrides with personality and config names', async () => {
      mockPrisma.userPersonalityConfig.findMany.mockResolvedValue([
        {
          personalityId: 'personality-1',
          personality: { name: 'Lilith' },
          llmConfigId: 'config-1',
          llmConfig: { name: 'GPT-4 Config' },
        },
      ]);

      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          overrides: [
            {
              personalityId: 'personality-1',
              personalityName: 'Lilith',
              configId: 'config-1',
              configName: 'GPT-4 Config',
            },
          ],
        })
      );
    });

    it('should handle null config name', async () => {
      mockPrisma.userPersonalityConfig.findMany.mockResolvedValue([
        {
          personalityId: 'personality-1',
          personality: { name: 'Lilith' },
          llmConfigId: 'config-1',
          llmConfig: null,
        },
      ]);

      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          overrides: [
            expect.objectContaining({
              configName: null,
            }),
          ],
        })
      );
    });
  });

  describe('PUT /user/model-override', () => {
    it('should reject missing personalityId', async () => {
      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/');
      const { req, res } = createMockReqRes({ configId: 'config-1' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('personalityId'),
        })
      );
    });

    it('should reject missing configId', async () => {
      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/');
      const { req, res } = createMockReqRes({ personalityId: 'personality-1' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('configId'),
        })
      );
    });

    it('should return 404 when personality not found', async () => {
      mockPrisma.personality.findFirst.mockResolvedValue(null);

      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/');
      const { req, res } = createMockReqRes({
        personalityId: 'personality-1',
        configId: 'config-1',
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Personality'),
        })
      );
    });

    it('should return 404 when config not found or not accessible', async () => {
      mockPrisma.personality.findFirst.mockResolvedValue({ id: 'personality-1', name: 'Lilith' });
      mockPrisma.llmConfig.findFirst.mockResolvedValue(null);

      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/');
      const { req, res } = createMockReqRes({
        personalityId: 'personality-1',
        configId: 'config-1',
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Config'),
        })
      );
    });

    it('should create user if not exists', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: 'new-user' });
      mockPrisma.personality.findFirst.mockResolvedValue({ id: 'personality-1', name: 'Lilith' });
      mockPrisma.llmConfig.findFirst.mockResolvedValue({ id: 'config-1', name: 'GPT-4' });
      mockPrisma.userPersonalityConfig.upsert.mockResolvedValue({
        personalityId: 'personality-1',
        personality: { name: 'Lilith' },
        llmConfigId: 'config-1',
        llmConfig: { name: 'GPT-4' },
      });

      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/');
      const { req, res } = createMockReqRes({
        personalityId: 'personality-1',
        configId: 'config-1',
      });

      await handler(req, res);

      // UserService creates users via $transaction, not direct create
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should upsert override successfully', async () => {
      mockPrisma.personality.findFirst.mockResolvedValue({ id: 'personality-1', name: 'Lilith' });
      mockPrisma.llmConfig.findFirst.mockResolvedValue({ id: 'config-1', name: 'GPT-4' });
      mockPrisma.userPersonalityConfig.upsert.mockResolvedValue({
        personalityId: 'personality-1',
        personality: { name: 'Lilith' },
        llmConfigId: 'config-1',
        llmConfig: { name: 'GPT-4' },
      });

      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/');
      const { req, res } = createMockReqRes({
        personalityId: 'personality-1',
        configId: 'config-1',
      });

      await handler(req, res);

      expect(mockPrisma.userPersonalityConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_personalityId: {
              userId: 'user-uuid-123',
              personalityId: 'personality-1',
            },
          },
          create: expect.objectContaining({
            // Verify deterministic UUID is generated (v5 format check)
            id: expect.stringMatching(
              /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            ),
            userId: 'user-uuid-123',
            personalityId: 'personality-1',
            llmConfigId: 'config-1',
          }),
          update: expect.objectContaining({
            llmConfigId: 'config-1',
          }),
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          override: {
            personalityId: 'personality-1',
            personalityName: 'Lilith',
            configId: 'config-1',
            configName: 'GPT-4',
          },
        })
      );
    });
  });

  describe('DELETE /user/model-override/:personalityId', () => {
    it('should return 404 when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:personalityId');
      const { req, res } = createMockReqRes({}, { personalityId: 'personality-1' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 404 when override not found', async () => {
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);

      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:personalityId');
      const { req, res } = createMockReqRes({}, { personalityId: 'personality-1' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 400 when no model override is set', async () => {
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue({
        id: 'override-1',
        llmConfigId: null,
        personality: { name: 'Lilith' },
      });

      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:personalityId');
      const { req, res } = createMockReqRes({}, { personalityId: 'personality-1' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('No model override'),
        })
      );
    });

    it('should remove override by setting llmConfigId to null', async () => {
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue({
        id: 'override-1',
        llmConfigId: 'config-1',
        personality: { name: 'Lilith' },
      });

      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:personalityId');
      const { req, res } = createMockReqRes({}, { personalityId: 'personality-1' });

      await handler(req, res);

      expect(mockPrisma.userPersonalityConfig.update).toHaveBeenCalledWith({
        where: { id: 'override-1' },
        data: { llmConfigId: null },
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          deleted: true,
        })
      );
    });
  });

  describe('GET /user/model-override/default', () => {
    it('should return null default when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/default');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          default: {
            configId: null,
            configName: null,
          },
        })
      );
    });

    it('should return user default config when set', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        defaultLlmConfigId: 'config-123',
        defaultLlmConfig: { name: 'My Default Config' },
      });

      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/default');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          default: {
            configId: 'config-123',
            configName: 'My Default Config',
          },
        })
      );
    });
  });

  describe('PUT /user/model-override/default', () => {
    it('should reject missing configId', async () => {
      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/default');
      const { req, res } = createMockReqRes({});

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('configId'),
        })
      );
    });

    it('should reject empty configId', async () => {
      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/default');
      const { req, res } = createMockReqRes({ configId: '  ' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 when config not found or not accessible', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue(null);

      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/default');
      const { req, res } = createMockReqRes({ configId: 'config-1' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Config'),
        })
      );
    });

    it('should create user if not exists', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: 'new-user' });
      mockPrisma.llmConfig.findFirst.mockResolvedValue({ id: 'config-1', name: 'Test Config' });

      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/default');
      const { req, res } = createMockReqRes({ configId: 'config-1' });

      await handler(req, res);

      // UserService creates users via $transaction, not direct create
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should set default config successfully', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue({ id: 'config-1', name: 'Test Config' });

      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/default');
      const { req, res } = createMockReqRes({ configId: 'config-1' });

      await handler(req, res);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-123' },
        data: { defaultLlmConfigId: 'config-1' },
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          default: {
            configId: 'config-1',
            configName: 'Test Config',
          },
        })
      );
    });
  });

  describe('PUT /user/model-override/default cache invalidation', () => {
    it('should call invalidateUserLlmConfig on success', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue({ id: 'config-1', name: 'Test Config' });
      const mockInvalidation = {
        invalidateUserLlmConfig: vi.fn().mockResolvedValue(undefined),
      };

      const router = createModelOverrideRoutes(
        mockPrisma as unknown as PrismaClient,
        mockInvalidation as unknown as import('@tzurot/common-types').LlmConfigCacheInvalidationService
      );
      const handler = getHandler(router, 'put', '/default');
      const { req, res } = createMockReqRes({ configId: 'config-1' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockInvalidation.invalidateUserLlmConfig).toHaveBeenCalledWith('discord-user-123');
    });

    it('should not fail if cache invalidation throws', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue({ id: 'config-1', name: 'Test Config' });
      const mockInvalidation = {
        invalidateUserLlmConfig: vi.fn().mockRejectedValue(new Error('Redis error')),
      };

      const router = createModelOverrideRoutes(
        mockPrisma as unknown as PrismaClient,
        mockInvalidation as unknown as import('@tzurot/common-types').LlmConfigCacheInvalidationService
      );
      const handler = getHandler(router, 'put', '/default');
      const { req, res } = createMockReqRes({ configId: 'config-1' });

      await handler(req, res);

      // Should still return success even if cache invalidation fails
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should work without cache invalidation service', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue({ id: 'config-1', name: 'Test Config' });

      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/default');
      const { req, res } = createMockReqRes({ configId: 'config-1' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('DELETE /user/model-override/default', () => {
    it('should return 404 when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/default');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 400 when no default config set', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-uuid-123',
        defaultLlmConfigId: null,
      });

      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/default');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('No default'),
        })
      );
    });

    it('should clear default config successfully', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-uuid-123',
        defaultLlmConfigId: 'config-123',
      });

      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/default');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-123' },
        data: { defaultLlmConfigId: null },
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          deleted: true,
        })
      );
    });
  });

  describe('DELETE /user/model-override/default cache invalidation', () => {
    it('should call invalidateUserLlmConfig on success', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-uuid-123',
        defaultLlmConfigId: 'config-123',
      });
      const mockInvalidation = {
        invalidateUserLlmConfig: vi.fn().mockResolvedValue(undefined),
      };

      const router = createModelOverrideRoutes(
        mockPrisma as unknown as PrismaClient,
        mockInvalidation as unknown as import('@tzurot/common-types').LlmConfigCacheInvalidationService
      );
      const handler = getHandler(router, 'delete', '/default');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockInvalidation.invalidateUserLlmConfig).toHaveBeenCalledWith('discord-user-123');
    });

    it('should not fail if cache invalidation throws', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-uuid-123',
        defaultLlmConfigId: 'config-123',
      });
      const mockInvalidation = {
        invalidateUserLlmConfig: vi.fn().mockRejectedValue(new Error('Redis error')),
      };

      const router = createModelOverrideRoutes(
        mockPrisma as unknown as PrismaClient,
        mockInvalidation as unknown as import('@tzurot/common-types').LlmConfigCacheInvalidationService
      );
      const handler = getHandler(router, 'delete', '/default');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      // Should still return success even if cache invalidation fails
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          deleted: true,
        })
      );
    });

    it('should work without cache invalidation service', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-uuid-123',
        defaultLlmConfigId: 'config-123',
      });

      const router = createModelOverrideRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/default');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
