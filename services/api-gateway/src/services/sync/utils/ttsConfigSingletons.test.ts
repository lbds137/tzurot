/**
 * Tests for TTS Config Singleton Utilities
 *
 * Mirrors llmConfigSingletons.test.ts (same logic surface, different table).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  prepareTtsConfigSingletonFlags,
  finalizeTtsConfigSingletonFlags,
} from './ttsConfigSingletons.js';
import type { PrismaClient } from '@tzurot/common-types';

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
  ttsConfig: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

describe('ttsConfigSingletons', () => {
  let devClient: MockPrismaClient;
  let prodClient: MockPrismaClient;

  beforeEach(() => {
    devClient = {
      ttsConfig: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    };
    prodClient = {
      ttsConfig: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    };
  });

  describe('prepareTtsConfigSingletonFlags', () => {
    it('should not update when no configs have singleton flags', async () => {
      devClient.ttsConfig.findMany.mockResolvedValue([]);
      prodClient.ttsConfig.findMany.mockResolvedValue([]);

      await prepareTtsConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      expect(devClient.ttsConfig.update).not.toHaveBeenCalled();
      expect(prodClient.ttsConfig.update).not.toHaveBeenCalled();
    });

    it('should not update when only one database has the flag', async () => {
      devClient.ttsConfig.findMany.mockResolvedValue([
        { id: 'config-1', isDefault: true, isFreeDefault: false, updatedAt: new Date() },
      ]);
      prodClient.ttsConfig.findMany.mockResolvedValue([]);

      await prepareTtsConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      expect(devClient.ttsConfig.update).not.toHaveBeenCalled();
      expect(prodClient.ttsConfig.update).not.toHaveBeenCalled();
    });

    it('should not update when same config has flag in both databases', async () => {
      const sharedConfig = {
        id: 'config-1',
        isDefault: true,
        isFreeDefault: false,
        updatedAt: new Date(),
      };
      devClient.ttsConfig.findMany.mockResolvedValue([sharedConfig]);
      prodClient.ttsConfig.findMany.mockResolvedValue([sharedConfig]);

      await prepareTtsConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      expect(devClient.ttsConfig.update).not.toHaveBeenCalled();
      expect(prodClient.ttsConfig.update).not.toHaveBeenCalled();
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
      devClient.ttsConfig.findMany.mockResolvedValue([devConfig]);
      prodClient.ttsConfig.findMany.mockResolvedValue([prodConfig]);
      prodClient.ttsConfig.findUnique.mockResolvedValue({ id: 'dev-config' });

      await prepareTtsConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      expect(prodClient.ttsConfig.update).toHaveBeenCalledWith({
        where: { id: 'prod-config' },
        data: { isDefault: false, updatedAt: expect.any(Date) },
      });
      expect(prodClient.ttsConfig.update).toHaveBeenCalledWith({
        where: { id: 'dev-config' },
        data: { isDefault: true, updatedAt: expect.any(Date) },
      });
      expect(devClient.ttsConfig.update).not.toHaveBeenCalled();
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
      devClient.ttsConfig.findMany.mockResolvedValue([devConfig]);
      prodClient.ttsConfig.findMany.mockResolvedValue([prodConfig]);
      devClient.ttsConfig.findUnique.mockResolvedValue({ id: 'prod-config' });

      await prepareTtsConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      expect(devClient.ttsConfig.update).toHaveBeenCalledWith({
        where: { id: 'dev-config' },
        data: { isDefault: false, updatedAt: expect.any(Date) },
      });
      expect(devClient.ttsConfig.update).toHaveBeenCalledWith({
        where: { id: 'prod-config' },
        data: { isDefault: true, updatedAt: expect.any(Date) },
      });
      expect(prodClient.ttsConfig.update).not.toHaveBeenCalled();
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
      devClient.ttsConfig.findMany.mockResolvedValue([devConfig]);
      prodClient.ttsConfig.findMany.mockResolvedValue([prodConfig]);
      prodClient.ttsConfig.findUnique.mockResolvedValue(null);

      await prepareTtsConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      expect(prodClient.ttsConfig.update).toHaveBeenCalledWith({
        where: { id: 'prod-config' },
        data: { isDefault: false, updatedAt: expect.any(Date) },
      });
      expect(prodClient.ttsConfig.update).toHaveBeenCalledTimes(1);
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
      devClient.ttsConfig.findMany.mockResolvedValue([devConfig]);
      prodClient.ttsConfig.findMany.mockResolvedValue([prodConfig]);
      prodClient.ttsConfig.findUnique.mockResolvedValue({ id: 'dev-config' });

      await prepareTtsConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      expect(prodClient.ttsConfig.update).toHaveBeenCalledWith({
        where: { id: 'prod-config' },
        data: { isFreeDefault: false, updatedAt: expect.any(Date) },
      });
      expect(prodClient.ttsConfig.update).toHaveBeenCalledWith({
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
      devClient.ttsConfig.findMany.mockResolvedValue(devConfigs);
      prodClient.ttsConfig.findMany.mockResolvedValue(prodConfigs);
      prodClient.ttsConfig.findUnique.mockResolvedValue({ id: 'dev-default' });
      devClient.ttsConfig.findUnique.mockResolvedValue({ id: 'prod-free' });

      await prepareTtsConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      expect(prodClient.ttsConfig.update).toHaveBeenCalledWith({
        where: { id: 'prod-default' },
        data: { isDefault: false, updatedAt: expect.any(Date) },
      });
      expect(prodClient.ttsConfig.update).toHaveBeenCalledWith({
        where: { id: 'dev-default' },
        data: { isDefault: true, updatedAt: expect.any(Date) },
      });
      expect(devClient.ttsConfig.update).toHaveBeenCalledWith({
        where: { id: 'dev-free' },
        data: { isFreeDefault: false, updatedAt: expect.any(Date) },
      });
      expect(devClient.ttsConfig.update).toHaveBeenCalledWith({
        where: { id: 'prod-free' },
        data: { isFreeDefault: true, updatedAt: expect.any(Date) },
      });
    });
  });

  describe('finalizeTtsConfigSingletonFlags', () => {
    it('should do nothing when no pending resolutions', async () => {
      devClient.ttsConfig.findMany.mockResolvedValue([]);
      prodClient.ttsConfig.findMany.mockResolvedValue([]);
      await prepareTtsConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      vi.clearAllMocks();

      await finalizeTtsConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      expect(devClient.ttsConfig.update).not.toHaveBeenCalled();
      expect(prodClient.ttsConfig.update).not.toHaveBeenCalled();
    });

    it('should set flag on newly synced config after sync (dev wins)', async () => {
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
      devClient.ttsConfig.findMany.mockResolvedValue([devConfig]);
      prodClient.ttsConfig.findMany.mockResolvedValue([prodConfig]);
      prodClient.ttsConfig.findUnique.mockResolvedValue(null);

      await prepareTtsConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      vi.clearAllMocks();

      prodClient.ttsConfig.findUnique.mockResolvedValue({ id: 'dev-config' });

      await finalizeTtsConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      expect(prodClient.ttsConfig.update).toHaveBeenCalledWith({
        where: { id: 'dev-config' },
        data: { isDefault: true, updatedAt: expect.any(Date) },
      });
    });

    it('should set flag on newly synced config after sync (prod wins)', async () => {
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
      devClient.ttsConfig.findMany.mockResolvedValue([devConfig]);
      prodClient.ttsConfig.findMany.mockResolvedValue([prodConfig]);
      devClient.ttsConfig.findUnique.mockResolvedValue(null);

      await prepareTtsConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      vi.clearAllMocks();

      devClient.ttsConfig.findUnique.mockResolvedValue({ id: 'prod-config' });

      await finalizeTtsConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      expect(devClient.ttsConfig.update).toHaveBeenCalledWith({
        where: { id: 'prod-config' },
        data: { isDefault: true, updatedAt: expect.any(Date) },
      });
    });

    it('should not update if config still not found after sync', async () => {
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
      devClient.ttsConfig.findMany.mockResolvedValue([devConfig]);
      prodClient.ttsConfig.findMany.mockResolvedValue([prodConfig]);
      prodClient.ttsConfig.findUnique.mockResolvedValue(null);

      await prepareTtsConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      vi.clearAllMocks();

      prodClient.ttsConfig.findUnique.mockResolvedValue(null);

      await finalizeTtsConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      expect(prodClient.ttsConfig.update).not.toHaveBeenCalled();
    });

    it('should clear pending resolutions after finalize', async () => {
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
      devClient.ttsConfig.findMany.mockResolvedValue([devConfig]);
      prodClient.ttsConfig.findMany.mockResolvedValue([prodConfig]);
      prodClient.ttsConfig.findUnique.mockResolvedValue(null);

      await prepareTtsConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      vi.clearAllMocks();
      prodClient.ttsConfig.findUnique.mockResolvedValue({ id: 'dev-config' });

      await finalizeTtsConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      expect(prodClient.ttsConfig.update).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      await finalizeTtsConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      expect(prodClient.ttsConfig.update).not.toHaveBeenCalled();
    });
  });
});
