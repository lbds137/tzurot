/**
 * Tests for LLM Config Singleton Utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  prepareLlmConfigSingletonFlags,
  finalizeLlmConfigSingletonFlags,
} from './llmConfigSingletons.js';
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

interface MockPrismaClient {
  llmConfig: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

describe('llmConfigSingletons', () => {
  let devClient: MockPrismaClient;
  let prodClient: MockPrismaClient;

  beforeEach(() => {
    devClient = {
      llmConfig: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    };
    prodClient = {
      llmConfig: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
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

    it('should clear flag in prod and set on dev config in prod when dev is newer', async () => {
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
      // Dev's config exists in prod
      prodClient.llmConfig.findUnique.mockResolvedValue({ id: 'dev-config' });

      await prepareLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      // Should clear the flag in prod (older)
      expect(prodClient.llmConfig.update).toHaveBeenCalledWith({
        where: { id: 'prod-config' },
        data: { isDefault: false, updatedAt: expect.any(Date) },
      });
      // Should set the flag on dev's config in prod
      expect(prodClient.llmConfig.update).toHaveBeenCalledWith({
        where: { id: 'dev-config' },
        data: { isDefault: true, updatedAt: expect.any(Date) },
      });
      expect(devClient.llmConfig.update).not.toHaveBeenCalled();
    });

    it('should clear flag in dev and set on prod config in dev when prod is newer', async () => {
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
      // Prod's config exists in dev
      devClient.llmConfig.findUnique.mockResolvedValue({ id: 'prod-config' });

      await prepareLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      // Should clear the flag in dev (older)
      expect(devClient.llmConfig.update).toHaveBeenCalledWith({
        where: { id: 'dev-config' },
        data: { isDefault: false, updatedAt: expect.any(Date) },
      });
      // Should set the flag on prod's config in dev
      expect(devClient.llmConfig.update).toHaveBeenCalledWith({
        where: { id: 'prod-config' },
        data: { isDefault: true, updatedAt: expect.any(Date) },
      });
      expect(prodClient.llmConfig.update).not.toHaveBeenCalled();
    });

    it('should track pending resolution when winner config does not exist in other env', async () => {
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
      // Dev's config does NOT exist in prod
      prodClient.llmConfig.findUnique.mockResolvedValue(null);

      await prepareLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      // Should clear the flag in prod
      expect(prodClient.llmConfig.update).toHaveBeenCalledWith({
        where: { id: 'prod-config' },
        data: { isDefault: false, updatedAt: expect.any(Date) },
      });
      // Should NOT try to set flag (config doesn't exist)
      expect(prodClient.llmConfig.update).toHaveBeenCalledTimes(1);
      // Finalize will handle it after sync
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
      prodClient.llmConfig.findUnique.mockResolvedValue({ id: 'dev-config' });

      await prepareLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      // Should clear the flag in prod (older)
      expect(prodClient.llmConfig.update).toHaveBeenCalledWith({
        where: { id: 'prod-config' },
        data: { isFreeDefault: false, updatedAt: expect.any(Date) },
      });
      // Should set the flag on dev's config in prod
      expect(prodClient.llmConfig.update).toHaveBeenCalledWith({
        where: { id: 'dev-config' },
        data: { isFreeDefault: true, updatedAt: expect.any(Date) },
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
      // Dev-default exists in prod, prod-free exists in dev
      prodClient.llmConfig.findUnique.mockResolvedValue({ id: 'dev-default' });
      devClient.llmConfig.findUnique.mockResolvedValue({ id: 'prod-free' });

      await prepareLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      // isDefault: dev is newer, so clear prod and set dev's config in prod
      expect(prodClient.llmConfig.update).toHaveBeenCalledWith({
        where: { id: 'prod-default' },
        data: { isDefault: false, updatedAt: expect.any(Date) },
      });
      expect(prodClient.llmConfig.update).toHaveBeenCalledWith({
        where: { id: 'dev-default' },
        data: { isDefault: true, updatedAt: expect.any(Date) },
      });
      // isFreeDefault: prod is newer, so clear dev and set prod's config in dev
      expect(devClient.llmConfig.update).toHaveBeenCalledWith({
        where: { id: 'dev-free' },
        data: { isFreeDefault: false, updatedAt: expect.any(Date) },
      });
      expect(devClient.llmConfig.update).toHaveBeenCalledWith({
        where: { id: 'prod-free' },
        data: { isFreeDefault: true, updatedAt: expect.any(Date) },
      });
    });
  });

  describe('finalizeLlmConfigSingletonFlags', () => {
    it('should do nothing when no pending resolutions', async () => {
      // Clear pending by calling prepare with no conflicts
      devClient.llmConfig.findMany.mockResolvedValue([]);
      prodClient.llmConfig.findMany.mockResolvedValue([]);
      await prepareLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      vi.clearAllMocks();

      await finalizeLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      expect(devClient.llmConfig.update).not.toHaveBeenCalled();
      expect(prodClient.llmConfig.update).not.toHaveBeenCalled();
    });

    it('should set flag on newly synced config after sync (dev wins)', async () => {
      // Setup: dev wins but config doesn't exist in prod yet
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
      prodClient.llmConfig.findUnique.mockResolvedValue(null); // Config doesn't exist yet

      await prepareLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      vi.clearAllMocks();

      // Now config exists after sync
      prodClient.llmConfig.findUnique.mockResolvedValue({ id: 'dev-config' });

      await finalizeLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      // Should set the flag on the newly synced config in prod
      expect(prodClient.llmConfig.update).toHaveBeenCalledWith({
        where: { id: 'dev-config' },
        data: { isDefault: true, updatedAt: expect.any(Date) },
      });
    });

    it('should set flag on newly synced config after sync (prod wins)', async () => {
      // Setup: prod wins but config doesn't exist in dev yet
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
      devClient.llmConfig.findUnique.mockResolvedValue(null); // Config doesn't exist yet

      await prepareLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      vi.clearAllMocks();

      // Now config exists after sync
      devClient.llmConfig.findUnique.mockResolvedValue({ id: 'prod-config' });

      await finalizeLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      // Should set the flag on the newly synced config in dev
      expect(devClient.llmConfig.update).toHaveBeenCalledWith({
        where: { id: 'prod-config' },
        data: { isDefault: true, updatedAt: expect.any(Date) },
      });
    });

    it('should not update if config still not found after sync', async () => {
      // Setup: dev wins but config doesn't exist in prod
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
      prodClient.llmConfig.findUnique.mockResolvedValue(null);

      await prepareLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      vi.clearAllMocks();

      // Config still doesn't exist after sync (shouldn't happen but test the guard)
      prodClient.llmConfig.findUnique.mockResolvedValue(null);

      await finalizeLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      // Should not try to update non-existent config
      expect(prodClient.llmConfig.update).not.toHaveBeenCalled();
    });

    it('should clear pending resolutions after finalize', async () => {
      // Setup: dev wins but config doesn't exist in prod
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
      prodClient.llmConfig.findUnique.mockResolvedValue(null);

      await prepareLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      vi.clearAllMocks();
      prodClient.llmConfig.findUnique.mockResolvedValue({ id: 'dev-config' });

      // First finalize
      await finalizeLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      expect(prodClient.llmConfig.update).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // Second finalize should do nothing (pending cleared)
      await finalizeLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      expect(prodClient.llmConfig.update).not.toHaveBeenCalled();
    });
  });
});
