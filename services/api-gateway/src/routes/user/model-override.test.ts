/**
 * Tests for /user/model-override routes
 *
 * Comprehensive tests for setting and removing LLM config overrides.
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
    findUnique: vi.fn(),
  },
  adminSettings: {
    findUnique: vi.fn(),
  },
  userPersonalityConfig: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
  $executeRaw: vi.fn().mockResolvedValue(1),
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
import { getRouteHandler, findRoute } from '../../test/expressRouterUtils.js';
import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { stubRouteResolvers } from '../../test/shared-route-test-utils.js';

// Helper to create mock request/response
function createMockReqRes(
  body: Record<string, unknown> = {},
  params: Record<string, string> = {},
  query: Record<string, unknown> = {}
) {
  const req = {
    body,
    params,
    query,
    userId: 'discord-user-123',
    provisionedUserId: 'user-uuid-123',
    provisionedDefaultPersonaId: 'persona-uuid-default',
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
  return getRouteHandler(router, method, path);
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
      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });

    it('should have GET route registered', () => {
      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      expect(router.stack).toBeDefined();
      expect(router.stack.length).toBeGreaterThan(0);

      expect(findRoute(router, 'get', '/')).toBeDefined();
    });

    it('should have PUT route registered', () => {
      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      expect(findRoute(router, 'put', '/')).toBeDefined();
    });

    it('should have DELETE route registered', () => {
      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      expect(findRoute(router, 'delete', '/:personalityId')).toBeDefined();
    });
  });

  describe('GET /user/model-override', () => {
    it('should return empty list when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
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
          personalityId: '11111111-1111-4111-a111-111111111111',
          personality: { name: 'Lilith' },
          llmConfigId: '22222222-2222-4222-a222-222222222222',
          llmConfig: { name: 'GPT-4 Config' },
        },
      ]);

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          overrides: [
            {
              personalityId: '11111111-1111-4111-a111-111111111111',
              personalityName: 'Lilith',
              configId: '22222222-2222-4222-a222-222222222222',
              configName: 'GPT-4 Config',
              slot: 'text',
              supportsVision: false,
            },
          ],
        })
      );
    });

    it('enriches supportsVision: true when the list override model is vision-capable', async () => {
      mockPrisma.userPersonalityConfig.findMany.mockResolvedValue([
        {
          personalityId: '11111111-1111-4111-a111-111111111111',
          personality: { name: 'Lilith' },
          llmConfigId: '22222222-2222-4222-a222-222222222222',
          llmConfig: { name: 'GPT-4o', model: 'openai/gpt-4o' },
        },
      ]);

      const modelCache = {
        getModelById: vi.fn(async (id: string) =>
          id === 'openai/gpt-4o' ? { supportsVision: true } : null
        ),
      } as unknown as import('../../services/OpenRouterModelCache.js').OpenRouterModelCache;

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
        modelCache,
      });
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      // Proves the per-row model (from the list select) flows into the capability
      // lookup — a supportsVision hardcoded to false, or a dropped select, fails here.
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          overrides: [expect.objectContaining({ configName: 'GPT-4o', supportsVision: true })],
        })
      );
    });

    it('should handle null config name', async () => {
      mockPrisma.userPersonalityConfig.findMany.mockResolvedValue([
        {
          personalityId: '11111111-1111-4111-a111-111111111111',
          personality: { name: 'Lilith' },
          llmConfigId: '22222222-2222-4222-a222-222222222222',
          llmConfig: null,
        },
      ]);

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
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
      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
      const handler = getHandler(router, 'put', '/');
      const { req, res } = createMockReqRes({ configId: '22222222-2222-4222-a222-222222222222' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('personalityId'),
        })
      );
    });

    it('should reject missing configId', async () => {
      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
      const handler = getHandler(router, 'put', '/');
      const { req, res } = createMockReqRes({
        personalityId: '11111111-1111-4111-a111-111111111111',
      });

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

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
      const handler = getHandler(router, 'put', '/');
      const { req, res } = createMockReqRes({
        personalityId: '11111111-1111-4111-a111-111111111111',
        configId: '22222222-2222-4222-a222-222222222222',
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
      mockPrisma.personality.findFirst.mockResolvedValue({
        id: '11111111-1111-4111-a111-111111111111',
        name: 'Lilith',
      });
      mockPrisma.llmConfig.findFirst.mockResolvedValue(null);

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
      const handler = getHandler(router, 'put', '/');
      const { req, res } = createMockReqRes({
        personalityId: '11111111-1111-4111-a111-111111111111',
        configId: '22222222-2222-4222-a222-222222222222',
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Config'),
        })
      );
    });

    it('should upsert override successfully', async () => {
      mockPrisma.personality.findFirst.mockResolvedValue({
        id: '11111111-1111-4111-a111-111111111111',
        name: 'Lilith',
      });
      mockPrisma.llmConfig.findFirst.mockResolvedValue({
        id: '22222222-2222-4222-a222-222222222222',
        name: 'GPT-4',
      });
      mockPrisma.userPersonalityConfig.upsert.mockResolvedValue({
        personalityId: '11111111-1111-4111-a111-111111111111',
        personality: { name: 'Lilith' },
        llmConfigId: '22222222-2222-4222-a222-222222222222',
        llmConfig: { name: 'GPT-4' },
      });

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
      const handler = getHandler(router, 'put', '/');
      const { req, res } = createMockReqRes({
        personalityId: '11111111-1111-4111-a111-111111111111',
        configId: '22222222-2222-4222-a222-222222222222',
      });

      await handler(req, res);

      expect(mockPrisma.userPersonalityConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_personalityId: {
              userId: 'user-uuid-123',
              personalityId: '11111111-1111-4111-a111-111111111111',
            },
          },
          create: expect.objectContaining({
            // Verify deterministic UUID is generated (v5 format check)
            id: expect.stringMatching(
              /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            ),
            userId: 'user-uuid-123',
            personalityId: '11111111-1111-4111-a111-111111111111',
            llmConfigId: '22222222-2222-4222-a222-222222222222',
          }),
          update: expect.objectContaining({
            llmConfigId: '22222222-2222-4222-a222-222222222222',
          }),
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          override: {
            personalityId: '11111111-1111-4111-a111-111111111111',
            personalityName: 'Lilith',
            configId: '22222222-2222-4222-a222-222222222222',
            configName: 'GPT-4',
            slot: 'text',
            supportsVision: false,
          },
        })
      );
    });

    it('writes the vision slot when ?slot=vision and the model is vision-capable', async () => {
      mockPrisma.personality.findFirst.mockResolvedValue({
        id: '11111111-1111-4111-a111-111111111111',
        name: 'Lilith',
      });
      mockPrisma.llmConfig.findFirst.mockResolvedValue({
        id: '22222222-2222-4222-a222-222222222222',
        name: 'GPT-4o',
        model: 'openai/gpt-4o',
      });
      mockPrisma.userPersonalityConfig.upsert.mockResolvedValue({
        personalityId: '11111111-1111-4111-a111-111111111111',
        personality: { name: 'Lilith' },
        visionConfigId: '22222222-2222-4222-a222-222222222222',
        visionConfig: { name: 'GPT-4o', model: 'openai/gpt-4o' },
      });

      const modelCache = {
        getModelById: vi.fn(async (id: string) =>
          id === 'openai/gpt-4o' ? { supportsVision: true } : null
        ),
      } as unknown as import('../../services/OpenRouterModelCache.js').OpenRouterModelCache;

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
        modelCache,
      });
      const handler = getHandler(router, 'put', '/');
      const { req, res } = createMockReqRes(
        {
          personalityId: '11111111-1111-4111-a111-111111111111',
          configId: '22222222-2222-4222-a222-222222222222',
        },
        {},
        { slot: 'vision' }
      );

      await handler(req, res);

      // The vision slot FK is written, NOT the text slot.
      expect(mockPrisma.userPersonalityConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            visionConfigId: '22222222-2222-4222-a222-222222222222',
          }),
          update: { visionConfigId: '22222222-2222-4222-a222-222222222222' },
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);
      // supportsVision: true proves the enrichment reads the vision slot's model
      // (openai/gpt-4o) capability via modelCache — not the slot label — and that
      // the isVision→visionConfig.model branch is wired correctly.
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          override: expect.objectContaining({ slot: 'vision', supportsVision: true }),
        })
      );
    });

    it('rejects the vision slot when the model is not vision-capable', async () => {
      mockPrisma.personality.findFirst.mockResolvedValue({
        id: '11111111-1111-4111-a111-111111111111',
        name: 'Lilith',
      });
      mockPrisma.llmConfig.findFirst.mockResolvedValue({
        id: '22222222-2222-4222-a222-222222222222',
        name: 'GLM',
        model: 'z-ai/glm-4.7',
      });

      const modelCache = {
        getModelById: vi.fn(async (id: string) =>
          id === 'z-ai/glm-4.7' ? { supportsVision: false } : null
        ),
      } as unknown as import('../../services/OpenRouterModelCache.js').OpenRouterModelCache;

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
        modelCache,
      });
      const handler = getHandler(router, 'put', '/');
      const { req, res } = createMockReqRes(
        {
          personalityId: '11111111-1111-4111-a111-111111111111',
          configId: '22222222-2222-4222-a222-222222222222',
        },
        {},
        { slot: 'vision' }
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('vision'),
        })
      );
      // No write happens when the capability gate rejects.
      expect(mockPrisma.userPersonalityConfig.upsert).not.toHaveBeenCalled();
    });

    it('rejects the vision slot when the model is not in the catalog', async () => {
      mockPrisma.personality.findFirst.mockResolvedValue({
        id: '11111111-1111-4111-a111-111111111111',
        name: 'Lilith',
      });
      mockPrisma.llmConfig.findFirst.mockResolvedValue({
        id: '22222222-2222-4222-a222-222222222222',
        name: 'Mystery',
        model: 'mystery/model',
      });

      const modelCache = {
        getModelById: vi.fn(async () => null), // unknown to OpenRouter + not a z.ai member
      } as unknown as import('../../services/OpenRouterModelCache.js').OpenRouterModelCache;

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
        modelCache,
      });
      const handler = getHandler(router, 'put', '/');
      const { req, res } = createMockReqRes(
        {
          personalityId: '11111111-1111-4111-a111-111111111111',
          configId: '22222222-2222-4222-a222-222222222222',
        },
        {},
        { slot: 'vision' }
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Couldn't confirm"),
        })
      );
      expect(mockPrisma.userPersonalityConfig.upsert).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /user/model-override/:personalityId', () => {
    it('should return 200 (idempotent) when override not found', async () => {
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
      const handler = getHandler(router, 'delete', '/:personalityId');
      const { req, res } = createMockReqRes(
        {},
        { personalityId: '11111111-1111-4111-a111-111111111111' }
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ deleted: true, wasSet: false })
      );
    });

    it('should return 200 (idempotent) when no model override is set', async () => {
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue({
        id: 'override-1',
        llmConfigId: null,
        personality: { name: 'Lilith' },
      });

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
      const handler = getHandler(router, 'delete', '/:personalityId');
      const { req, res } = createMockReqRes(
        {},
        { personalityId: '11111111-1111-4111-a111-111111111111' }
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ deleted: true, wasSet: false })
      );
    });

    it('should remove override by setting llmConfigId to null', async () => {
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue({
        id: 'override-1',
        llmConfigId: '22222222-2222-4222-a222-222222222222',
        personality: { name: 'Lilith' },
      });

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
      const handler = getHandler(router, 'delete', '/:personalityId');
      const { req, res } = createMockReqRes(
        {},
        { personalityId: '11111111-1111-4111-a111-111111111111' }
      );

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
    it('should return null default when user has none set', async () => {
      // Provisioning middleware sets the UUID; handler's findUnique for the default config returns null.
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        defaultLlmConfigId: null,
        defaultLlmConfig: null,
      });

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
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
      // Provisioning middleware sets the UUID; handler's findUnique fetches the stored default.
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        defaultLlmConfigId: 'config-123',
        defaultLlmConfig: { name: 'My Default Config' },
      });

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
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
      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
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
      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
      const handler = getHandler(router, 'put', '/default');
      const { req, res } = createMockReqRes({ configId: '  ' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 when config not found or not accessible', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue(null);

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
      const handler = getHandler(router, 'put', '/default');
      const { req, res } = createMockReqRes({ configId: '22222222-2222-4222-a222-222222222222' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Config'),
        })
      );
    });

    it('should set default config successfully', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue({
        id: '22222222-2222-4222-a222-222222222222',
        name: 'Test Config',
      });

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
      const handler = getHandler(router, 'put', '/default');
      const { req, res } = createMockReqRes({ configId: '22222222-2222-4222-a222-222222222222' });

      await handler(req, res);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-123' },
        data: { defaultLlmConfigId: '22222222-2222-4222-a222-222222222222' },
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          default: {
            configId: '22222222-2222-4222-a222-222222222222',
            configName: 'Test Config',
          },
        })
      );
    });

    it('writes the vision default when ?slot=vision and the model is vision-capable', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue({
        id: '22222222-2222-4222-a222-222222222222',
        name: 'GPT-4o',
        model: 'openai/gpt-4o',
      });

      const modelCache = {
        getModelById: vi.fn(async (id: string) =>
          id === 'openai/gpt-4o' ? { supportsVision: true } : null
        ),
      } as unknown as import('../../services/OpenRouterModelCache.js').OpenRouterModelCache;

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
        modelCache,
      });
      const handler = getHandler(router, 'put', '/default');
      const { req, res } = createMockReqRes(
        { configId: '22222222-2222-4222-a222-222222222222' },
        {},
        { slot: 'vision' }
      );

      await handler(req, res);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-123' },
        data: { defaultVisionConfigId: '22222222-2222-4222-a222-222222222222' },
      });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('rejects the vision default when the model is not vision-capable', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue({
        id: '22222222-2222-4222-a222-222222222222',
        name: 'GLM',
        model: 'z-ai/glm-4.7',
      });

      const modelCache = {
        getModelById: vi.fn(async (id: string) =>
          id === 'z-ai/glm-4.7' ? { supportsVision: false } : null
        ),
      } as unknown as import('../../services/OpenRouterModelCache.js').OpenRouterModelCache;

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
        modelCache,
      });
      const handler = getHandler(router, 'put', '/default');
      const { req, res } = createMockReqRes(
        { configId: '22222222-2222-4222-a222-222222222222' },
        {},
        { slot: 'vision' }
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('vision'),
        })
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects the vision default when the model is not in the catalog', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue({
        id: '22222222-2222-4222-a222-222222222222',
        name: 'Mystery',
        model: 'mystery/model',
      });

      const modelCache = {
        getModelById: vi.fn(async () => null), // unknown to OpenRouter + not a z.ai member
      } as unknown as import('../../services/OpenRouterModelCache.js').OpenRouterModelCache;

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
        modelCache,
      });
      const handler = getHandler(router, 'put', '/default');
      const { req, res } = createMockReqRes(
        { configId: '22222222-2222-4222-a222-222222222222' },
        {},
        { slot: 'vision' }
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Couldn't confirm"),
        })
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('PUT /user/model-override/default cache invalidation', () => {
    it('should call invalidateUserLlmConfig on success', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue({
        id: '22222222-2222-4222-a222-222222222222',
        name: 'Test Config',
      });
      const mockInvalidation = {
        invalidateUserLlmConfig: vi.fn().mockResolvedValue(undefined),
      };

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
        llmConfigCacheInvalidation:
          mockInvalidation as unknown as import('@tzurot/cache-invalidation').LlmConfigCacheInvalidationService,
      });
      const handler = getHandler(router, 'put', '/default');
      const { req, res } = createMockReqRes({ configId: '22222222-2222-4222-a222-222222222222' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockInvalidation.invalidateUserLlmConfig).toHaveBeenCalledWith('discord-user-123');
    });

    it('should not fail if cache invalidation throws', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue({
        id: '22222222-2222-4222-a222-222222222222',
        name: 'Test Config',
      });
      const mockInvalidation = {
        invalidateUserLlmConfig: vi.fn().mockRejectedValue(new Error('Redis error')),
      };

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
        llmConfigCacheInvalidation:
          mockInvalidation as unknown as import('@tzurot/cache-invalidation').LlmConfigCacheInvalidationService,
      });
      const handler = getHandler(router, 'put', '/default');
      const { req, res } = createMockReqRes({ configId: '22222222-2222-4222-a222-222222222222' });

      await handler(req, res);

      // Should still return success even if cache invalidation fails
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should work without cache invalidation service', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue({
        id: '22222222-2222-4222-a222-222222222222',
        name: 'Test Config',
      });

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
      const handler = getHandler(router, 'put', '/default');
      const { req, res } = createMockReqRes({ configId: '22222222-2222-4222-a222-222222222222' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('DELETE /user/model-override/default', () => {
    it('should return 404 when user lookup returns null after provisioning', async () => {
      // Provisioning middleware sets the UUID; handler-level findUnique returns null (e.g., race with user deletion).
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
      const handler = getHandler(router, 'delete', '/default');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 200 (idempotent) when no default config set', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        defaultLlmConfigId: null,
      });

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
      const handler = getHandler(router, 'delete', '/default');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          deleted: true,
          wasSet: false,
          // No slot arg → slot defaults to text; no admin free default mocked → null.
          newEffectiveDefaults: { text: null },
        })
      );
    });

    it('should clear default config successfully', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        defaultLlmConfigId: 'config-123',
      });

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
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
          wasSet: true,
          // text slot cleared, no admin free default mocked → null fallback.
          newEffectiveDefaults: { text: null },
        })
      );
    });

    it('should include newEffectiveDefaults on the no-op path when free default exists', async () => {
      // Coverage: the 4th cell in the (wasSet × freeDefault) matrix.
      // Confirms the pointer lookup still runs even when the early-return
      // wasSet:false branch is taken.
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        defaultLlmConfigId: null,
      });
      mockPrisma.adminSettings.findUnique.mockResolvedValueOnce({
        freeDefaultLlmConfigId: 'free-id',
        freeDefaultVisionConfigId: null,
      });
      mockPrisma.llmConfig.findUnique.mockResolvedValueOnce({
        id: 'free-id',
        name: 'gpt-4-free',
      });

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
      const handler = getHandler(router, 'delete', '/default');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          deleted: true,
          wasSet: false,
          newEffectiveDefaults: { text: { id: 'free-id', name: 'gpt-4-free' } },
        })
      );
    });

    it('should include the system free default in newEffectiveDefaults when one is configured', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        defaultLlmConfigId: 'config-123',
      });
      // The fallback name comes from the AdminSettings free-default POINTER, not
      // the stale `isFreeDefault` boolean (setAsFreeDefault writes only the pointer).
      mockPrisma.adminSettings.findUnique.mockResolvedValueOnce({
        freeDefaultLlmConfigId: 'free-id',
        freeDefaultVisionConfigId: null,
      });
      mockPrisma.llmConfig.findUnique.mockResolvedValueOnce({
        id: 'free-id',
        name: 'gpt-4-free',
      });

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
      const handler = getHandler(router, 'delete', '/default');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledWith({
        where: { id: ADMIN_SETTINGS_SINGLETON_ID },
        select: { freeDefaultLlmConfigId: true, freeDefaultVisionConfigId: true },
      });
      expect(mockPrisma.llmConfig.findUnique).toHaveBeenCalledWith({
        where: { id: 'free-id' },
        select: { id: true, name: true },
      });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          deleted: true,
          newEffectiveDefaults: { text: { id: 'free-id', name: 'gpt-4-free' } },
        })
      );
    });
  });

  describe('DELETE /user/model-override/default cache invalidation', () => {
    it('should call invalidateUserLlmConfig on success', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        defaultLlmConfigId: 'config-123',
      });
      const mockInvalidation = {
        invalidateUserLlmConfig: vi.fn().mockResolvedValue(undefined),
      };

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
        llmConfigCacheInvalidation:
          mockInvalidation as unknown as import('@tzurot/cache-invalidation').LlmConfigCacheInvalidationService,
      });
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

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
        llmConfigCacheInvalidation:
          mockInvalidation as unknown as import('@tzurot/cache-invalidation').LlmConfigCacheInvalidationService,
      });
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

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
      const handler = getHandler(router, 'delete', '/default');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('vision slot branching', () => {
    const VISION_CFG = '33333333-3333-4333-a333-333333333333';
    const PERSONALITY = '11111111-1111-4111-a111-111111111111';

    // NOTE: the PUT-set paths (vision slot via `?slot=vision` + capability gate)
    // are covered above in the `PUT /user/model-override` and `PUT /default`
    // describe blocks. The slot is chosen by the request, so those write tests
    // live with the rest of the set-handler coverage. The read/clear `?slot=`
    // scoping below is what this block exercises.

    it('GET /default?slot=vision returns the vision default (text default ignored)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        defaultLlmConfigId: 'text-cfg',
        defaultLlmConfig: { name: 'Text' },
        defaultVisionConfigId: VISION_CFG,
        defaultVisionConfig: { name: 'Vision Cfg' },
      });

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
      const handler = getHandler(router, 'get', '/default');
      const { req, res } = createMockReqRes({}, {}, { slot: 'vision' });

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          default: { configId: VISION_CFG, configName: 'Vision Cfg' },
        })
      );
    });

    it('DELETE /default?slot=vision clears only the vision default + scopes the free fallback', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        defaultLlmConfigId: 'text-cfg',
        defaultVisionConfigId: VISION_CFG,
      });
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        freeDefaultLlmConfigId: null,
        freeDefaultVisionConfigId: 'vision-free',
      });
      mockPrisma.llmConfig.findUnique.mockResolvedValue({ id: 'vision-free', name: 'Vision Free' });

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
      const handler = getHandler(router, 'delete', '/default');
      const { req, res } = createMockReqRes({}, {}, { slot: 'vision' });

      await handler(req, res);

      // Exactly one update, targeting ONLY the vision FK — the text default is
      // never touched (the "clears only" guarantee).
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-123' },
        data: { defaultVisionConfigId: null },
      });
      // The fallback resolves the VISION free-default POINTER (cleared slot=vision).
      // Exactly once — the text slot is NOT resolved (the "clears only vision" contract).
      expect(mockPrisma.llmConfig.findUnique).toHaveBeenCalledTimes(1);
      expect(mockPrisma.llmConfig.findUnique).toHaveBeenCalledWith({
        where: { id: 'vision-free' },
        select: { id: true, name: true },
      });
      // Only the vision slot is reported — text was not cleared, so there's no
      // `text` key (the per-slot contract: a key is present iff that slot cleared).
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          newEffectiveDefaults: { vision: { id: 'vision-free', name: 'Vision Free' } },
        })
      );
    });

    it('GET /?slot=vision lists vision overrides', async () => {
      mockPrisma.userPersonalityConfig.findMany.mockResolvedValue([
        {
          personalityId: PERSONALITY,
          personality: { name: 'Lilith' },
          llmConfigId: null,
          llmConfig: null,
          visionConfigId: VISION_CFG,
          visionConfig: { name: 'Vision Cfg' },
        },
      ]);

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes({}, {}, { slot: 'vision' });

      await handler(req, res);

      expect(mockPrisma.userPersonalityConfig.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ visionConfigId: { not: null } }),
        })
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          overrides: [expect.objectContaining({ configId: VISION_CFG, configName: 'Vision Cfg' })],
        })
      );
    });

    it('GET /?slot=all emits one slot-tagged row per non-null FK (both on one personality)', async () => {
      mockPrisma.userPersonalityConfig.findMany.mockResolvedValue([
        {
          personalityId: PERSONALITY,
          personality: { name: 'Lilith' },
          llmConfigId: 'text-cfg',
          llmConfig: { name: 'Text Cfg' },
          visionConfigId: VISION_CFG,
          visionConfig: { name: 'Vision Cfg' },
        },
      ]);

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes({}, {}, { slot: 'all' });

      await handler(req, res);

      // All-slots query matches a row with EITHER FK set (not a single-slot filter).
      expect(mockPrisma.userPersonalityConfig.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ llmConfigId: { not: null } }, { visionConfigId: { not: null } }],
          }),
        })
      );
      // One personality with both FKs → two rows, each tagged with its slot.
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          overrides: [
            {
              personalityId: PERSONALITY,
              personalityName: 'Lilith',
              configId: 'text-cfg',
              configName: 'Text Cfg',
              slot: 'text',
              supportsVision: false,
            },
            {
              personalityId: PERSONALITY,
              personalityName: 'Lilith',
              configId: VISION_CFG,
              configName: 'Vision Cfg',
              slot: 'vision',
              supportsVision: false,
            },
          ],
        })
      );
    });

    it('DELETE /:personalityId?slot=vision clears only the vision override', async () => {
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue({
        id: 'upc-1',
        llmConfigId: 'text-cfg',
        visionConfigId: VISION_CFG,
        personality: { name: 'Lilith' },
      });

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
      const handler = getHandler(router, 'delete', '/:personalityId');
      const { req, res } = createMockReqRes({}, { personalityId: PERSONALITY }, { slot: 'vision' });

      await handler(req, res);

      // Exactly one update, targeting ONLY the vision override FK.
      expect(mockPrisma.userPersonalityConfig.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.userPersonalityConfig.update).toHaveBeenCalledWith({
        where: { id: 'upc-1' },
        data: { visionConfigId: null },
      });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('DELETE /default?slot=all clears BOTH defaults in one update', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        defaultLlmConfigId: 'text-cfg',
        defaultVisionConfigId: VISION_CFG,
      });
      // `all` clears BOTH slots, so the fallback resolves BOTH free-default
      // pointers — one llmConfig.findUnique per slot, in clearText→clearVision order.
      mockPrisma.adminSettings.findUnique.mockResolvedValueOnce({
        freeDefaultLlmConfigId: 'text-free',
        freeDefaultVisionConfigId: 'vision-free',
      });
      mockPrisma.llmConfig.findUnique
        .mockResolvedValueOnce({ id: 'text-free', name: 'Text Free' })
        .mockResolvedValueOnce({ id: 'vision-free', name: 'Vision Free' });

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
      const handler = getHandler(router, 'delete', '/default');
      const { req, res } = createMockReqRes({}, {}, { slot: 'all' });

      await handler(req, res);

      // One update nulling BOTH default FKs — no-slot clear targets both slots.
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-123' },
        data: { defaultLlmConfigId: null, defaultVisionConfigId: null },
      });
      // The bug fix: an `all` clear reports BOTH fallbacks, not just the chat one.
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          newEffectiveDefaults: {
            text: { id: 'text-free', name: 'Text Free' },
            vision: { id: 'vision-free', name: 'Vision Free' },
          },
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('DELETE /:personalityId?slot=all clears BOTH override slots in one update', async () => {
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue({
        id: 'upc-1',
        llmConfigId: 'text-cfg',
        visionConfigId: VISION_CFG,
        personality: { name: 'Lilith' },
      });

      const router = createModelOverrideRoutes({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
      const handler = getHandler(router, 'delete', '/:personalityId');
      const { req, res } = createMockReqRes({}, { personalityId: PERSONALITY }, { slot: 'all' });

      await handler(req, res);

      // One update nulling BOTH override FKs.
      expect(mockPrisma.userPersonalityConfig.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.userPersonalityConfig.update).toHaveBeenCalledWith({
        where: { id: 'upc-1' },
        data: { llmConfigId: null, visionConfigId: null },
      });
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
