/**
 * Tests for /user/llm-config routes
 *
 * Comprehensive tests for CRUD operations on user LLM configs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Hoisted mocks for resolvers so they're available before module loading
const { mockResolveOverrides, mockResolveConfig } = vi.hoisted(() => ({
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
      maxMessages: 'hardcoded' as const,
      maxAge: 'hardcoded' as const,
      maxImages: 'hardcoded' as const,
      memoryScoreThreshold: 'hardcoded' as const,
      memoryLimit: 'hardcoded' as const,
      focusModeEnabled: 'hardcoded' as const,
      crossChannelHistoryEnabled: 'hardcoded' as const,
      shareLtmAcrossPersonalities: 'hardcoded' as const,
      showModelFooter: 'hardcoded' as const,
    },
  }),
  mockResolveConfig: vi.fn().mockResolvedValue({
    config: { id: 'config-1', model: 'gpt-4', name: 'Default' },
    source: 'personality-default',
    resolvedModel: 'gpt-4',
  }),
}));

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

vi.mock('@tzurot/common-types/utils/ownerMiddleware', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/ownerMiddleware')>(
    '@tzurot/common-types/utils/ownerMiddleware'
  );
  return {
    ...actual,
    isBotOwner: vi.fn(() => false),
  };
});

vi.mock('@tzurot/common-types/utils/permissions', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/permissions')>(
    '@tzurot/common-types/utils/permissions'
  );
  return {
    ...actual,
    computeLlmConfigPermissions: vi.fn(
      (config: { ownerId: string }, requestingUserId: string | null) => {
        const isOwner = requestingUserId !== null && config.ownerId === requestingUserId;
        return { canEdit: isOwner, canDelete: isOwner };
      }
    ),
  };
});

vi.mock('@tzurot/config-resolver', () => ({
  // Explicit mock for resolvers used in resolve handler
  LlmConfigResolver: class {
    resolveConfig = mockResolveConfig;
    stopCleanup = vi.fn();
    clearCache = vi.fn();
  },
  ConfigCascadeResolver: class {
    resolveOverrides = mockResolveOverrides;
    stopCleanup = vi.fn();
    clearCache = vi.fn();
  },
}));

// Uses the shared mock at `src/services/__mocks__/AuthMiddleware.ts`
// (auto-discovered by vitest). Passes `getOrCreateUserService` through to
// the real implementation and stubs `requireUserAuth` / `requireProvisionedUser`
// as passthrough middleware.
vi.mock('../../services/AuthMiddleware.js');

vi.mock('../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

// Mock validateLlmConfigModelFields so tests can force early-return on
// invalid-model paths without orchestrating full model cache + Zod responses.
const { mockValidateLlmConfigModelFields } = vi.hoisted(() => ({
  mockValidateLlmConfigModelFields: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../utils/llmConfigValidation.js', () => ({
  validateLlmConfigModelFields: mockValidateLlmConfigModelFields,
}));

// Mock Prisma with UserService dependencies
const mockPrisma = {
  user: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
  },
  persona: {
    create: vi.fn().mockResolvedValue({ id: 'test-persona-uuid' }),
  },
  adminSettings: {
    findUnique: vi.fn().mockResolvedValue(null),
    // list() derives default flags from the pointers via findFirst (no pointers set here).
    findFirst: vi.fn().mockResolvedValue(null),
  },
  personality: {
    findUnique: vi.fn().mockResolvedValue(null),
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
  userApiKey: {
    findFirst: vi.fn(),
  },
  $executeRaw: vi.fn().mockResolvedValue(1),
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

const mockDeps = {
  prisma: mockPrisma as unknown as PrismaClient,
  cascadeResolver: { resolveOverrides: mockResolveOverrides },
  llmConfigResolver: { resolveConfig: mockResolveConfig },
} as unknown as import('../routeDeps.js').RouteDeps;

// Mock cache invalidation service (partial mock)
const mockCacheInvalidation = {
  invalidateUserLlmConfig: vi.fn().mockResolvedValue(undefined),
  invalidateAll: vi.fn().mockResolvedValue(undefined),
} as unknown as import('@tzurot/cache-invalidation').LlmConfigCacheInvalidationService;

import { createLlmConfigRoutes } from './llm-config.js';
import { getRouteHandler, findRoute } from '../../test/expressRouterUtils.js';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { computeLlmConfigPermissions } from '@tzurot/common-types/utils/permissions';

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
    // Default: no z.ai-coding key (the common case). z.ai-specific tests
    // override this to return a row.
    mockPrisma.userApiKey.findFirst.mockResolvedValue(null);
  });

  describe('route factory', () => {
    it('should create a router', () => {
      const router = createLlmConfigRoutes(mockDeps);

      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });

    it('should have GET / route registered', () => {
      const router = createLlmConfigRoutes(mockDeps);

      expect(router.stack).toBeDefined();
      expect(router.stack.length).toBeGreaterThan(0);

      expect(findRoute(router, 'get', '/')).toBeDefined();
    });

    it('should have GET /:id route registered', () => {
      const router = createLlmConfigRoutes(mockDeps);

      expect(findRoute(router, 'get', '/:id')).toBeDefined();
    });

    it('should have POST route registered', () => {
      const router = createLlmConfigRoutes(mockDeps);

      expect(findRoute(router, 'post', '/')).toBeDefined();
    });

    it('should have PUT /:id route registered', () => {
      const router = createLlmConfigRoutes(mockDeps);

      expect(findRoute(router, 'put', '/:id')).toBeDefined();
    });

    it('should have DELETE route registered', () => {
      const router = createLlmConfigRoutes(mockDeps);

      expect(findRoute(router, 'delete', '/:id')).toBeDefined();
    });
  });

  describe('GET /user/llm-config', () => {
    it('should return global configs', async () => {
      const globalConfig = {
        id: 'config-1',
        name: 'Default',
        description: 'Default config',
        model: 'gpt-4',
        provider: 'openrouter',
        isGlobal: true,
        isDefault: true,
      };
      mockPrisma.llmConfig.findMany.mockResolvedValueOnce([globalConfig]).mockResolvedValueOnce([]);

      const router = createLlmConfigRoutes(mockDeps);
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
        model: 'claude-3',
        provider: 'openrouter',
        isGlobal: false,
        isDefault: false,
        ownerId: 'user-uuid-123', // Match user.id from beforeEach
      };
      mockPrisma.llmConfig.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([userConfig]);

      const router = createLlmConfigRoutes(mockDeps);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          configs: [expect.objectContaining({ id: 'user-config-1', isOwned: true })],
        })
      );
    });

    it('scopes the list query to ?kind=vision', async () => {
      mockPrisma.llmConfig.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const router = createLlmConfigRoutes(mockDeps);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes({}, {}, { kind: 'vision' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      // User scope fires TWO queries (global + own). Assert BOTH carry the kind
      // — `toHaveBeenCalledWith` alone would pass if only one did.
      expect(mockPrisma.llmConfig.findMany).toHaveBeenCalledTimes(2);
      expect(mockPrisma.llmConfig.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ where: expect.objectContaining({ kind: 'vision' }) })
      );
      expect(mockPrisma.llmConfig.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ where: expect.objectContaining({ kind: 'vision' }) })
      );
    });

    it('rejects an invalid ?kind= with 400', async () => {
      const router = createLlmConfigRoutes(mockDeps);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes({}, {}, { kind: 'audio' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockPrisma.llmConfig.findMany).not.toHaveBeenCalled();
    });

    it('enriches each list row with supportsVision from the model capabilities', async () => {
      const visionConfig = {
        id: 'vc-1',
        name: 'Vision Cap',
        description: null,
        model: 'openai/gpt-4o',
        provider: 'openrouter',
        kind: 'text',
        isGlobal: true,
        isDefault: false,
        isFreeDefault: false,
        ownerId: 'admin-uuid',
      };
      const textConfig = {
        id: 'tc-1',
        name: 'Text Only',
        description: null,
        model: 'z-ai/glm-4.7', // not on OpenRouter → z.ai catalog (text-only)
        provider: 'openrouter',
        kind: 'text',
        isGlobal: true,
        isDefault: false,
        isFreeDefault: false,
        ownerId: 'admin-uuid',
      };
      mockPrisma.llmConfig.findMany
        .mockResolvedValueOnce([visionConfig, textConfig])
        .mockResolvedValueOnce([]);
      // gpt-4o resolves vision-capable via OpenRouter; glm-4.7 misses OpenRouter
      // and resolves text-only from the z.ai catalog → supportsVision false.
      const modelCache = {
        getModelById: vi.fn(async (id: string) =>
          id === 'openai/gpt-4o'
            ? {
                supportsVision: true,
                supportsImageGeneration: false,
                supportsAudioInput: false,
                supportsAudioOutput: false,
                contextLength: 128_000,
              }
            : null
        ),
      } as unknown as import('../../services/OpenRouterModelCache.js').OpenRouterModelCache;

      const router = createLlmConfigRoutes({
        ...mockDeps,
        modelCache,
      });
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      // Order-agnostic: this test asserts supportsVision ENRICHMENT, not list
      // ordering (the defaults-first/name sort is covered in LlmConfigService.test.ts).
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          configs: expect.arrayContaining([
            expect.objectContaining({ id: 'vc-1', supportsVision: true }),
            expect.objectContaining({ id: 'tc-1', supportsVision: false }),
          ]),
        })
      );
    });
  });

  describe('GET /user/llm-config/:id', () => {
    it('should return 404 when config not found', async () => {
      mockPrisma.llmConfig.findUnique.mockResolvedValue(null);

      const router = createLlmConfigRoutes(mockDeps);
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
        model: 'claude-3',
        provider: 'openrouter',
        isGlobal: false,
        isDefault: false,
        ownerId: 'user-uuid-123',
        advancedParameters: { temperature: 0.7 },
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });

      const router = createLlmConfigRoutes(mockDeps);
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

    it('should set requiresZaiKey=true for a z.ai-only model viewed without a key', async () => {
      // Global z.ai-only preset (glm-5.2, absent from OpenRouter) viewed by a user
      // with no z.ai-coding key → the dashboard should badge it.
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        name: 'GLM Global',
        description: null,
        model: 'z-ai/glm-5.2',
        provider: 'openrouter',
        isGlobal: true,
        isDefault: false,
        ownerId: 'someone-else',
        advancedParameters: null,
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });
      mockPrisma.userApiKey.findFirst.mockResolvedValue(null); // no z.ai-coding key
      const modelCache = {
        getModelById: vi.fn().mockResolvedValue(null), // glm-5.2 not on OpenRouter
      } as unknown as import('../../services/OpenRouterModelCache.js').OpenRouterModelCache;

      const router = createLlmConfigRoutes({
        ...mockDeps,
        modelCache,
      });
      const handler = getHandler(router, 'get', '/:id');
      const { req, res } = createMockReqRes({}, { id: 'config-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ requiresZaiKey: true }),
        })
      );
    });

    it('should set requiresZaiKey=false when the viewer has a z.ai-coding key', async () => {
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        name: 'GLM Global',
        description: null,
        model: 'z-ai/glm-5.2',
        provider: 'openrouter',
        isGlobal: true,
        isDefault: false,
        ownerId: 'someone-else',
        advancedParameters: null,
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });
      mockPrisma.userApiKey.findFirst.mockResolvedValue({ id: 'zai-key-1' }); // has key
      const modelCache = {
        getModelById: vi.fn().mockResolvedValue(null),
      } as unknown as import('../../services/OpenRouterModelCache.js').OpenRouterModelCache;

      const router = createLlmConfigRoutes({
        ...mockDeps,
        modelCache,
      });
      const handler = getHandler(router, 'get', '/:id');
      const { req, res } = createMockReqRes({}, { id: 'config-123' });

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ requiresZaiKey: false }),
        })
      );
    });

    it('should return config with isOwned=false for other user global config', async () => {
      // Global config owned by another user - still visible but not owned
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        name: 'Global Config',
        description: 'Shared preset',
        model: 'gpt-4',
        provider: 'openrouter',
        isGlobal: true,
        isDefault: true,
        ownerId: 'other-user-uuid', // Different user owns this
        advancedParameters: null,
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });

      const router = createLlmConfigRoutes(mockDeps);
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
    it('should return 400 when model validation fails on create', async () => {
      // Mock req/res approach — no real HTTP client, so returning `false` without
      // calling res.status()/res.json() is safe. Contrast with admin/llm-config.test.ts
      // which uses supertest and must have the mock write the error response to res
      // (otherwise supertest hangs waiting for a response that never comes).
      mockValidateLlmConfigModelFields.mockResolvedValueOnce(false);

      const router = createLlmConfigRoutes(mockDeps);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({ name: 'My Config', model: 'bad-model' });

      await handler(req, res);

      // The mock returned false; route should have bailed before creating anything
      expect(mockValidateLlmConfigModelFields).toHaveBeenCalled();
      expect(mockPrisma.llmConfig.create).not.toHaveBeenCalled();
    });

    it('should reject missing name', async () => {
      const router = createLlmConfigRoutes(mockDeps);
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
      const router = createLlmConfigRoutes(mockDeps);
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
      const router = createLlmConfigRoutes(mockDeps);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        name: 'a'.repeat(101),
        model: 'gpt-4',
        provider: 'openrouter',
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

      const router = createLlmConfigRoutes(mockDeps);
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
        model: 'gpt-4',
        provider: 'openrouter',
        isGlobal: false,
        isDefault: false,
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });

      const router = createLlmConfigRoutes(mockDeps);
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

    it('should save a z.ai-only model (z-ai/glm-5.2) when the user has a z.ai-coding key', async () => {
      // End-to-end route wiring: resolveProvisionedUserId → userHasActiveApiKey
      // (returns a key) → validation takes the z.ai catalog path, so glm-5.2
      // (absent from OpenRouter) saves instead of being rejected. No model
      // cache is wired, proving validation succeeds from the catalog alone.
      mockPrisma.userApiKey.findFirst.mockResolvedValue({ id: 'zai-key-1' });
      mockPrisma.llmConfig.create.mockResolvedValue({
        id: 'new-config',
        name: 'GLM Config',
        description: null,
        model: 'z-ai/glm-5.2',
        provider: 'openrouter',
        isGlobal: false,
        isDefault: false,
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });

      const router = createLlmConfigRoutes(mockDeps);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({ name: 'GLM Config', model: 'z-ai/glm-5.2' });

      await handler(req, res);

      expect(mockPrisma.userApiKey.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ provider: 'zai-coding', isActive: true }),
        })
      );
      expect(mockPrisma.llmConfig.create).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('should set requiresZaiKey=true in the create response for a z.ai-only model with no key', async () => {
      // Guards the requiresZaiKey field against being dropped from the CREATE
      // response spread. No z.ai key + z.ai-only model + OpenRouter cache miss
      // → badge applies.
      mockPrisma.userApiKey.findFirst.mockResolvedValue(null);
      mockPrisma.llmConfig.create.mockResolvedValue({
        id: 'new-config',
        name: 'GLM Config',
        description: null,
        model: 'z-ai/glm-5.2',
        provider: 'openrouter',
        isGlobal: false,
        isDefault: false,
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });
      const modelCache = {
        getModelById: vi.fn().mockResolvedValue(null),
      } as unknown as import('../../services/OpenRouterModelCache.js').OpenRouterModelCache;

      const router = createLlmConfigRoutes({
        ...mockDeps,
        modelCache,
      });
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({ name: 'GLM Config', model: 'z-ai/glm-5.2' });

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ requiresZaiKey: true }),
        })
      );
    });

    it('should create config with advancedParameters', async () => {
      mockPrisma.llmConfig.create.mockResolvedValue({
        id: 'new-config',
        name: 'My Config',
        description: null,
        model: 'gpt-4',
        provider: 'openrouter',
        isGlobal: false,
        isDefault: false,
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });

      const router = createLlmConfigRoutes(mockDeps);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        name: 'My Config',
        model: 'gpt-4',
        provider: 'openrouter',
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

    it('should create config with memory settings (parity)', async () => {
      // This test verifies parity - user routes must accept same fields as admin
      mockPrisma.llmConfig.create.mockResolvedValue({
        id: 'new-config',
        name: 'Memory Config',
        description: null,
        model: 'gpt-4',
        provider: 'openrouter',
        isGlobal: false,
        isDefault: false,
        memoryScoreThreshold: { toNumber: () => 0.75 },
        memoryLimit: 50,
        contextWindowTokens: 100000,
      });

      const router = createLlmConfigRoutes(mockDeps);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        name: 'Memory Config',
        model: 'gpt-4',
        provider: 'openrouter',
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
  });

  describe('PUT /user/llm-config/:id', () => {
    it('should return 400 when model validation fails on update', async () => {
      mockValidateLlmConfigModelFields.mockResolvedValueOnce(false);

      const router = createLlmConfigRoutes({
        ...mockDeps,
        llmConfigCacheInvalidation: mockCacheInvalidation,
      });
      const handler = getHandler(router, 'put', '/:id');
      const { req, res } = createMockReqRes(
        { contextWindowTokens: 999999999 },
        { id: 'config-123' }
      );

      await handler(req, res);

      expect(mockValidateLlmConfigModelFields).toHaveBeenCalled();
      expect(mockPrisma.llmConfig.update).not.toHaveBeenCalled();
    });

    it('should return 404 when config not found', async () => {
      mockPrisma.llmConfig.findUnique.mockResolvedValue(null);

      const router = createLlmConfigRoutes({
        ...mockDeps,
        llmConfigCacheInvalidation: mockCacheInvalidation,
      });
      const handler = getHandler(router, 'put', '/:id');
      const { req, res } = createMockReqRes({ name: 'New Name' }, { id: 'config-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    // Bot-owner short-circuit is exercised at the helper level in
    // `normalizeConfigNameOnPromote.test.ts` (which mocks isBotOwner directly).
    // Mocking `isBotOwner` at the route level would require deep internals
    // (the package's `slugUtils.ts` calls a relative-path `isBotOwner`, not
    // the public export), so the route test focuses on the non-owner path
    // and trusts the helper unit tests for the bot-owner path.
    it('suffixes the name with username when non-owner promotes to global', async () => {
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        ownerId: 'user-uuid-123',
        isGlobal: false,
        name: 'AdminVoice',
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });
      // Existing-name check: the post-normalization name doesn't collide
      mockPrisma.llmConfig.findFirst.mockResolvedValue(null);
      mockPrisma.llmConfig.update.mockResolvedValue({
        id: 'config-123',
        name: 'AdminVoice-bob',
        description: null,
        model: 'test-model',
        provider: 'openrouter',
        isGlobal: true,
        isDefault: false,
        ownerId: 'user-uuid-123',
        advancedParameters: {},
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });

      const router = createLlmConfigRoutes({
        ...mockDeps,
        llmConfigCacheInvalidation: mockCacheInvalidation,
      });
      const handler = getHandler(router, 'put', '/:id');
      const req = {
        body: { isGlobal: true },
        params: { id: 'config-123' },
        userId: 'discord-user-123',
        provisionedUserId: 'user-uuid-123',
        provisionedDefaultPersonaId: 'persona-uuid-default',
        headers: { 'x-user-username': 'bob' },
      } as unknown as Request & { userId: string };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      } as unknown as Response;

      await handler(req, res);

      // The update call should have name: 'AdminVoice-bob' even though body had no name
      expect(mockPrisma.llmConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'config-123' },
          data: expect.objectContaining({ name: 'AdminVoice-bob', isGlobal: true }),
        })
      );
    });

    it('should allow owner to edit own global config', async () => {
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        ownerId: 'user-uuid-123',
        isGlobal: true,
        name: 'My Global Config',
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });
      mockPrisma.llmConfig.update.mockResolvedValue({
        id: 'config-123',
        name: 'Updated Global Config',
        description: null,
        model: 'test-model',
        provider: 'openrouter',
        isGlobal: true,
        isDefault: false,
        ownerId: 'user-uuid-123',
        advancedParameters: {},
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });

      const router = createLlmConfigRoutes({
        ...mockDeps,
        llmConfigCacheInvalidation: mockCacheInvalidation,
      });
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
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });

      const router = createLlmConfigRoutes({
        ...mockDeps,
        llmConfigCacheInvalidation: mockCacheInvalidation,
      });
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
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });

      const router = createLlmConfigRoutes({
        ...mockDeps,
        llmConfigCacheInvalidation: mockCacheInvalidation,
      });
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
      const router = createLlmConfigRoutes({
        ...mockDeps,
        llmConfigCacheInvalidation: mockCacheInvalidation,
      });
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
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });
      mockPrisma.llmConfig.update.mockResolvedValue({
        id: 'config-123',
        name: 'New Name',
        description: 'Updated',
        model: 'claude-3',
        provider: 'openrouter',
        isGlobal: false,
        isDefault: false,
        isFreeDefault: false,
        ownerId: 'user-uuid-123',
        advancedParameters: { temperature: 0.9 },
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });

      const router = createLlmConfigRoutes({
        ...mockDeps,
        llmConfigCacheInvalidation: mockCacheInvalidation,
      });
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

    it('scopes the rename collision check to the config kind (vision)', async () => {
      // Renaming a vision config to a name that only exists as a TEXT config must
      // NOT collide — the collision check derives kind from the immutable row.
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'vision-cfg',
        ownerId: 'user-uuid-123',
        isGlobal: false,
        name: 'Old Vision',
        kind: 'vision',
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });
      // No collision in the VISION namespace.
      mockPrisma.llmConfig.findFirst.mockResolvedValue(null);
      mockPrisma.llmConfig.update.mockResolvedValue({
        id: 'vision-cfg',
        name: 'Shared Name',
        model: 'qwen/qwen3-vl-30b-a3b-instruct',
        provider: 'openrouter',
        isGlobal: false,
        isDefault: false,
        isFreeDefault: false,
        ownerId: 'user-uuid-123',
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });

      const router = createLlmConfigRoutes({
        ...mockDeps,
        llmConfigCacheInvalidation: mockCacheInvalidation,
      });
      const handler = getHandler(router, 'put', '/:id');
      const { req, res } = createMockReqRes({ name: 'Shared Name' }, { id: 'vision-cfg' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      // The collision query must be scoped to kind='vision', not text.
      expect(mockPrisma.llmConfig.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ kind: 'vision' }) })
      );
    });

    it('should wire the z.ai-coding key check into the update path', async () => {
      // Proves createUpdateHandler runs userHasActiveApiKey → hasZaiCodingKey →
      // validation (mirrors the create-path test). If that wiring were dropped,
      // userApiKey.findFirst would not be called and this fails — the regression
      // guard the reviewer asked for on the update handler specifically.
      mockPrisma.userApiKey.findFirst.mockResolvedValue({ id: 'zai-key-1' });
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        ownerId: 'user-uuid-123',
        isGlobal: false,
        name: 'My Config',
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });
      mockPrisma.llmConfig.update.mockResolvedValue({
        id: 'config-123',
        name: 'My Config',
        description: null,
        model: 'z-ai/glm-5.2',
        provider: 'openrouter',
        isGlobal: false,
        isDefault: false,
        isFreeDefault: false,
        ownerId: 'user-uuid-123',
        advancedParameters: null,
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });

      const router = createLlmConfigRoutes({
        ...mockDeps,
        llmConfigCacheInvalidation: mockCacheInvalidation,
      });
      const handler = getHandler(router, 'put', '/:id');
      const { req, res } = createMockReqRes({ model: 'z-ai/glm-5.2' }, { id: 'config-123' });

      await handler(req, res);

      expect(mockPrisma.userApiKey.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ provider: 'zai-coding', isActive: true }),
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should set requiresZaiKey=true in the update response for a z.ai-only model with no key', async () => {
      // Guards the requiresZaiKey field against being dropped from the UPDATE
      // response spread (companion to the create-path guard).
      mockPrisma.userApiKey.findFirst.mockResolvedValue(null);
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        ownerId: 'user-uuid-123',
        isGlobal: false,
        name: 'My Config',
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });
      mockPrisma.llmConfig.update.mockResolvedValue({
        id: 'config-123',
        name: 'My Config',
        description: null,
        model: 'z-ai/glm-5.2',
        provider: 'openrouter',
        isGlobal: false,
        isDefault: false,
        isFreeDefault: false,
        ownerId: 'user-uuid-123',
        advancedParameters: null,
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });
      const modelCache = {
        getModelById: vi.fn().mockResolvedValue(null),
      } as unknown as import('../../services/OpenRouterModelCache.js').OpenRouterModelCache;

      const router = createLlmConfigRoutes({
        ...mockDeps,
        llmConfigCacheInvalidation: mockCacheInvalidation,
        modelCache,
      });
      const handler = getHandler(router, 'put', '/:id');
      const { req, res } = createMockReqRes({ model: 'z-ai/glm-5.2' }, { id: 'config-123' });

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ requiresZaiKey: true }),
        })
      );
    });

    it('should reject an update whose new name collides in the owner namespace', async () => {
      // Covers buildUpdatePatchOrSendCollision's collision branch: the helper
      // sends a 400 and returns null, so the handler returns without updating.
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        ownerId: 'user-uuid-123',
        isGlobal: false,
        name: 'My Config',
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });
      mockPrisma.llmConfig.findFirst.mockResolvedValue({ id: 'other-existing' });

      const router = createLlmConfigRoutes({
        ...mockDeps,
        llmConfigCacheInvalidation: mockCacheInvalidation,
      });
      const handler = getHandler(router, 'put', '/:id');
      const { req, res } = createMockReqRes({ name: 'Taken Name' }, { id: 'config-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Taken Name'),
        })
      );
      expect(mockPrisma.llmConfig.update).not.toHaveBeenCalled();
    });

    it('should invalidate cache on update', async () => {
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        ownerId: 'user-uuid-123',
        isGlobal: false,
        name: 'My Config',
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });
      mockPrisma.llmConfig.update.mockResolvedValue({
        id: 'config-123',
        name: 'New Name',
        description: null,
        model: 'claude-3',
        provider: 'openrouter',
        isGlobal: false,
        isDefault: false,
        isFreeDefault: false,
        ownerId: 'user-uuid-123',
        advancedParameters: null,
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });

      const router = createLlmConfigRoutes({
        ...mockDeps,
        llmConfigCacheInvalidation: mockCacheInvalidation,
      });
      const handler = getHandler(router, 'put', '/:id');
      const { req, res } = createMockReqRes({ name: 'New Name' }, { id: 'config-123' });

      await handler(req, res);

      // Service uses invalidateAll for all cache operations
      expect(mockCacheInvalidation.invalidateAll).toHaveBeenCalled();
    });

    it('lets bot owner edit another user config (admin override)', async () => {
      vi.mocked(computeLlmConfigPermissions).mockReturnValueOnce({
        canEdit: true,
        canDelete: true,
      });
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        ownerId: 'other-user',
        isGlobal: false,
        name: 'Other User Config',
        model: 'old-model',
        provider: 'openrouter',
        advancedParameters: null,
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });
      mockPrisma.llmConfig.update.mockResolvedValue({
        id: 'config-123',
        name: 'Other User Config',
        description: null,
        model: 'claude-3',
        provider: 'openrouter',
        isGlobal: false,
        isDefault: false,
        isFreeDefault: false,
        ownerId: 'other-user',
        advancedParameters: null,
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });

      const router = createLlmConfigRoutes(mockDeps);
      const handler = getHandler(router, 'put', '/:id');
      const { req, res } = createMockReqRes({ model: 'claude-3' }, { id: 'config-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockPrisma.llmConfig.update).toHaveBeenCalled();
      const callArgs = vi.mocked(res.json).mock.calls[0]?.[0] as
        { config?: { isOwned?: boolean; ownerId?: string } } | undefined;
      // Response reflects that the requester does NOT own the edited config.
      expect(callArgs?.config?.isOwned).toBe(false);
    });

    it('bot-owner edit on non-owned config skips name-promotion suffixing', async () => {
      // The promotion helper would suffix renames with the requester's username.
      // For admin edits we apply the name as-is (the owner stays the original
      // owner; suffixing under the bot owner's name would mis-attribute provenance).
      vi.mocked(computeLlmConfigPermissions).mockReturnValueOnce({
        canEdit: true,
        canDelete: true,
      });
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        ownerId: 'other-user',
        isGlobal: true,
        name: 'Other User Config',
        model: 'claude-3',
        provider: 'openrouter',
        advancedParameters: null,
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });
      // Capture what name actually gets passed to the service.
      mockPrisma.llmConfig.findFirst.mockResolvedValue(null); // no name collision
      mockPrisma.llmConfig.update.mockResolvedValue({
        id: 'config-123',
        name: 'Renamed Verbatim',
        description: null,
        model: 'claude-3',
        provider: 'openrouter',
        isGlobal: true,
        isDefault: false,
        isFreeDefault: false,
        ownerId: 'other-user',
        advancedParameters: null,
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });

      const router = createLlmConfigRoutes(mockDeps);
      const handler = getHandler(router, 'put', '/:id');
      const { req, res } = createMockReqRes({ name: 'Renamed Verbatim' }, { id: 'config-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      // Name passed through unchanged — no suffix promotion.
      expect(mockPrisma.llmConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Renamed Verbatim' }),
        })
      );
    });

    it('regular user edit STILL rejects non-owned (no admin bypass for non-admins)', async () => {
      // isBotOwner default false. Guards against the override accidentally
      // widening to non-admin users.
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        ownerId: 'other-user',
        isGlobal: false,
        name: 'Other User Config',
        model: 'claude-3',
        provider: 'openrouter',
        advancedParameters: null,
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });

      const router = createLlmConfigRoutes(mockDeps);
      const handler = getHandler(router, 'put', '/:id');
      const { req, res } = createMockReqRes({ model: 'new-model' }, { id: 'config-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockPrisma.llmConfig.update).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /user/llm-config/:id', () => {
    it('should return 404 when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const router = createLlmConfigRoutes(mockDeps);
      const handler = getHandler(router, 'delete', '/:id');
      const { req, res } = createMockReqRes({}, { id: 'config-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 404 when config not found', async () => {
      // Service uses findUnique for getById
      mockPrisma.llmConfig.findUnique.mockResolvedValue(null);

      const router = createLlmConfigRoutes(mockDeps);
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
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });
      // Service's checkDeleteConstraints checks both counts
      mockPrisma.personalityDefaultConfig.count.mockResolvedValue(0);
      mockPrisma.userPersonalityConfig.count.mockResolvedValue(0);
      mockPrisma.llmConfig.delete.mockResolvedValue({} as unknown);

      const router = createLlmConfigRoutes(mockDeps);
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
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });

      const router = createLlmConfigRoutes(mockDeps);
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
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });
      // Service's checkDeleteConstraints checks both counts
      mockPrisma.personalityDefaultConfig.count.mockResolvedValue(0);
      mockPrisma.userPersonalityConfig.count.mockResolvedValue(2);

      const router = createLlmConfigRoutes(mockDeps);
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
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });
      // Service's checkDeleteConstraints checks both counts
      mockPrisma.personalityDefaultConfig.count.mockResolvedValue(0);
      mockPrisma.userPersonalityConfig.count.mockResolvedValue(0);

      const router = createLlmConfigRoutes(mockDeps);
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

    it('drops warning from response even when service returns one', async () => {
      // User route deliberately ignores `warning` because it would leak how
      // many OTHER users have this config as their default — info only the
      // owner-admin should see. Pin this with a test so the decision is
      // machine-checkable rather than comment-only.
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        ownerId: 'user-uuid-123',
        isGlobal: false,
        name: 'My Config',
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });
      mockPrisma.personalityDefaultConfig.count.mockResolvedValue(0);
      mockPrisma.userPersonalityConfig.count.mockResolvedValue(0);
      // Force the service to return a non-null warning via the underlying user.count.
      mockPrisma.user.count.mockResolvedValueOnce(5);

      const router = createLlmConfigRoutes(mockDeps);
      const handler = getHandler(router, 'delete', '/:id');
      const { req, res } = createMockReqRes({}, { id: 'config-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const callArgs = vi.mocked(res.json).mock.calls[0]?.[0] as
        Record<string, unknown> | undefined;
      expect(callArgs?.deleted).toBe(true);
      expect(callArgs?.warning).toBeUndefined();
    });

    it('lets bot owner delete another user config (admin override)', async () => {
      vi.mocked(computeLlmConfigPermissions).mockReturnValueOnce({
        canEdit: true,
        canDelete: true,
      });
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        ownerId: 'other-user',
        isGlobal: false,
        name: 'Other User Config',
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });
      mockPrisma.personalityDefaultConfig.count.mockResolvedValue(0);
      mockPrisma.userPersonalityConfig.count.mockResolvedValue(0);

      const router = createLlmConfigRoutes(mockDeps);
      const handler = getHandler(router, 'delete', '/:id');
      const { req, res } = createMockReqRes({}, { id: 'config-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockPrisma.llmConfig.delete).toHaveBeenCalledWith({ where: { id: 'config-123' } });
    });

    it('lets bot owner bypass the "in use" blocker via FK cascade (admin override)', async () => {
      vi.mocked(computeLlmConfigPermissions).mockReturnValueOnce({
        canEdit: true,
        canDelete: true,
      });
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        ownerId: 'other-user',
        isGlobal: false,
        name: 'Other User Config',
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });
      // Service's checkDeleteConstraints would normally block on N user overrides.
      mockPrisma.personalityDefaultConfig.count.mockResolvedValue(0);
      mockPrisma.userPersonalityConfig.count.mockResolvedValue(7);

      const router = createLlmConfigRoutes(mockDeps);
      const handler = getHandler(router, 'delete', '/:id');
      const { req, res } = createMockReqRes({}, { id: 'config-123' });

      await handler(req, res);

      // Bypassed: delete still happens; FK cascade handles cleanup.
      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockPrisma.llmConfig.delete).toHaveBeenCalledWith({ where: { id: 'config-123' } });
    });

    it('regular owner-driven delete STILL respects the "in use" blocker (no admin bypass for non-admins)', async () => {
      // isBotOwner mock stays false (default). This guards against the bypass
      // accidentally widening to the owner-driven path.
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        ownerId: 'user-uuid-123',
        isGlobal: false,
        name: 'My Config',
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });
      mockPrisma.personalityDefaultConfig.count.mockResolvedValue(0);
      mockPrisma.userPersonalityConfig.count.mockResolvedValue(2);

      const router = createLlmConfigRoutes(mockDeps);
      const handler = getHandler(router, 'delete', '/:id');
      const { req, res } = createMockReqRes({}, { id: 'config-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockPrisma.llmConfig.delete).not.toHaveBeenCalled();
    });
  });

  describe('model context enrichment', () => {
    const mockModelCache = {
      getModelById: vi.fn(),
    } as unknown as import('../../services/OpenRouterModelCache.js').OpenRouterModelCache;

    beforeEach(() => {
      vi.mocked(
        (mockModelCache as unknown as { getModelById: ReturnType<typeof vi.fn> }).getModelById
      ).mockResolvedValue({
        id: 'anthropic/claude-sonnet-4',
        name: 'Claude Sonnet 4',
        contextLength: 200000,
        supportsVision: true,
        supportsImageGeneration: false,
        supportsAudioInput: false,
        supportsAudioOutput: false,
        promptPricePerMillion: 3,
        completionPricePerMillion: 15,
      });
    });

    it('should enrich GET /:id response with model context info', async () => {
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        name: 'My Config',
        description: null,
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
        isGlobal: false,
        isDefault: false,
        isFreeDefault: false,
        ownerId: 'user-uuid-123',
        advancedParameters: null,
        contextWindowTokens: 65000,
        maxMessages: 50,
        maxAge: null,
        maxImages: 10,
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });

      const router = createLlmConfigRoutes({
        ...mockDeps,
        llmConfigCacheInvalidation: mockCacheInvalidation,
        modelCache: mockModelCache,
      });
      const handler = getHandler(router, 'get', '/:id');
      const { req, res } = createMockReqRes({}, { id: 'config-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            modelContextLength: 200000,
            contextWindowCap: 100000,
          }),
        })
      );
    });

    it('should enrich POST response with model context info', async () => {
      mockPrisma.llmConfig.create.mockResolvedValue({
        id: 'new-config',
        name: 'New Config',
        description: null,
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
        isGlobal: false,
        isDefault: false,
        isFreeDefault: false,
        contextWindowTokens: 65000,
        maxMessages: 50,
        maxAge: null,
        maxImages: 10,
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
        advancedParameters: null,
      });

      const router = createLlmConfigRoutes({
        ...mockDeps,
        llmConfigCacheInvalidation: mockCacheInvalidation,
        modelCache: mockModelCache,
      });
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        name: 'New Config',
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            modelContextLength: 200000,
            contextWindowCap: 100000,
          }),
        })
      );
    });

    it('should enrich PUT response with model context info', async () => {
      mockPrisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-123',
        ownerId: 'user-uuid-123',
        isGlobal: false,
        name: 'My Config',
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
      });
      mockPrisma.llmConfig.update.mockResolvedValue({
        id: 'config-123',
        name: 'Updated Config',
        description: null,
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
        isGlobal: false,
        isDefault: false,
        isFreeDefault: false,
        ownerId: 'user-uuid-123',
        contextWindowTokens: 65000,
        maxMessages: 50,
        maxAge: null,
        maxImages: 10,
        memoryScoreThreshold: { toNumber: () => 0.5 },
        memoryLimit: 20,
        advancedParameters: null,
      });

      const router = createLlmConfigRoutes({
        ...mockDeps,
        llmConfigCacheInvalidation: mockCacheInvalidation,
        modelCache: mockModelCache,
      });
      const handler = getHandler(router, 'put', '/:id');
      const { req, res } = createMockReqRes({ name: 'Updated Config' }, { id: 'config-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            modelContextLength: 200000,
            contextWindowCap: 100000,
          }),
        })
      );
    });
  });

  describe('POST /user/llm-config/resolve', () => {
    it('should reject missing personalityId', async () => {
      const router = createLlmConfigRoutes(mockDeps);
      const handler = getHandler(router, 'post', '/resolve');
      const { req, res } = createMockReqRes({
        personalityConfig: { id: 'p-1', name: 'Test', model: 'gpt-4' },
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject missing personalityConfig', async () => {
      const router = createLlmConfigRoutes(mockDeps);
      const handler = getHandler(router, 'post', '/resolve');
      const { req, res } = createMockReqRes({
        personalityId: 'personality-123',
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject invalid personalityConfig structure', async () => {
      const router = createLlmConfigRoutes(mockDeps);
      const handler = getHandler(router, 'post', '/resolve');
      const { req, res } = createMockReqRes({
        personalityId: 'personality-123',
        personalityConfig: { invalid: true }, // Missing required fields
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should resolve config and include overrides in response', async () => {
      const router = createLlmConfigRoutes(mockDeps);
      const handler = getHandler(router, 'post', '/resolve');
      const { req, res } = createMockReqRes({
        personalityId: 'personality-123',
        personalityConfig: { id: 'p-1', name: 'Test', model: 'gpt-4' },
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const responseBody = vi.mocked(res.json).mock.calls[0]?.[0] as Record<string, unknown>;
      expect(responseBody).toHaveProperty('overrides');
      expect(responseBody.overrides).toEqual(
        expect.objectContaining({
          maxMessages: 50,
          maxAge: null,
          maxImages: 10,
          focusModeEnabled: false,
          sources: expect.objectContaining({
            maxMessages: 'hardcoded',
            maxAge: 'hardcoded',
          }),
        })
      );
    });

    it('should pass channelId to cascade resolver when provided', async () => {
      const router = createLlmConfigRoutes(mockDeps);
      const handler = getHandler(router, 'post', '/resolve');
      const { req, res } = createMockReqRes({
        personalityId: 'personality-123',
        personalityConfig: { id: 'p-1', name: 'Test', model: 'gpt-4' },
        channelId: '999888777666555444',
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockResolveOverrides).toHaveBeenCalledWith(
        'discord-user-123',
        'personality-123',
        '999888777666555444'
      );
    });

    it('should reject invalid channelId format', async () => {
      const router = createLlmConfigRoutes(mockDeps);
      const handler = getHandler(router, 'post', '/resolve');
      const { req, res } = createMockReqRes({
        personalityId: 'personality-123',
        personalityConfig: { id: 'p-1', name: 'Test', model: 'gpt-4' },
        channelId: 'not-a-snowflake',
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 500 when resolver throws', async () => {
      mockResolveConfig.mockRejectedValueOnce(new Error('DB error'));
      const router = createLlmConfigRoutes(mockDeps);
      const handler = getHandler(router, 'post', '/resolve');
      const { req, res } = createMockReqRes({
        personalityId: 'personality-123',
        personalityConfig: { id: 'p-1', name: 'Test', model: 'gpt-4' },
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
