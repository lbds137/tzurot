/**
 * Admin LLM Config Routes Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createAdminLlmConfigRoutes } from './llm-config.js';
import type { PrismaClient, LlmConfigCacheInvalidationService } from '@tzurot/common-types';

// Mock the admin auth middleware
vi.mock('../../services/AuthMiddleware.js', () => ({
  requireOwnerAuth: () => (req: { userId?: string }, _res: unknown, next: () => void) => {
    req.userId = 'admin-discord-id'; // Set admin user ID
    next();
  },
}));

const createMockCacheInvalidationService = () => ({
  invalidateAll: vi.fn().mockResolvedValue(undefined),
  invalidateUserLlmConfig: vi.fn().mockResolvedValue(undefined),
  invalidateConfigUsers: vi.fn().mockResolvedValue(undefined),
});

const createMockPrismaClient = () => {
  const mockLlmConfig = {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  };

  const mockPersonalityDefaultConfig = {
    count: vi.fn(),
  };

  const mockUserPersonalityConfig = {
    count: vi.fn(),
  };

  const mockUser = {
    findUnique: vi.fn(),
  };

  return {
    llmConfig: mockLlmConfig,
    personalityDefaultConfig: mockPersonalityDefaultConfig,
    userPersonalityConfig: mockUserPersonalityConfig,
    user: mockUser,
    // Transaction mock - executes callback with all mock objects and returns result
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      // Provide all models that might be used in transactions
      const txMock = {
        llmConfig: mockLlmConfig,
        personalityDefaultConfig: mockPersonalityDefaultConfig,
        userPersonalityConfig: mockUserPersonalityConfig,
      };
      return callback(txMock);
    }),
  };
};

describe('Admin LLM Config Routes', () => {
  let app: Express;
  let prisma: ReturnType<typeof createMockPrismaClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrismaClient();

    // Default: admin user exists (required for ownerId)
    prisma.user.findUnique.mockResolvedValue({ id: 'admin-user-id' });

    app = express();
    app.use(express.json());
    app.use('/admin/llm-config', createAdminLlmConfigRoutes(prisma as unknown as PrismaClient));
  });

  describe('GET /admin/llm-config', () => {
    it('should list all LLM configs', async () => {
      prisma.llmConfig.findMany.mockResolvedValue([
        {
          id: 'config-1',
          name: 'Default Config',
          model: 'anthropic/claude-sonnet-4',
          isGlobal: true,
          isDefault: true,
          ownerId: 'admin-user-id',
          owner: { discordId: 'admin-discord-id', username: 'admin' },
        },
        {
          id: 'config-2',
          name: 'User Config',
          model: 'google/gemini-2.0-flash',
          isGlobal: false,
          isDefault: false,
          ownerId: 'user-id',
          owner: { discordId: '12345', username: 'testuser' },
        },
      ]);

      const response = await request(app).get('/admin/llm-config');

      expect(response.status).toBe(200);
      expect(response.body.configs).toHaveLength(2);
      expect(response.body.configs[0].name).toBe('Default Config');
      expect(response.body.configs[1].ownerInfo).toEqual({
        discordId: '12345',
        username: 'testuser',
      });
    });
  });

  describe('GET /admin/llm-config/:id', () => {
    it('should return a single global config', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-1',
        name: 'Default Config',
        description: 'System default',
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4',
        visionModel: null,
        isGlobal: true,
        isDefault: true,
        isFreeDefault: false,
        maxReferencedMessages: 10,
        advancedParameters: { temperature: 0.7 },
        maxMessages: 50,
        maxAge: null,
        maxImages: 10,
      });

      const response = await request(app).get('/admin/llm-config/config-1');

      expect(response.status).toBe(200);
      expect(response.body.config.id).toBe('config-1');
      expect(response.body.config.name).toBe('Default Config');
      expect(response.body.config.isGlobal).toBe(true);
      expect(response.body.config.params).toEqual({ temperature: 0.7 });
    });

    it('should return context settings (maxMessages, maxAge, maxImages)', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-1',
        name: 'Config with context',
        description: null,
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4',
        visionModel: null,
        isGlobal: true,
        isDefault: false,
        isFreeDefault: false,
        maxReferencedMessages: 10,
        advancedParameters: null,
        // Context settings
        maxMessages: 30,
        maxAge: 86400,
        maxImages: 5,
      });

      const response = await request(app).get('/admin/llm-config/config-1');

      expect(response.status).toBe(200);
      expect(response.body.config.maxMessages).toBe(30);
      expect(response.body.config.maxAge).toBe(86400);
      expect(response.body.config.maxImages).toBe(5);
    });

    it('should return 404 when config not found', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue(null);

      const response = await request(app).get('/admin/llm-config/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body.message).toMatch(/not found/i);
    });

    it('should allow viewing non-global configs (admin access)', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-1',
        name: 'User Config',
        description: null,
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4',
        visionModel: null,
        isGlobal: false,
        isDefault: false,
        isFreeDefault: false,
        maxReferencedMessages: 10,
        advancedParameters: null,
      });

      const response = await request(app).get('/admin/llm-config/config-1');

      // Admin endpoint allows viewing any config
      expect(response.status).toBe(200);
      expect(response.body.config.name).toBe('User Config');
      expect(response.body.config.isGlobal).toBe(false);
    });

    it('should parse advancedParameters correctly', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-1',
        name: 'Config with params',
        description: null,
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4',
        visionModel: 'anthropic/claude-sonnet-4',
        isGlobal: true,
        isDefault: false,
        isFreeDefault: false,
        maxReferencedMessages: 15,
        advancedParameters: {
          temperature: 0.8,
          top_p: 0.95,
          reasoning: { effort: 'high', max_tokens: 8000 },
        },
      });

      const response = await request(app).get('/admin/llm-config/config-1');

      expect(response.status).toBe(200);
      expect(response.body.config.params.temperature).toBe(0.8);
      expect(response.body.config.params.top_p).toBe(0.95);
      expect(response.body.config.params.reasoning).toEqual({
        effort: 'high',
        max_tokens: 8000,
      });
    });

    it('should handle null advancedParameters', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-1',
        name: 'Config without params',
        description: null,
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4',
        visionModel: null,
        isGlobal: true,
        isDefault: false,
        isFreeDefault: false,
        maxReferencedMessages: 10,
        advancedParameters: null,
      });

      const response = await request(app).get('/admin/llm-config/config-1');

      expect(response.status).toBe(200);
      expect(response.body.config.params).toEqual({});
    });
  });

  describe('POST /admin/llm-config', () => {
    it('should create a global LLM config', async () => {
      prisma.llmConfig.findFirst.mockResolvedValue(null);
      prisma.llmConfig.create.mockResolvedValue({
        id: 'new-config-id',
        name: 'New Global Config',
        model: 'anthropic/claude-sonnet-4',
        isGlobal: true,
        isDefault: false,
      });

      const response = await request(app).post('/admin/llm-config').send({
        name: 'New Global Config',
        model: 'anthropic/claude-sonnet-4',
      });

      expect(response.status).toBe(201);
      expect(response.body.config.name).toBe('New Global Config');
      expect(response.body.config.isGlobal).toBe(true);
    });

    it('should accept memory settings in create (Phase 1 parity fix)', async () => {
      // This test verifies the Phase 1 fix - memory settings were previously missing from admin
      prisma.llmConfig.findFirst.mockResolvedValue(null);
      prisma.llmConfig.create.mockResolvedValue({
        id: 'new-config-id',
        name: 'Config with Memory Settings',
        model: 'anthropic/claude-sonnet-4',
        isGlobal: true,
        isDefault: false,
        memoryScoreThreshold: { toNumber: () => 0.75 },
        memoryLimit: 50,
        contextWindowTokens: 100000,
      });

      const response = await request(app).post('/admin/llm-config').send({
        name: 'Config with Memory Settings',
        model: 'anthropic/claude-sonnet-4',
        memoryScoreThreshold: 0.75,
        memoryLimit: 50,
        contextWindowTokens: 100000,
      });

      expect(response.status).toBe(201);
      // Verify memory settings are passed to Prisma create
      expect(prisma.llmConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            memoryScoreThreshold: 0.75,
            memoryLimit: 50,
            contextWindowTokens: 100000,
          }),
        })
      );
    });

    it('should return 403 if admin user not found in database', async () => {
      prisma.user.findUnique.mockResolvedValue(null); // Admin not registered

      const response = await request(app).post('/admin/llm-config').send({
        name: 'New Config',
        model: 'anthropic/claude-sonnet-4',
      });

      expect(response.status).toBe(403);
      expect(response.body.message).toMatch(/admin user not found/i);
    });

    it('should reject when name is missing', async () => {
      const response = await request(app).post('/admin/llm-config').send({
        model: 'anthropic/claude-sonnet-4',
      });

      expect(response.status).toBe(400);
      // Zod schema validation - either "name is required" (min check) or type error for missing field
      expect(response.body.message).toMatch(/name/i);
    });

    it('should reject when model is missing', async () => {
      const response = await request(app).post('/admin/llm-config').send({
        name: 'Test Config',
      });

      expect(response.status).toBe(400);
      // Zod schema validation - either "model is required" (min check) or type error for missing field
      expect(response.body.message).toMatch(/model/i);
    });

    it('should reject when name exceeds 100 characters', async () => {
      const response = await request(app)
        .post('/admin/llm-config')
        .send({
          name: 'a'.repeat(101),
          model: 'anthropic/claude-sonnet-4',
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/100 characters/i);
    });

    it('should reject duplicate global config names', async () => {
      prisma.llmConfig.findFirst.mockResolvedValue({ id: 'existing-config' });

      const response = await request(app).post('/admin/llm-config').send({
        name: 'Existing Config',
        model: 'anthropic/claude-sonnet-4',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/already exists/i);
    });
  });

  describe('PUT /admin/llm-config/:id', () => {
    it('should update a global config', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        name: 'Old Name',
        isGlobal: true,
      });
      // No duplicate name exists
      prisma.llmConfig.findFirst.mockResolvedValue(null);
      prisma.llmConfig.update.mockResolvedValue({
        id: 'config-id',
        name: 'New Name',
        model: 'google/gemini-2.0-flash',
        isGlobal: true,
        isDefault: false,
      });

      const response = await request(app).put('/admin/llm-config/config-id').send({
        name: 'New Name',
        model: 'google/gemini-2.0-flash',
      });

      expect(response.status).toBe(200);
      expect(response.body.config.name).toBe('New Name');
      expect(prisma.llmConfig.update).toHaveBeenCalledWith({
        where: { id: 'config-id' },
        data: { name: 'New Name', model: 'google/gemini-2.0-flash' },
        select: expect.any(Object),
      });
    });

    it('should accept memory settings in update (Phase 1 parity fix)', async () => {
      // This test verifies the Phase 1 fix - memory settings were previously missing from admin
      prisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        name: 'Existing Config',
        isGlobal: true,
      });
      prisma.llmConfig.update.mockResolvedValue({
        id: 'config-id',
        name: 'Existing Config',
        model: 'anthropic/claude-sonnet-4',
        isGlobal: true,
        isDefault: false,
        memoryScoreThreshold: { toNumber: () => 0.8 },
        memoryLimit: 100,
        contextWindowTokens: 200000,
      });

      const response = await request(app).put('/admin/llm-config/config-id').send({
        memoryScoreThreshold: 0.8,
        memoryLimit: 100,
        contextWindowTokens: 200000,
      });

      expect(response.status).toBe(200);
      // Verify memory settings are passed to Prisma update
      expect(prisma.llmConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            memoryScoreThreshold: 0.8,
            memoryLimit: 100,
            contextWindowTokens: 200000,
          }),
        })
      );
    });

    it('should return 404 when config not found', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue(null);

      const response = await request(app).put('/admin/llm-config/nonexistent').send({
        name: 'New Name',
      });

      expect(response.status).toBe(404);
      expect(response.body.message).toMatch(/not found/i);
    });

    it('should reject editing non-global configs', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        isGlobal: false,
      });

      const response = await request(app).put('/admin/llm-config/config-id').send({
        name: 'New Name',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/only.*global/i);
    });

    it('should reject when no fields to update', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        isGlobal: true,
      });

      const response = await request(app).put('/admin/llm-config/config-id').send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/no fields/i);
    });

    it('should reject when name exceeds 100 characters', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        isGlobal: true,
      });

      const response = await request(app)
        .put('/admin/llm-config/config-id')
        .send({
          name: 'a'.repeat(101),
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/100 characters/i);
    });

    it('should only update provided fields', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        isGlobal: true,
      });
      prisma.llmConfig.update.mockResolvedValue({
        id: 'config-id',
        name: 'Unchanged',
        model: 'new-model',
        isGlobal: true,
        isDefault: false,
      });

      const response = await request(app).put('/admin/llm-config/config-id').send({
        model: 'new-model',
      });

      expect(response.status).toBe(200);
      expect(prisma.llmConfig.update).toHaveBeenCalledWith({
        where: { id: 'config-id' },
        data: { model: 'new-model' },
        select: expect.any(Object),
      });
    });
  });

  describe('PUT /admin/llm-config/:id/set-default', () => {
    it('should set a global config as system default', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        name: 'My Config',
        isGlobal: true,
      });
      prisma.llmConfig.updateMany.mockResolvedValue({ count: 1 });
      prisma.llmConfig.update.mockResolvedValue({
        id: 'config-id',
        isDefault: true,
      });

      const response = await request(app).put('/admin/llm-config/config-id/set-default');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.configName).toBe('My Config');
      // Verify it clears existing default
      expect(prisma.llmConfig.updateMany).toHaveBeenCalledWith({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    });

    it('should return 404 when config not found', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue(null);

      const response = await request(app).put('/admin/llm-config/nonexistent/set-default');

      expect(response.status).toBe(404);
    });

    it('should reject setting non-global config as default', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        isGlobal: false,
      });

      const response = await request(app).put('/admin/llm-config/config-id/set-default');

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/only global/i);
    });
  });

  describe('PUT /admin/llm-config/:id/set-free-default', () => {
    it('should set a global config with free model as free tier default', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        name: 'Free Config',
        isGlobal: true,
        model: 'meta-llama/llama-3.3-70b-instruct:free',
      });
      prisma.llmConfig.updateMany.mockResolvedValue({ count: 1 });
      prisma.llmConfig.update.mockResolvedValue({
        id: 'config-id',
        isFreeDefault: true,
      });

      const response = await request(app).put('/admin/llm-config/config-id/set-free-default');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.configName).toBe('Free Config');
      // Verify it clears existing free default
      expect(prisma.llmConfig.updateMany).toHaveBeenCalledWith({
        where: { isFreeDefault: true },
        data: { isFreeDefault: false },
      });
    });

    it('should return 404 when config not found', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue(null);

      const response = await request(app).put('/admin/llm-config/nonexistent/set-free-default');

      expect(response.status).toBe(404);
    });

    it('should reject setting non-global config as free default', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        isGlobal: false,
        model: 'meta-llama/llama-3.3-70b-instruct:free',
      });

      const response = await request(app).put('/admin/llm-config/config-id/set-free-default');

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/only global/i);
    });

    it('should reject setting non-free model as free tier default', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        name: 'Paid Config',
        isGlobal: true,
        model: 'anthropic/claude-sonnet-4', // Not a :free model
      });

      const response = await request(app).put('/admin/llm-config/config-id/set-free-default');

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/free models/i);
      expect(response.body.message).toMatch(/:free/i);
      // Should not proceed to update
      expect(prisma.llmConfig.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /admin/llm-config/:id', () => {
    it('should delete a global config', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        name: 'Test Config',
        isGlobal: true,
        isDefault: false,
      });
      prisma.personalityDefaultConfig.count.mockResolvedValue(0);
      prisma.userPersonalityConfig.count.mockResolvedValue(0);
      prisma.llmConfig.delete.mockResolvedValue({});

      const response = await request(app).delete('/admin/llm-config/config-id');

      expect(response.status).toBe(200);
      expect(response.body.deleted).toBe(true);
    });

    it('should return 404 when config not found', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue(null);

      const response = await request(app).delete('/admin/llm-config/nonexistent');

      expect(response.status).toBe(404);
    });

    it('should reject deleting non-global configs', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        isGlobal: false,
        isDefault: false,
      });

      const response = await request(app).delete('/admin/llm-config/config-id');

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/only.*global/i);
    });

    it('should reject deleting the system default config', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        isGlobal: true,
        isDefault: true,
      });

      const response = await request(app).delete('/admin/llm-config/config-id');

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/default config/i);
    });

    it('should reject deleting config in use by personalities', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        isGlobal: true,
        isDefault: false,
      });
      prisma.personalityDefaultConfig.count.mockResolvedValue(3);

      const response = await request(app).delete('/admin/llm-config/config-id');

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/3 personality/i);
    });

    it('should reject deleting config in use by user overrides', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        isGlobal: true,
        isDefault: false,
      });
      prisma.personalityDefaultConfig.count.mockResolvedValue(0);
      prisma.userPersonalityConfig.count.mockResolvedValue(5);

      const response = await request(app).delete('/admin/llm-config/config-id');

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/5 user override/i);
    });
  });

  describe('PUT /admin/llm-config/:id - duplicate name check', () => {
    it('should reject duplicate name when renaming config', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        name: 'Old Name',
        isGlobal: true,
      });
      // Simulate another config with the same name exists
      prisma.llmConfig.findFirst.mockResolvedValue({
        id: 'other-config-id',
        name: 'Duplicate Name',
        isGlobal: true,
      });

      const response = await request(app).put('/admin/llm-config/config-id').send({
        name: 'Duplicate Name',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/already exists/i);
      expect(prisma.llmConfig.update).not.toHaveBeenCalled();
    });

    it('should allow keeping the same name (no duplicate check against self)', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        name: 'Same Name',
        isGlobal: true,
      });
      // findFirst returns null because we exclude the current config from the check
      prisma.llmConfig.findFirst.mockResolvedValue(null);
      prisma.llmConfig.update.mockResolvedValue({
        id: 'config-id',
        name: 'Same Name',
        model: 'new-model',
        isGlobal: true,
        isDefault: false,
      });

      const response = await request(app).put('/admin/llm-config/config-id').send({
        name: 'Same Name',
        model: 'new-model',
      });

      expect(response.status).toBe(200);
      expect(prisma.llmConfig.findFirst).toHaveBeenCalledWith({
        where: {
          isGlobal: true,
          name: 'Same Name',
          id: { not: 'config-id' },
        },
      });
    });
  });

  describe('Cache invalidation', () => {
    let appWithCache: Express;
    let cacheService: ReturnType<typeof createMockCacheInvalidationService>;

    beforeEach(() => {
      cacheService = createMockCacheInvalidationService();
      appWithCache = express();
      appWithCache.use(express.json());
      appWithCache.use(
        '/admin/llm-config',
        createAdminLlmConfigRoutes(
          prisma as unknown as PrismaClient,
          cacheService as unknown as LlmConfigCacheInvalidationService
        )
      );
    });

    it('should invalidate cache after updating a global config', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        name: 'Old Name',
        isGlobal: true,
      });
      prisma.llmConfig.findFirst.mockResolvedValue(null); // No duplicate
      prisma.llmConfig.update.mockResolvedValue({
        id: 'config-id',
        name: 'New Name',
        isGlobal: true,
        isDefault: false,
      });

      const response = await request(appWithCache).put('/admin/llm-config/config-id').send({
        name: 'New Name',
      });

      expect(response.status).toBe(200);
      expect(cacheService.invalidateAll).toHaveBeenCalled();
    });

    it('should invalidate cache after setting a config as default', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        name: 'My Config',
        isGlobal: true,
      });
      prisma.llmConfig.updateMany.mockResolvedValue({ count: 1 });
      prisma.llmConfig.update.mockResolvedValue({
        id: 'config-id',
        isDefault: true,
      });

      const response = await request(appWithCache).put('/admin/llm-config/config-id/set-default');

      expect(response.status).toBe(200);
      expect(cacheService.invalidateAll).toHaveBeenCalled();
    });

    it('should invalidate cache after setting a config as free default', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        name: 'Free Config',
        isGlobal: true,
        model: 'meta-llama/llama-3.3-70b-instruct:free',
      });
      prisma.llmConfig.updateMany.mockResolvedValue({ count: 1 });
      prisma.llmConfig.update.mockResolvedValue({
        id: 'config-id',
        isFreeDefault: true,
      });

      const response = await request(appWithCache).put(
        '/admin/llm-config/config-id/set-free-default'
      );

      expect(response.status).toBe(200);
      expect(cacheService.invalidateAll).toHaveBeenCalled();
    });

    it('should not call invalidate when no cache service provided', async () => {
      // Using the default app without cache service
      prisma.llmConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        name: 'Old Name',
        isGlobal: true,
      });
      prisma.llmConfig.findFirst.mockResolvedValue(null);
      prisma.llmConfig.update.mockResolvedValue({
        id: 'config-id',
        name: 'New Name',
        isGlobal: true,
        isDefault: false,
      });

      const response = await request(app).put('/admin/llm-config/config-id').send({
        name: 'New Name',
      });

      expect(response.status).toBe(200);
      // No error should occur even without cache service
    });
  });
});
