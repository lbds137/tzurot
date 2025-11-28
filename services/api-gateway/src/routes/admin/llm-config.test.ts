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
  requireOwnerAuth: () => (_req: unknown, _res: unknown, next: () => void) => {
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

  return {
    llmConfig: mockLlmConfig,
    personalityDefaultConfig: {
      count: vi.fn(),
    },
    userPersonalityConfig: {
      count: vi.fn(),
    },
    // Transaction mock - executes callback with same mock objects
    $transaction: vi.fn(
      async (callback: (tx: { llmConfig: typeof mockLlmConfig }) => Promise<void>) => {
        await callback({ llmConfig: mockLlmConfig });
      }
    ),
  };
};

describe('Admin LLM Config Routes', () => {
  let app: Express;
  let prisma: ReturnType<typeof createMockPrismaClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrismaClient();
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
          ownerId: null,
          owner: null,
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

    it('should reject when name is missing', async () => {
      const response = await request(app).post('/admin/llm-config').send({
        model: 'anthropic/claude-sonnet-4',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/name is required/i);
    });

    it('should reject when model is missing', async () => {
      const response = await request(app).post('/admin/llm-config').send({
        name: 'Test Config',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/model is required/i);
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
