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
    $queryRawUnsafe: ReturnType<typeof vi.fn>;
    $executeRawUnsafe: ReturnType<typeof vi.fn>;
  };
  let prodClient: {
    $queryRawUnsafe: ReturnType<typeof vi.fn>;
    $executeRawUnsafe: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    devClient = {
      $queryRawUnsafe: vi.fn(),
      $executeRawUnsafe: vi.fn(),
    };
    prodClient = {
      $queryRawUnsafe: vi.fn(),
      $executeRawUnsafe: vi.fn(),
    };
  });

  describe('prepareLlmConfigSingletonFlags', () => {
    it('should not update when no configs have singleton flags', async () => {
      devClient.$queryRawUnsafe.mockResolvedValue([]);
      prodClient.$queryRawUnsafe.mockResolvedValue([]);

      await prepareLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      expect(devClient.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(prodClient.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('should not update when only one database has the flag', async () => {
      devClient.$queryRawUnsafe.mockResolvedValue([
        { id: 'config-1', is_default: true, is_free_default: false, updated_at: new Date() },
      ]);
      prodClient.$queryRawUnsafe.mockResolvedValue([]);

      await prepareLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      expect(devClient.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(prodClient.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('should not update when same config has flag in both databases', async () => {
      const sharedConfig = {
        id: 'config-1',
        is_default: true,
        is_free_default: false,
        updated_at: new Date(),
      };
      devClient.$queryRawUnsafe.mockResolvedValue([sharedConfig]);
      prodClient.$queryRawUnsafe.mockResolvedValue([sharedConfig]);

      await prepareLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      expect(devClient.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(prodClient.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('should clear flag in prod when dev config is newer (is_default)', async () => {
      const devConfig = {
        id: 'dev-config',
        is_default: true,
        is_free_default: false,
        updated_at: new Date('2025-01-02'),
      };
      const prodConfig = {
        id: 'prod-config',
        is_default: true,
        is_free_default: false,
        updated_at: new Date('2025-01-01'),
      };
      devClient.$queryRawUnsafe.mockResolvedValue([devConfig]);
      prodClient.$queryRawUnsafe.mockResolvedValue([prodConfig]);

      await prepareLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      // Should clear the flag in prod (older)
      expect(prodClient.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('is_default = false'),
        'prod-config'
      );
      expect(devClient.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('should clear flag in dev when prod config is newer (is_default)', async () => {
      const devConfig = {
        id: 'dev-config',
        is_default: true,
        is_free_default: false,
        updated_at: new Date('2025-01-01'),
      };
      const prodConfig = {
        id: 'prod-config',
        is_default: true,
        is_free_default: false,
        updated_at: new Date('2025-01-02'),
      };
      devClient.$queryRawUnsafe.mockResolvedValue([devConfig]);
      prodClient.$queryRawUnsafe.mockResolvedValue([prodConfig]);

      await prepareLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      // Should clear the flag in dev (older)
      expect(devClient.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('is_default = false'),
        'dev-config'
      );
      expect(prodClient.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('should handle is_free_default flag conflicts', async () => {
      const devConfig = {
        id: 'dev-config',
        is_default: false,
        is_free_default: true,
        updated_at: new Date('2025-01-02'),
      };
      const prodConfig = {
        id: 'prod-config',
        is_default: false,
        is_free_default: true,
        updated_at: new Date('2025-01-01'),
      };
      devClient.$queryRawUnsafe.mockResolvedValue([devConfig]);
      prodClient.$queryRawUnsafe.mockResolvedValue([prodConfig]);

      await prepareLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      // Should clear the flag in prod (older)
      expect(prodClient.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('is_free_default = false'),
        'prod-config'
      );
    });

    it('should handle both flags having conflicts independently', async () => {
      const devConfigs = [
        {
          id: 'dev-default',
          is_default: true,
          is_free_default: false,
          updated_at: new Date('2025-01-02'),
        },
        {
          id: 'dev-free',
          is_default: false,
          is_free_default: true,
          updated_at: new Date('2025-01-01'),
        },
      ];
      const prodConfigs = [
        {
          id: 'prod-default',
          is_default: true,
          is_free_default: false,
          updated_at: new Date('2025-01-01'),
        },
        {
          id: 'prod-free',
          is_default: false,
          is_free_default: true,
          updated_at: new Date('2025-01-02'),
        },
      ];
      devClient.$queryRawUnsafe.mockResolvedValue(devConfigs);
      prodClient.$queryRawUnsafe.mockResolvedValue(prodConfigs);

      await prepareLlmConfigSingletonFlags(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      // is_default: dev is newer, so clear prod
      expect(prodClient.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('is_default = false'),
        'prod-default'
      );
      // is_free_default: prod is newer, so clear dev
      expect(devClient.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('is_free_default = false'),
        'dev-free'
      );
    });
  });
});
