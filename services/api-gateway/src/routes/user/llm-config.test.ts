/**
 * Tests for /user/llm-config routes
 *
 * Comprehensive tests for CRUD operations on user LLM configs.
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
  llmConfig: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  userPersonalityConfig: {
    count: vi.fn(),
  },
  personalityDefaultConfig: {
    count: vi.fn(),
  },
  $transaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
    const mockTx = {
      user: {
        create: vi.fn().mockResolvedValue({ id: 'test-user-uuid' }),
        update: vi.fn().mockResolvedValue({ id: 'test-user-uuid' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({ defaultPersonaId: null }),
      },
      persona: {
        create: vi.fn().mockResolvedValue({ id: 'test-persona-uuid' }),
      },
    };
    await callback(mockTx);
  }),
};

// Mock cache invalidation service (partial mock)
const mockCacheInvalidation = {
  invalidateUserLlmConfig: vi.fn().mockResolvedValue(undefined),
  invalidateAll: vi.fn().mockResolvedValue(undefined),
} as unknown as import('@tzurot/common-types').LlmConfigCacheInvalidationService;

import { createLlmConfigRoutes } from './llm-config.js';
import { getRouteHandler, findRoute } from '../../test/expressRouterUtils.js';
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
  router: ReturnType<typeof createLlmConfigRoutes>,
  method: 'get' | 'post' | 'put' | 'delete',
  path: string
) {
  return getRouteHandler(router, method, path);
}

describe('/user/llm-config routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-uuid-123' });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-uuid-123',
      username: 'test-user',
      defaultPersonaId: null,
      isSuperuser: false,
    });
    mockPrisma.llmConfig.findMany.mockResolvedValue([]);
    mockPrisma.llmConfig.findFirst.mockResolvedValue(null);
    mockPrisma.llmConfig.findUnique.mockResolvedValue(null);
    mockPrisma.userPersonalityConfig.count.mockResolvedValue(0);
  });

  describe('route factory', () => {
    it('should create a router', () => {
      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);

      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });

    it('should have GET / route registered', () => {
      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);

      expect(router.stack).toBeDefined();
      expect(router.stack.length).toBeGreaterThan(0);

      expect(findRoute(router, 'get', '/')).toBeDefined();
    });

    it('should have GET /:id route registered', () => {
      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);

      expect(findRoute(router, 'get', '/:id')).toBeDefined();
    });

    it('should have POST route registered', () => {
      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);

      expect(findRoute(router, 'post', '/')).toBeDefined();
    });

    it('should have PUT /:id route registered', () => {
      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);

      expect(findRoute(router, 'put', '/:id')).toBeDefined();
    });

    it('should have DELETE route registered', () => {
      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);

      expect(findRoute(router, 'delete', '/:id')).toBeDefined();
    });
  });

  describe('GET /user/llm-config', () => {
    it('should return global configs', async () => {
      const globalConfig = {
        id: 'config-1',
        name: 'Default',
        description: 'Default config',
        provider: 'openrouter',
        model: 'gpt-4',
        visionModel: null,
        isGlobal: true,
        isDefault: true,
      };
      mockPrisma.llmConfig.findMany.mockResolvedValueOnce([globalConfig]).mockResolvedValueOnce([]);

      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          configs: [expect.objectContaining({ id: 'config-1', isOwned: false })],
        })
      );
    });

    it('should return user configs with isOwned=true', async () => {
      const userConfig = {
        id: 'user-config-1',
        name: 'My Config',
        description: 'Custom',
        provider: 'openrouter',
        model: 'claude-3',
        visionModel: null,
        isGlobal: false,
        isDefault: false,
        ownerId: 'user-uuid-123', // Match user.id from beforeEach
      };
      mockPrisma.llmConfig.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([userConfig]);

      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          configs: [expect.objectContaining({ id: 'user-config-1', isOwned: true })],
        })
      );
    });

    it('should return empty user configs when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.llmConfig.findMany.mockResolvedValue([]);

      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          configs: [],
        })
      );
    });
  });

  describe('GET /user/llm-config/:id', () => {
    it('should return 404 when config not found', async () => {
      mockPrisma.llmConfig.findUnique.mockResolvedValue(null);

      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/:id');
      const { req, res } = createMockReqRes({}, { id: 'config-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return config with isOwned=true for user-owned config', async () => {
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        name: 'My Config',
        description: 'Custom',
        provider: 'openrouter',
        model: 'claude-3',
        visionModel: null,
        isGlobal: false,
        isDefault: false,
        ownerId: 'user-uuid-123',
        advancedParameters: { temperature: 0.7 },
      });

      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/:id');
      const { req, res } = createMockReqRes({}, { id: 'config-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            id: 'config-123',
            isOwned: true,
            params: { temperature: 0.7 },
          }),
        })
      );
    });

    it('should return config with isOwned=false for other user global config', async () => {
      // Global config owned by another user - still visible but not owned
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        name: 'Global Config',
        description: 'Shared preset',
        provider: 'openrouter',
        model: 'gpt-4',
        visionModel: null,
        isGlobal: true,
        isDefault: true,
        ownerId: 'other-user-uuid', // Different user owns this
        advancedParameters: null,
      });

      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/:id');
      const { req, res } = createMockReqRes({}, { id: 'config-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            id: 'config-123',
            isOwned: false, // Not owned by requesting user
            params: {},
          }),
        })
      );
    });
  });

  describe('POST /user/llm-config', () => {
    it('should reject missing name', async () => {
      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({ model: 'gpt-4' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: expect.stringContaining('name'),
        })
      );
    });

    it('should reject missing model', async () => {
      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({ name: 'My Config' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('model'),
        })
      );
    });

    it('should reject name over 100 characters', async () => {
      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        name: 'a'.repeat(101),
        model: 'gpt-4',
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('100 characters'),
        })
      );
    });

    it('should reject duplicate name for user', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue({ id: 'existing' });

      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({ name: 'My Config', model: 'gpt-4' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('already have a config'),
        })
      );
    });

    it('should create config with defaults', async () => {
      mockPrisma.llmConfig.create.mockResolvedValue({
        id: 'new-config',
        name: 'My Config',
        description: null,
        provider: 'openrouter',
        model: 'gpt-4',
        visionModel: null,
        isGlobal: false,
        isDefault: false,
      });

      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({ name: 'My Config', model: 'gpt-4' });

      await handler(req, res);

      expect(mockPrisma.llmConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'My Config',
            model: 'gpt-4',
            provider: 'openrouter',
            isGlobal: false,
          }),
        })
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('should create config with advancedParameters', async () => {
      mockPrisma.llmConfig.create.mockResolvedValue({
        id: 'new-config',
        name: 'My Config',
        description: null,
        provider: 'openrouter',
        model: 'gpt-4',
        visionModel: null,
        isGlobal: false,
        isDefault: false,
      });

      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        name: 'My Config',
        model: 'gpt-4',
        advancedParameters: { temperature: 0.8, top_p: 0.9 },
      });

      await handler(req, res);

      expect(mockPrisma.llmConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            advancedParameters: { temperature: 0.8, top_p: 0.9 },
          }),
        })
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('should create config with memory settings (Phase 1 parity)', async () => {
      // This test verifies Phase 1 parity - user routes must accept same fields as admin
      mockPrisma.llmConfig.create.mockResolvedValue({
        id: 'new-config',
        name: 'Memory Config',
        description: null,
        provider: 'openrouter',
        model: 'gpt-4',
        visionModel: null,
        isGlobal: false,
        isDefault: false,
        memoryScoreThreshold: { toNumber: () => 0.75 },
        memoryLimit: 50,
        contextWindowTokens: 100000,
      });

      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        name: 'Memory Config',
        model: 'gpt-4',
        memoryScoreThreshold: 0.75,
        memoryLimit: 50,
        contextWindowTokens: 100000,
      });

      await handler(req, res);

      // Verify memory settings are passed to Prisma create
      expect(mockPrisma.llmConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            memoryScoreThreshold: 0.75,
            memoryLimit: 50,
            contextWindowTokens: 100000,
          }),
        })
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('should create user if not exists', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: 'new-user' });
      mockPrisma.llmConfig.create.mockResolvedValue({
        id: 'new-config',
        name: 'My Config',
        description: null,
        provider: 'openrouter',
        model: 'gpt-4',
        visionModel: null,
        isGlobal: false,
        isDefault: false,
      });

      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({ name: 'My Config', model: 'gpt-4' });

      await handler(req, res);

      // UserService creates users via $transaction
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe('PUT /user/llm-config/:id', () => {
    it('should return 404 when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const router = createLlmConfigRoutes(
        mockPrisma as unknown as PrismaClient,
        mockCacheInvalidation
      );
      const handler = getHandler(router, 'put', '/:id');
      const { req, res } = createMockReqRes({ name: 'New Name' }, { id: 'config-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 404 when config not found', async () => {
      mockPrisma.llmConfig.findUnique.mockResolvedValue(null);

      const router = createLlmConfigRoutes(
        mockPrisma as unknown as PrismaClient,
        mockCacheInvalidation
      );
      const handler = getHandler(router, 'put', '/:id');
      const { req, res } = createMockReqRes({ name: 'New Name' }, { id: 'config-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should allow owner to edit own global config', async () => {
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        ownerId: 'user-uuid-123',
        isGlobal: true,
        name: 'My Global Config',
      });
      mockPrisma.llmConfig.update.mockResolvedValue({
        id: 'config-123',
        name: 'Updated Global Config',
        description: null,
        provider: 'openrouter',
        model: 'test-model',
        visionModel: null,
        isGlobal: true,
        isDefault: false,
        ownerId: 'user-uuid-123',
        advancedParameters: {},
      });

      const router = createLlmConfigRoutes(
        mockPrisma as unknown as PrismaClient,
        mockCacheInvalidation
      );
      const handler = getHandler(router, 'put', '/:id');
      const { req, res } = createMockReqRes(
        { name: 'Updated Global Config' },
        { id: 'config-123' }
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockPrisma.llmConfig.update).toHaveBeenCalled();
    });

    // Note: LlmConfig.ownerId is NOT nullable in the schema - all configs have an owner
    // "Global" just means visible to all users, not system-owned

    it('should reject editing other user config', async () => {
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        ownerId: 'other-user',
        isGlobal: false,
        name: 'Other User Config',
      });

      const router = createLlmConfigRoutes(
        mockPrisma as unknown as PrismaClient,
        mockCacheInvalidation
      );
      const handler = getHandler(router, 'put', '/:id');
      const { req, res } = createMockReqRes({ name: 'New Name' }, { id: 'config-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should reject update with no fields', async () => {
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        ownerId: 'user-uuid-123',
        isGlobal: false,
        name: 'My Config',
      });

      const router = createLlmConfigRoutes(
        mockPrisma as unknown as PrismaClient,
        mockCacheInvalidation
      );
      const handler = getHandler(router, 'put', '/:id');
      const { req, res } = createMockReqRes({}, { id: 'config-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('No fields'),
        })
      );
    });

    it('should reject non-boolean isGlobal value', async () => {
      const router = createLlmConfigRoutes(
        mockPrisma as unknown as PrismaClient,
        mockCacheInvalidation
      );
      const handler = getHandler(router, 'put', '/:id');
      // Send string instead of boolean - Zod validates before DB lookup
      const { req, res } = createMockReqRes({ isGlobal: 'true' }, { id: 'config-123' });

      await handler(req, res);

      // Zod returns field-prefixed error with "expected boolean" message
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('isGlobal'),
        })
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('expected boolean'),
        })
      );
    });

    it('should update owned config', async () => {
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        ownerId: 'user-uuid-123',
        isGlobal: false,
        name: 'My Config',
      });
      mockPrisma.llmConfig.update.mockResolvedValue({
        id: 'config-123',
        name: 'New Name',
        description: 'Updated',
        provider: 'openrouter',
        model: 'claude-3',
        visionModel: null,
        isGlobal: false,
        isDefault: false,
        isFreeDefault: false,
        ownerId: 'user-uuid-123',
        advancedParameters: { temperature: 0.9 },
      });

      const router = createLlmConfigRoutes(
        mockPrisma as unknown as PrismaClient,
        mockCacheInvalidation
      );
      const handler = getHandler(router, 'put', '/:id');
      const { req, res } = createMockReqRes(
        { name: 'New Name', advancedParameters: { temperature: 0.9 } },
        { id: 'config-123' }
      );

      await handler(req, res);

      expect(mockPrisma.llmConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'config-123' },
          data: expect.objectContaining({
            name: 'New Name',
            advancedParameters: { temperature: 0.9 },
          }),
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            id: 'config-123',
            name: 'New Name',
            params: { temperature: 0.9 },
          }),
        })
      );
    });

    it('should invalidate cache on update', async () => {
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        ownerId: 'user-uuid-123',
        isGlobal: false,
        name: 'My Config',
      });
      mockPrisma.llmConfig.update.mockResolvedValue({
        id: 'config-123',
        name: 'New Name',
        description: null,
        provider: 'openrouter',
        model: 'claude-3',
        visionModel: null,
        isGlobal: false,
        isDefault: false,
        isFreeDefault: false,
        ownerId: 'user-uuid-123',
        advancedParameters: null,
      });

      const router = createLlmConfigRoutes(
        mockPrisma as unknown as PrismaClient,
        mockCacheInvalidation
      );
      const handler = getHandler(router, 'put', '/:id');
      const { req, res } = createMockReqRes({ name: 'New Name' }, { id: 'config-123' });

      await handler(req, res);

      // Service uses invalidateAll for all cache operations
      expect(mockCacheInvalidation.invalidateAll).toHaveBeenCalled();
    });
  });

  describe('DELETE /user/llm-config/:id', () => {
    it('should return 404 when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:id');
      const { req, res } = createMockReqRes({}, { id: 'config-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 404 when config not found', async () => {
      // Service uses findUnique for getById
      mockPrisma.llmConfig.findUnique.mockResolvedValue(null);

      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:id');
      const { req, res } = createMockReqRes({}, { id: 'config-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should allow owner to delete their own global config', async () => {
      // Users can share their presets (isGlobal: true) while retaining control
      // Service uses findUnique for getById
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        ownerId: 'user-uuid-123',
        isGlobal: true,
        name: 'User Shared Config',
      });
      // Service's checkDeleteConstraints checks both counts
      mockPrisma.personalityDefaultConfig.count.mockResolvedValue(0);
      mockPrisma.userPersonalityConfig.count.mockResolvedValue(0);
      mockPrisma.llmConfig.delete.mockResolvedValue({} as unknown);

      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:id');
      const { req, res } = createMockReqRes({}, { id: 'config-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockPrisma.llmConfig.delete).toHaveBeenCalledWith({
        where: { id: 'config-123' },
      });
    });

    // Note: LlmConfig.ownerId is NOT nullable in the schema - all configs have an owner
    // "Global" just means visible to all users, not system-owned

    it('should reject deleting other user config', async () => {
      // Service uses findUnique for getById
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        ownerId: 'other-user',
        isGlobal: false,
        name: 'Other User Config',
      });

      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:id');
      const { req, res } = createMockReqRes({}, { id: 'config-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should reject deleting config in use', async () => {
      // Service uses findUnique for getById
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        ownerId: 'user-uuid-123',
        isGlobal: false,
        name: 'My Config',
      });
      // Service's checkDeleteConstraints checks both counts
      mockPrisma.personalityDefaultConfig.count.mockResolvedValue(0);
      mockPrisma.userPersonalityConfig.count.mockResolvedValue(2);

      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:id');
      const { req, res } = createMockReqRes({}, { id: 'config-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('used by'),
        })
      );
    });

    it('should delete owned config', async () => {
      // Service uses findUnique for getById
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        ownerId: 'user-uuid-123',
        isGlobal: false,
        name: 'My Config',
      });
      // Service's checkDeleteConstraints checks both counts
      mockPrisma.personalityDefaultConfig.count.mockResolvedValue(0);
      mockPrisma.userPersonalityConfig.count.mockResolvedValue(0);

      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:id');
      const { req, res } = createMockReqRes({}, { id: 'config-123' });

      await handler(req, res);

      expect(mockPrisma.llmConfig.delete).toHaveBeenCalledWith({
        where: { id: 'config-123' },
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          deleted: true,
        })
      );
    });
  });

  describe('POST /user/llm-config/resolve', () => {
    it('should reject missing personalityId', async () => {
      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/resolve');
      const { req, res } = createMockReqRes({
        personalityConfig: { id: 'p-1', name: 'Test', model: 'gpt-4' },
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject missing personalityConfig', async () => {
      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/resolve');
      const { req, res } = createMockReqRes({
        personalityId: 'personality-123',
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject invalid personalityConfig structure', async () => {
      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/resolve');
      const { req, res } = createMockReqRes({
        personalityId: 'personality-123',
        personalityConfig: { invalid: true }, // Missing required fields
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
