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
    create: vi.fn(),
    delete: vi.fn(),
  },
  userPersonalityConfig: {
    count: vi.fn(),
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

import { createLlmConfigRoutes } from './llm-config.js';
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
  method: 'get' | 'post' | 'delete',
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

describe('/user/llm-config routes', () => {
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
    mockPrisma.llmConfig.findMany.mockResolvedValue([]);
    mockPrisma.llmConfig.findFirst.mockResolvedValue(null);
    mockPrisma.userPersonalityConfig.count.mockResolvedValue(0);
  });

  describe('route factory', () => {
    it('should create a router', () => {
      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);

      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });

    it('should have GET route registered', () => {
      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);

      expect(router.stack).toBeDefined();
      expect(router.stack.length).toBeGreaterThan(0);

      const getRoute = (
        router.stack as unknown as Array<{ route?: { path?: string; methods?: { get?: boolean } } }>
      ).find(layer => layer.route?.path === '/' && layer.route?.methods?.get);
      expect(getRoute).toBeDefined();
    });

    it('should have POST route registered', () => {
      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);

      const postRoute = (
        router.stack as unknown as Array<{
          route?: { path?: string; methods?: { post?: boolean } };
        }>
      ).find(layer => layer.route?.path === '/' && layer.route?.methods?.post);
      expect(postRoute).toBeDefined();
    });

    it('should have DELETE route registered', () => {
      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);

      const deleteRoute = (
        router.stack as unknown as Array<{
          route?: { path?: string; methods?: { delete?: boolean } };
        }>
      ).find(layer => layer.route?.path === '/:id' && layer.route?.methods?.delete);
      expect(deleteRoute).toBeDefined();
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
            maxReferencedMessages: 20,
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

      // UserService creates users via $transaction, not direct create
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
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
      mockPrisma.llmConfig.findFirst.mockResolvedValue(null);

      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:id');
      const { req, res } = createMockReqRes({}, { id: 'config-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should reject deleting global config', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue({
        id: 'config-123',
        ownerId: 'user-uuid-123',
        isGlobal: true,
        name: 'Global Config',
      });

      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:id');
      const { req, res } = createMockReqRes({}, { id: 'config-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should reject deleting other user config', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue({
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
      mockPrisma.llmConfig.findFirst.mockResolvedValue({
        id: 'config-123',
        ownerId: 'user-uuid-123',
        isGlobal: false,
        name: 'My Config',
      });
      mockPrisma.userPersonalityConfig.count.mockResolvedValue(2);

      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:id');
      const { req, res } = createMockReqRes({}, { id: 'config-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('in use'),
        })
      );
    });

    it('should delete owned config', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue({
        id: 'config-123',
        ownerId: 'user-uuid-123',
        isGlobal: false,
        name: 'My Config',
      });
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
});
