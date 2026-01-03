/**
 * Tests for LLM Config Singleton Utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prepareLlmConfigSingletonFlags } from './llmConfigSingletons.js';
import type { PrismaClient } from '@tzurot/common-types';

// Mock logger
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
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

describe('llmConfigSingletons', () => {
  let devClient: {
    llmConfig: {
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
  let prodClient: {
    llmConfig: {
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    devClient = {
      llmConfig: {
        findMany: vi.fn(),
        update: vi.fn(),
      },
    };
    prodClient = {
      llmConfig: {
        findMany: vi.fn(),
        update: vi.fn(),
      },
    };
  });

  describe('prepareLlmConfigSingletonFlags', () => {
    it('should not update when no configs have singleton flags', async () => {
      devClient.llmConfig.findMany.mockResolvedValue([]);
      prodClient.llmConfig.findMany.mockResolvedValue([]);

      await prepareLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      expect(devClient.llmConfig.update).not.toHaveBeenCalled();
      expect(prodClient.llmConfig.update).not.toHaveBeenCalled();
    });

    it('should not update when only one database has the flag', async () => {
      devClient.llmConfig.findMany.mockResolvedValue([
        { id: 'config-1', isDefault: true, isFreeDefault: false, updatedAt: new Date() },
      ]);
      prodClient.llmConfig.findMany.mockResolvedValue([]);

      await prepareLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      expect(devClient.llmConfig.update).not.toHaveBeenCalled();
      expect(prodClient.llmConfig.update).not.toHaveBeenCalled();
    });

    it('should not update when same config has flag in both databases', async () => {
      const sharedConfig = {
        id: 'config-1',
        isDefault: true,
        isFreeDefault: false,
        updatedAt: new Date(),
      };
      devClient.llmConfig.findMany.mockResolvedValue([sharedConfig]);
      prodClient.llmConfig.findMany.mockResolvedValue([sharedConfig]);

      await prepareLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      expect(devClient.llmConfig.update).not.toHaveBeenCalled();
      expect(prodClient.llmConfig.update).not.toHaveBeenCalled();
    });

    it('should clear flag in prod when dev config is newer (isDefault)', async () => {
      const devConfig = {
        id: 'dev-config',
        isDefault: true,
        isFreeDefault: false,
        updatedAt: new Date('2025-01-02'),
      };
      const prodConfig = {
        id: 'prod-config',
        isDefault: true,
        isFreeDefault: false,
        updatedAt: new Date('2025-01-01'),
      };
      devClient.llmConfig.findMany.mockResolvedValue([devConfig]);
      prodClient.llmConfig.findMany.mockResolvedValue([prodConfig]);

      await prepareLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      // Should clear the flag in prod (older)
      expect(prodClient.llmConfig.update).toHaveBeenCalledWith({
        where: { id: 'prod-config' },
        data: { isDefault: false, updatedAt: expect.any(Date) },
      });
      expect(devClient.llmConfig.update).not.toHaveBeenCalled();
    });

    it('should clear flag in dev when prod config is newer (isDefault)', async () => {
      const devConfig = {
        id: 'dev-config',
        isDefault: true,
        isFreeDefault: false,
        updatedAt: new Date('2025-01-01'),
      };
      const prodConfig = {
        id: 'prod-config',
        isDefault: true,
        isFreeDefault: false,
        updatedAt: new Date('2025-01-02'),
      };
      devClient.llmConfig.findMany.mockResolvedValue([devConfig]);
      prodClient.llmConfig.findMany.mockResolvedValue([prodConfig]);

      await prepareLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      // Should clear the flag in dev (older)
      expect(devClient.llmConfig.update).toHaveBeenCalledWith({
        where: { id: 'dev-config' },
        data: { isDefault: false, updatedAt: expect.any(Date) },
      });
      expect(prodClient.llmConfig.update).not.toHaveBeenCalled();
    });

    it('should handle isFreeDefault flag conflicts', async () => {
      const devConfig = {
        id: 'dev-config',
        isDefault: false,
        isFreeDefault: true,
        updatedAt: new Date('2025-01-02'),
      };
      const prodConfig = {
        id: 'prod-config',
        isDefault: false,
        isFreeDefault: true,
        updatedAt: new Date('2025-01-01'),
      };
      devClient.llmConfig.findMany.mockResolvedValue([devConfig]);
      prodClient.llmConfig.findMany.mockResolvedValue([prodConfig]);

      await prepareLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      // Should clear the flag in prod (older)
      expect(prodClient.llmConfig.update).toHaveBeenCalledWith({
        where: { id: 'prod-config' },
        data: { isFreeDefault: false, updatedAt: expect.any(Date) },
      });
    });

    it('should handle both flags having conflicts independently', async () => {
      const devConfigs = [
        {
          id: 'dev-default',
          isDefault: true,
          isFreeDefault: false,
          updatedAt: new Date('2025-01-02'),
        },
        {
          id: 'dev-free',
          isDefault: false,
          isFreeDefault: true,
          updatedAt: new Date('2025-01-01'),
        },
      ];
      const prodConfigs = [
        {
          id: 'prod-default',
          isDefault: true,
          isFreeDefault: false,
          updatedAt: new Date('2025-01-01'),
        },
        {
          id: 'prod-free',
          isDefault: false,
          isFreeDefault: true,
          updatedAt: new Date('2025-01-02'),
        },
      ];
      devClient.llmConfig.findMany.mockResolvedValue(devConfigs);
      prodClient.llmConfig.findMany.mockResolvedValue(prodConfigs);

      await prepareLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      // isDefault: dev is newer, so clear prod
      expect(prodClient.llmConfig.update).toHaveBeenCalledWith({
        where: { id: 'prod-default' },
        data: { isDefault: false, updatedAt: expect.any(Date) },
      });
      // isFreeDefault: prod is newer, so clear dev
      expect(devClient.llmConfig.update).toHaveBeenCalledWith({
        where: { id: 'dev-free' },
        data: { isFreeDefault: false, updatedAt: expect.any(Date) },
      });
    });
  });
});
