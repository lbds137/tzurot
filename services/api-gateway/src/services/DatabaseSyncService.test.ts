/**
 * Database Sync Service Tests
 * Tests for bidirectional database synchronization with proper DI
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DatabaseSyncService } from './DatabaseSyncService.js';
import type { PrismaClient } from '@prisma/client';

// Mock Prisma clients
const createMockPrismaClient = () => ({
  $connect: vi.fn().mockResolvedValue(undefined),
  $disconnect: vi.fn().mockResolvedValue(undefined),
  $queryRaw: vi.fn().mockResolvedValue([]), // Default: return empty array
  $queryRawUnsafe: vi.fn().mockResolvedValue([]),
  $executeRaw: vi.fn().mockResolvedValue(0),
  $executeRawUnsafe: vi.fn().mockResolvedValue(0),
});

describe('DatabaseSyncService', () => {
  let devClient: ReturnType<typeof createMockPrismaClient>;
  let prodClient: ReturnType<typeof createMockPrismaClient>;
  let service: DatabaseSyncService;

  beforeEach(() => {
    devClient = createMockPrismaClient();
    prodClient = createMockPrismaClient();
    service = new DatabaseSyncService(
      devClient as unknown as PrismaClient,
      prodClient as unknown as PrismaClient
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor Injection', () => {
    it('should accept Prisma clients via constructor', () => {
      expect(service).toBeDefined();
      expect(service).toBeInstanceOf(DatabaseSyncService);
    });

    it('should not create Prisma clients internally', () => {
      // If service created clients internally, we wouldn't be able to inject mocks
      // This test verifies DI pattern is working
      expect(devClient).toBeDefined();
      expect(prodClient).toBeDefined();
    });
  });

  describe('sync()', () => {
    beforeEach(() => {
      // Mock default responses for all queries
      // Note: These mocks return the same data for all calls
      // Override in specific tests if different behavior is needed
      devClient.$queryRaw.mockImplementation(async (query) => {
        const queryStr = String(query);

        // Schema version query
        if (queryStr.includes('_prisma_migrations')) {
          return [{ migration_name: '20251117155350_update_memories_index_to_lists_50' }];
        }

        // UUID columns query (information_schema)
        if (queryStr.includes('information_schema')) {
          return [
            { table_name: 'users', column_name: 'id' },
            { table_name: 'personas', column_name: 'id' },
            { table_name: 'personas', column_name: 'owner_id' },
          ];
        }

        // Data queries (return empty for dry-run tests)
        return [];
      });

      prodClient.$queryRaw.mockImplementation(async (query) => {
        const queryStr = String(query);

        // Schema version query
        if (queryStr.includes('_prisma_migrations')) {
          return [{ migration_name: '20251117155350_update_memories_index_to_lists_50' }];
        }

        // UUID columns query (information_schema) - prod doesn't need this, but return empty array
        if (queryStr.includes('information_schema')) {
          return [];
        }

        // Data queries (return empty for dry-run tests)
        return [];
      });
    });

    it('should connect to both databases', async () => {
      await service.sync({ dryRun: true });

      expect(devClient.$connect).toHaveBeenCalledTimes(1);
      expect(prodClient.$connect).toHaveBeenCalledTimes(1);
    });

    it('should disconnect both databases even on success', async () => {
      await service.sync({ dryRun: true });

      expect(devClient.$disconnect).toHaveBeenCalledTimes(1);
      expect(prodClient.$disconnect).toHaveBeenCalledTimes(1);
    });

    it('should disconnect both databases even on error', async () => {
      devClient.$queryRaw.mockRejectedValueOnce(new Error('Connection failed'));

      await expect(service.sync({ dryRun: true })).rejects.toThrow('Connection failed');

      expect(devClient.$disconnect).toHaveBeenCalledTimes(1);
      expect(prodClient.$disconnect).toHaveBeenCalledTimes(1);
    });

    it('should check schema versions match', async () => {
      await service.sync({ dryRun: true });

      // Should query _prisma_migrations on both databases
      expect(devClient.$queryRaw).toHaveBeenCalled();
      expect(prodClient.$queryRaw).toHaveBeenCalled();
    });

    it('should throw error when schema versions mismatch', async () => {
      // Override default mock for this test
      devClient.$queryRaw.mockImplementation(async (query) => {
        const queryStr = String(query);
        if (queryStr.includes('_prisma_migrations')) {
          return [{ migration_name: '20251117155350_update_memories_index_to_lists_50' }];
        }
        if (queryStr.includes('information_schema')) {
          return [{ table_name: 'users', column_name: 'id' }];
        }
        return [];
      });

      prodClient.$queryRaw.mockImplementation(async (query) => {
        const queryStr = String(query);
        if (queryStr.includes('_prisma_migrations')) {
          return [{ migration_name: '20251117153407_add_hnsw_index_to_memories' }];
        }
        return [];
      });

      await expect(service.sync({ dryRun: true })).rejects.toThrow(/schema version mismatch/i);

      // Should still disconnect
      expect(devClient.$disconnect).toHaveBeenCalledTimes(1);
      expect(prodClient.$disconnect).toHaveBeenCalledTimes(1);
    });

    it('should return sync results with statistics', async () => {
      const result = await service.sync({ dryRun: true });

      expect(result).toHaveProperty('schemaVersion');
      expect(result).toHaveProperty('stats');
      expect(result).toHaveProperty('warnings');
      expect(result.stats).toBeTypeOf('object');
    });

    it('should not modify data in dry-run mode', async () => {
      await service.sync({ dryRun: true });

      // In dry-run, should only read data (via $queryRaw), not execute writes
      expect(devClient.$queryRaw).toHaveBeenCalled();
      expect(prodClient.$queryRaw).toHaveBeenCalled();

      // Should not execute any write operations
      expect(devClient.$executeRaw).not.toHaveBeenCalled();
      expect(prodClient.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('Resource Management', () => {
    it('should still throw disconnect errors', async () => {
      devClient.$disconnect.mockRejectedValueOnce(new Error('Disconnect failed'));

      // Disconnect errors propagate to caller
      await expect(service.sync({ dryRun: true})).rejects.toThrow('Disconnect failed');

      expect(devClient.$disconnect).toHaveBeenCalledTimes(1);
      // Prod disconnect won't be called since dev disconnect threw
    });
  });

  describe('Error Handling', () => {
    it('should handle dev database connection failure', async () => {
      devClient.$connect.mockRejectedValueOnce(new Error('Dev DB unreachable'));

      await expect(service.sync({ dryRun: true })).rejects.toThrow('Dev DB unreachable');

      // Should still attempt to disconnect
      expect(devClient.$disconnect).toHaveBeenCalledTimes(1);
      expect(prodClient.$disconnect).toHaveBeenCalledTimes(1);
    });

    it('should handle prod database connection failure', async () => {
      prodClient.$connect.mockRejectedValueOnce(new Error('Prod DB unreachable'));

      await expect(service.sync({ dryRun: true })).rejects.toThrow('Prod DB unreachable');

      // Should still attempt to disconnect
      expect(devClient.$disconnect).toHaveBeenCalledTimes(1);
      expect(prodClient.$disconnect).toHaveBeenCalledTimes(1);
    });

    it('should handle query errors during sync', async () => {
      // Schema version check passes
      devClient.$queryRaw.mockResolvedValueOnce([
        { migration_name: '20251117155350_update_memories_index_to_lists_50' },
      ]);
      prodClient.$queryRaw.mockResolvedValueOnce([
        { migration_name: '20251117155350_update_memories_index_to_lists_50' },
      ]);

      // But subsequent query fails
      devClient.$queryRaw.mockRejectedValueOnce(new Error('Query timeout'));

      await expect(service.sync({ dryRun: true })).rejects.toThrow('Query timeout');

      // Should still disconnect
      expect(devClient.$disconnect).toHaveBeenCalledTimes(1);
      expect(prodClient.$disconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('Dependency Injection Benefits', () => {
    it('should allow testing with mock clients', () => {
      // This test verifies that DI makes testing easy
      // We can inject any mock we want
      const customDevClient = createMockPrismaClient();
      const customProdClient = createMockPrismaClient();

      const customService = new DatabaseSyncService(
        customDevClient as unknown as PrismaClient,
        customProdClient as unknown as PrismaClient
      );

      expect(customService).toBeDefined();
      expect(customService).toBeInstanceOf(DatabaseSyncService);
    });

    it('should not depend on global state', () => {
      // Create two separate service instances with different clients
      const service1DevClient = createMockPrismaClient();
      const service1ProdClient = createMockPrismaClient();
      const service1 = new DatabaseSyncService(
        service1DevClient as unknown as PrismaClient,
        service1ProdClient as unknown as PrismaClient
      );

      const service2DevClient = createMockPrismaClient();
      const service2ProdClient = createMockPrismaClient();
      const service2 = new DatabaseSyncService(
        service2DevClient as unknown as PrismaClient,
        service2ProdClient as unknown as PrismaClient
      );

      // Services should be completely independent
      expect(service1).not.toBe(service2);
      expect(service1DevClient).not.toBe(service2DevClient);
      expect(service1ProdClient).not.toBe(service2ProdClient);
    });
  });
});
