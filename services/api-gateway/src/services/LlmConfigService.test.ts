/**
 * LlmConfigService Tests
 *
 * Unit tests for the unified LLM config service layer.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LlmConfigService, type LlmConfigScope } from './LlmConfigService.js';
import type { PrismaClient, LlmConfigCacheInvalidationService } from '@tzurot/common-types';

// Mock logger
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

// Helper to create mock Prisma client
function createMockPrisma() {
  const mockLlmConfig = {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
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

  return {
    llmConfig: mockLlmConfig,
    personalityDefaultConfig: mockPersonalityDefaultConfig,
    userPersonalityConfig: mockUserPersonalityConfig,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      const txMock = {
        llmConfig: mockLlmConfig,
      };
      return callback(txMock);
    }),
  };
}

// Helper to create mock cache invalidation service
function createMockCacheService() {
  return {
    invalidateAll: vi.fn().mockResolvedValue(undefined),
    invalidateUserLlmConfig: vi.fn().mockResolvedValue(undefined),
    invalidateConfigUsers: vi.fn().mockResolvedValue(undefined),
  };
}

// Sample config data for tests
const sampleConfigDetail = {
  id: 'config-123',
  name: 'Test Config',
  description: 'A test config',
  provider: 'openrouter',
  model: 'anthropic/claude-sonnet-4',
  visionModel: null,
  isGlobal: true,
  isDefault: false,
  isFreeDefault: false,
  ownerId: 'user-123',
  advancedParameters: { temperature: 0.7 },
  maxReferencedMessages: 20,
  memoryScoreThreshold: { toNumber: () => 0.5 },
  memoryLimit: 20,
  contextWindowTokens: 131072,
  maxMessages: 50,
  maxAge: null,
  maxImages: 10,
};

describe('LlmConfigService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let cacheService: ReturnType<typeof createMockCacheService>;
  let service: LlmConfigService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    cacheService = createMockCacheService();
    service = new LlmConfigService(
      prisma as unknown as PrismaClient,
      cacheService as unknown as LlmConfigCacheInvalidationService
    );
  });

  describe('getById', () => {
    it('should return config when found', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue(sampleConfigDetail);

      const result = await service.getById('config-123');

      expect(result).toEqual(sampleConfigDetail);
      expect(prisma.llmConfig.findUnique).toHaveBeenCalledWith({
        where: { id: 'config-123' },
        select: expect.objectContaining({ id: true, advancedParameters: true }),
      });
    });

    it('should return null when not found', async () => {
      prisma.llmConfig.findUnique.mockResolvedValue(null);

      const result = await service.getById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('list', () => {
    it('should list all configs for GLOBAL scope', async () => {
      const configs = [
        { id: 'config-1', name: 'Global 1', isGlobal: true },
        { id: 'config-2', name: 'User 1', isGlobal: false },
      ];
      prisma.llmConfig.findMany.mockResolvedValue(configs);

      const result = await service.list({ type: 'GLOBAL' });

      expect(result).toEqual(configs);
      expect(prisma.llmConfig.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.llmConfig.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: expect.arrayContaining([{ isDefault: 'desc' }]),
        })
      );
    });

    it('should list global + user configs for USER scope', async () => {
      const globalConfigs = [{ id: 'global-1', name: 'Global', isGlobal: true }];
      const userConfigs = [{ id: 'user-1', name: 'My Config', isGlobal: false }];
      prisma.llmConfig.findMany
        .mockResolvedValueOnce(globalConfigs)
        .mockResolvedValueOnce(userConfigs);

      const scope: LlmConfigScope = { type: 'USER', userId: 'user-123', discordId: 'discord-123' };
      const result = await service.list(scope);

      expect(result).toEqual([...globalConfigs, ...userConfigs]);
      expect(prisma.llmConfig.findMany).toHaveBeenCalledTimes(2);
      // First call: global configs
      expect(prisma.llmConfig.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ where: { isGlobal: true } })
      );
      // Second call: user's own configs
      expect(prisma.llmConfig.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ where: { ownerId: 'user-123', isGlobal: false } })
      );
    });
  });

  describe('create', () => {
    it('should create a global config for GLOBAL scope', async () => {
      prisma.llmConfig.create.mockResolvedValue(sampleConfigDetail);

      const result = await service.create(
        { type: 'GLOBAL' },
        { name: 'Test Config', model: 'anthropic/claude-sonnet-4' },
        'admin-user-id'
      );

      expect(result).toEqual(sampleConfigDetail);
      expect(prisma.llmConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isGlobal: true,
            ownerId: 'admin-user-id',
          }),
        })
      );
      expect(cacheService.invalidateAll).toHaveBeenCalled();
    });

    it('should create a user config for USER scope', async () => {
      const userConfig = { ...sampleConfigDetail, isGlobal: false };
      prisma.llmConfig.create.mockResolvedValue(userConfig);

      const scope: LlmConfigScope = { type: 'USER', userId: 'user-123', discordId: 'discord-123' };
      const result = await service.create(
        scope,
        { name: 'My Config', model: 'anthropic/claude-sonnet-4' },
        'user-123'
      );

      expect(result).toEqual(userConfig);
      expect(prisma.llmConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isGlobal: false,
            ownerId: 'user-123',
          }),
        })
      );
    });

    it('should apply default values when not provided', async () => {
      prisma.llmConfig.create.mockResolvedValue(sampleConfigDetail);

      await service.create({ type: 'GLOBAL' }, { name: 'Test', model: 'test-model' }, 'owner-id');

      expect(prisma.llmConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            provider: 'openrouter',
            maxMessages: 50, // DEFAULT_MAX_MESSAGES
            maxImages: 10, // DEFAULT_MAX_IMAGES
          }),
        })
      );
    });

    it('should trim name and model', async () => {
      prisma.llmConfig.create.mockResolvedValue(sampleConfigDetail);

      await service.create(
        { type: 'GLOBAL' },
        { name: '  Spaced Name  ', model: '  spaced-model  ' },
        'owner-id'
      );

      expect(prisma.llmConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Spaced Name',
            model: 'spaced-model',
          }),
        })
      );
    });

    it('should include memory settings when provided', async () => {
      prisma.llmConfig.create.mockResolvedValue(sampleConfigDetail);

      await service.create(
        { type: 'GLOBAL' },
        {
          name: 'Test',
          model: 'test-model',
          memoryScoreThreshold: 0.7,
          memoryLimit: 30,
          contextWindowTokens: 65536,
        },
        'owner-id'
      );

      expect(prisma.llmConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            memoryScoreThreshold: 0.7,
            memoryLimit: 30,
            contextWindowTokens: 65536,
          }),
        })
      );
    });
  });

  describe('update', () => {
    it('should update only provided fields', async () => {
      prisma.llmConfig.update.mockResolvedValue(sampleConfigDetail);

      await service.update('config-123', { name: 'New Name' });

      expect(prisma.llmConfig.update).toHaveBeenCalledWith({
        where: { id: 'config-123' },
        data: { name: 'New Name' },
        select: expect.any(Object),
      });
      expect(cacheService.invalidateAll).toHaveBeenCalled();
    });

    it('should update memory settings', async () => {
      prisma.llmConfig.update.mockResolvedValue(sampleConfigDetail);

      await service.update('config-123', {
        memoryScoreThreshold: 0.8,
        memoryLimit: 25,
        contextWindowTokens: 100000,
      });

      expect(prisma.llmConfig.update).toHaveBeenCalledWith({
        where: { id: 'config-123' },
        data: {
          memoryScoreThreshold: 0.8,
          memoryLimit: 25,
          contextWindowTokens: 100000,
        },
        select: expect.any(Object),
      });
    });

    it('should update context settings', async () => {
      prisma.llmConfig.update.mockResolvedValue(sampleConfigDetail);

      await service.update('config-123', {
        maxMessages: 75,
        maxAge: 86400,
        maxImages: 15,
      });

      expect(prisma.llmConfig.update).toHaveBeenCalledWith({
        where: { id: 'config-123' },
        data: {
          maxMessages: 75,
          maxAge: 86400,
          maxImages: 15,
        },
        select: expect.any(Object),
      });
    });

    it('should allow toggling isGlobal', async () => {
      prisma.llmConfig.update.mockResolvedValue(sampleConfigDetail);

      await service.update('config-123', { isGlobal: true });

      expect(prisma.llmConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { isGlobal: true },
        })
      );
    });
  });

  describe('delete', () => {
    it('should delete config and invalidate cache', async () => {
      prisma.llmConfig.delete.mockResolvedValue({});

      await service.delete('config-123');

      expect(prisma.llmConfig.delete).toHaveBeenCalledWith({ where: { id: 'config-123' } });
      expect(cacheService.invalidateAll).toHaveBeenCalled();
    });
  });

  describe('setAsDefault', () => {
    it('should clear existing default and set new one', async () => {
      prisma.llmConfig.updateMany.mockResolvedValue({ count: 1 });
      prisma.llmConfig.update.mockResolvedValue({ id: 'config-123', isDefault: true });

      await service.setAsDefault('config-123');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(cacheService.invalidateAll).toHaveBeenCalled();
    });
  });

  describe('setAsFreeDefault', () => {
    it('should clear existing free default and set new one', async () => {
      prisma.llmConfig.updateMany.mockResolvedValue({ count: 1 });
      prisma.llmConfig.update.mockResolvedValue({ id: 'config-123', isFreeDefault: true });

      await service.setAsFreeDefault('config-123');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(cacheService.invalidateAll).toHaveBeenCalled();
    });
  });

  describe('checkNameExists', () => {
    it('should check global names for GLOBAL scope', async () => {
      prisma.llmConfig.findFirst.mockResolvedValue(null);

      const result = await service.checkNameExists('Test Name', { type: 'GLOBAL' });

      expect(result).toEqual({ exists: false });
      expect(prisma.llmConfig.findFirst).toHaveBeenCalledWith({
        where: { name: 'Test Name', isGlobal: true },
        select: { id: true },
      });
    });

    it('should check user names for USER scope', async () => {
      prisma.llmConfig.findFirst.mockResolvedValue({ id: 'existing-config' });

      const scope: LlmConfigScope = { type: 'USER', userId: 'user-123', discordId: 'discord-123' };
      const result = await service.checkNameExists('Test Name', scope);

      expect(result).toEqual({ exists: true, conflictId: 'existing-config' });
      expect(prisma.llmConfig.findFirst).toHaveBeenCalledWith({
        where: { name: 'Test Name', ownerId: 'user-123' },
        select: { id: true },
      });
    });

    it('should exclude current config ID when updating', async () => {
      prisma.llmConfig.findFirst.mockResolvedValue(null);

      await service.checkNameExists('Test Name', { type: 'GLOBAL' }, 'current-config-id');

      expect(prisma.llmConfig.findFirst).toHaveBeenCalledWith({
        where: {
          name: 'Test Name',
          isGlobal: true,
          id: { not: 'current-config-id' },
        },
        select: { id: true },
      });
    });
  });

  describe('checkDeleteConstraints', () => {
    it('should return null when deletable', async () => {
      prisma.personalityDefaultConfig.count.mockResolvedValue(0);
      prisma.userPersonalityConfig.count.mockResolvedValue(0);

      const result = await service.checkDeleteConstraints('config-123');

      expect(result).toBeNull();
    });

    it('should return error when used by personalities', async () => {
      prisma.personalityDefaultConfig.count.mockResolvedValue(3);
      prisma.userPersonalityConfig.count.mockResolvedValue(0);

      const result = await service.checkDeleteConstraints('config-123');

      expect(result).toContain('3 personality');
    });

    it('should return error when used by user overrides', async () => {
      prisma.personalityDefaultConfig.count.mockResolvedValue(0);
      prisma.userPersonalityConfig.count.mockResolvedValue(5);

      const result = await service.checkDeleteConstraints('config-123');

      expect(result).toContain('5 user override');
    });
  });

  describe('formatConfigDetail', () => {
    it('should format raw config for API response', () => {
      const raw = {
        ...sampleConfigDetail,
        memoryScoreThreshold: { toNumber: () => 0.75 },
      };

      const result = service.formatConfigDetail(raw);

      expect(result).toEqual({
        id: 'config-123',
        name: 'Test Config',
        description: 'A test config',
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4',
        visionModel: null,
        isGlobal: true,
        isDefault: false,
        isFreeDefault: false,
        maxReferencedMessages: 20,
        memoryScoreThreshold: 0.75,
        memoryLimit: 20,
        contextWindowTokens: 131072,
        maxMessages: 50,
        maxAge: null,
        maxImages: 10,
        params: { temperature: 0.7 },
      });
    });

    it('should handle null memoryScoreThreshold', () => {
      const raw = { ...sampleConfigDetail, memoryScoreThreshold: null };

      const result = service.formatConfigDetail(raw);

      expect(result.memoryScoreThreshold).toBeNull();
    });

    it('should handle null/invalid advancedParameters', () => {
      const raw = { ...sampleConfigDetail, advancedParameters: null };

      const result = service.formatConfigDetail(raw);

      expect(result.params).toEqual({});
    });
  });

  describe('cache invalidation', () => {
    it('should not fail when cache service is not provided', async () => {
      const serviceWithoutCache = new LlmConfigService(prisma as unknown as PrismaClient);
      prisma.llmConfig.create.mockResolvedValue(sampleConfigDetail);

      await expect(
        serviceWithoutCache.create(
          { type: 'GLOBAL' },
          { name: 'Test', model: 'test-model' },
          'owner-id'
        )
      ).resolves.toBeDefined();
    });

    it('should not throw when cache invalidation fails', async () => {
      cacheService.invalidateAll.mockRejectedValue(new Error('Redis error'));
      prisma.llmConfig.create.mockResolvedValue(sampleConfigDetail);

      await expect(
        service.create({ type: 'GLOBAL' }, { name: 'Test', model: 'test-model' }, 'owner-id')
      ).resolves.toBeDefined();
    });
  });
});
