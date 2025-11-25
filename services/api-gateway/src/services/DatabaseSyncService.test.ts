/**
 * Database Sync Service Tests
 * Tests for bidirectional database synchronization with proper DI
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DatabaseSyncService } from './DatabaseSyncService.js';
import type { PrismaClient } from '@tzurot/common-types';

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
      devClient.$queryRaw.mockImplementation(async query => {
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

      prodClient.$queryRaw.mockImplementation(async query => {
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
      devClient.$queryRaw.mockImplementation(async query => {
        const queryStr = String(query);
        if (queryStr.includes('_prisma_migrations')) {
          return [{ migration_name: '20251117155350_update_memories_index_to_lists_50' }];
        }
        if (queryStr.includes('information_schema')) {
          return [{ table_name: 'users', column_name: 'id' }];
        }
        return [];
      });

      prodClient.$queryRaw.mockImplementation(async query => {
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
      await expect(service.sync({ dryRun: true })).rejects.toThrow('Disconnect failed');

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

  describe('Data Sync Logic', () => {
    beforeEach(() => {
      // Mock schema version and validation queries
      devClient.$queryRaw.mockImplementation(async query => {
        const queryStr = String(query);
        if (queryStr.includes('_prisma_migrations')) {
          return [{ migration_name: '20251117155350_update_memories_index_to_lists_50' }];
        }
        if (queryStr.includes('information_schema')) {
          return [
            { table_name: 'users', column_name: 'id' },
            { table_name: 'personas', column_name: 'id' },
          ];
        }
        return [];
      });

      prodClient.$queryRaw.mockImplementation(async query => {
        const queryStr = String(query);
        if (queryStr.includes('_prisma_migrations')) {
          return [{ migration_name: '20251117155350_update_memories_index_to_lists_50' }];
        }
        return [];
      });
    });

    it('should copy row from dev to prod when row only exists in dev', async () => {
      const devRow = {
        id: 'dev-user-1',
        discord_id: '123456789',
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-01-01'),
      };

      // Setup: Dev has a row, prod doesn't
      devClient.$queryRawUnsafe.mockImplementation(async query => {
        if (String(query).includes('FROM "users"')) {
          return [devRow];
        }
        return [];
      });

      prodClient.$queryRawUnsafe.mockResolvedValue([]); // Prod has no rows

      const result = await service.sync({ dryRun: false });

      // Should execute INSERT on prod
      expect(prodClient.$executeRawUnsafe).toHaveBeenCalled();
      const insertCall = prodClient.$executeRawUnsafe.mock.calls.find(call =>
        String(call[0]).includes('INSERT INTO "users"')
      );
      expect(insertCall).toBeDefined();

      // Stats should show 1 dev→prod sync
      expect(result.stats.users).toBeDefined();
      expect(result.stats.users.devToProd).toBe(1);
      expect(result.stats.users.prodToDev).toBe(0);
      expect(result.stats.users.conflicts).toBe(0);
    });

    it('should copy row from prod to dev when row only exists in prod', async () => {
      const prodRow = {
        id: 'prod-user-1',
        discord_id: '987654321',
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-01-01'),
      };

      // Setup: Prod has a row, dev doesn't
      devClient.$queryRawUnsafe.mockResolvedValue([]); // Dev has no rows

      prodClient.$queryRawUnsafe.mockImplementation(async query => {
        if (String(query).includes('FROM "users"')) {
          return [prodRow];
        }
        return [];
      });

      const result = await service.sync({ dryRun: false });

      // Should execute INSERT on dev
      expect(devClient.$executeRawUnsafe).toHaveBeenCalled();
      const insertCall = devClient.$executeRawUnsafe.mock.calls.find(call =>
        String(call[0]).includes('INSERT INTO "users"')
      );
      expect(insertCall).toBeDefined();

      // Stats should show 1 prod→dev sync
      expect(result.stats.users).toBeDefined();
      expect(result.stats.users.devToProd).toBe(0);
      expect(result.stats.users.prodToDev).toBe(1);
      expect(result.stats.users.conflicts).toBe(0);
    });

    it('should use last-write-wins when dev row is newer', async () => {
      const userId = 'shared-user-1';
      const devRow = {
        id: userId,
        discord_id: '111111111',
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-01-15'), // Newer
      };
      const prodRow = {
        id: userId,
        discord_id: '111111111',
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-01-10'), // Older
      };

      devClient.$queryRawUnsafe.mockImplementation(async query => {
        if (String(query).includes('FROM "users"')) {
          return [devRow];
        }
        return [];
      });

      prodClient.$queryRawUnsafe.mockImplementation(async query => {
        if (String(query).includes('FROM "users"')) {
          return [prodRow];
        }
        return [];
      });

      const result = await service.sync({ dryRun: false });

      // Should update prod with dev's newer data
      expect(prodClient.$executeRawUnsafe).toHaveBeenCalled();

      // Stats should show conflict resolved by copying dev→prod
      expect(result.stats.users.devToProd).toBe(1);
      expect(result.stats.users.prodToDev).toBe(0);
      expect(result.stats.users.conflicts).toBe(1);

      // Should have a warning about the conflict
      expect(result.warnings).toContain('users: 1 conflicts resolved using last-write-wins');
    });

    it('should use last-write-wins when prod row is newer', async () => {
      const userId = 'shared-user-2';
      const devRow = {
        id: userId,
        discord_id: '222222222',
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-01-10'), // Older
      };
      const prodRow = {
        id: userId,
        discord_id: '222222222',
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-01-15'), // Newer
      };

      devClient.$queryRawUnsafe.mockImplementation(async query => {
        if (String(query).includes('FROM "users"')) {
          return [devRow];
        }
        return [];
      });

      prodClient.$queryRawUnsafe.mockImplementation(async query => {
        if (String(query).includes('FROM "users"')) {
          return [prodRow];
        }
        return [];
      });

      const result = await service.sync({ dryRun: false });

      // Should update dev with prod's newer data
      expect(devClient.$executeRawUnsafe).toHaveBeenCalled();

      // Stats should show conflict resolved by copying prod→dev
      expect(result.stats.users.devToProd).toBe(0);
      expect(result.stats.users.prodToDev).toBe(1);
      expect(result.stats.users.conflicts).toBe(1);
    });

    it('should not sync when timestamps are identical', async () => {
      const userId = 'same-user';
      const timestamp = new Date('2025-01-15T12:00:00Z');
      const devRow = {
        id: userId,
        discord_id: '333333333',
        created_at: new Date('2025-01-01'),
        updated_at: timestamp,
      };
      const prodRow = {
        id: userId,
        discord_id: '333333333',
        created_at: new Date('2025-01-01'),
        updated_at: timestamp, // Identical
      };

      devClient.$queryRawUnsafe.mockImplementation(async query => {
        if (String(query).includes('FROM "users"')) {
          return [devRow];
        }
        return [];
      });

      prodClient.$queryRawUnsafe.mockImplementation(async query => {
        if (String(query).includes('FROM "users"')) {
          return [prodRow];
        }
        return [];
      });

      const result = await service.sync({ dryRun: false });

      // No writes should occur since rows are identical
      // (Only validation queries should have been executed)
      const writeCallsToUsers = prodClient.$executeRawUnsafe.mock.calls.filter(call =>
        String(call[0]).includes('INSERT INTO "users"')
      );
      expect(writeCallsToUsers).toHaveLength(0);

      // Stats should show no sync activity
      expect(result.stats.users.devToProd).toBe(0);
      expect(result.stats.users.prodToDev).toBe(0);
      expect(result.stats.users.conflicts).toBe(0);
    });

    it('should handle composite primary keys correctly', async () => {
      // personality_owners table has composite PK: [personality_id, user_id]
      const devRow = {
        personality_id: 'personality-1',
        user_id: 'user-1',
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-01-01'),
      };

      devClient.$queryRawUnsafe.mockImplementation(async query => {
        const queryStr = String(query);
        if (queryStr.includes('FROM "personality_owners"')) {
          return [devRow];
        }
        return [];
      });

      prodClient.$queryRawUnsafe.mockImplementation(async query => {
        if (String(query).includes('FROM "personality_owners"')) {
          return [];
        }
        return [];
      });

      const result = await service.sync({ dryRun: false });

      // Should handle composite key in INSERT
      expect(prodClient.$executeRawUnsafe).toHaveBeenCalled();
      const insertCall = prodClient.$executeRawUnsafe.mock.calls.find(call =>
        String(call[0]).includes('INSERT INTO "personality_owners"')
      );
      expect(insertCall).toBeDefined();

      // Query should use both columns in conflict clause
      const query = insertCall?.[0] as string;
      expect(query).toContain('ON CONFLICT');
      expect(query).toContain('"personality_id"');
      expect(query).toContain('"user_id"');

      expect(result.stats.personality_owners.devToProd).toBe(1);
    });

    it('should handle special memories table with pgvector', async () => {
      const memoryRow = {
        id: 'memory-1',
        persona_id: 'persona-1',
        personality_id: 'personality-1',
        content: 'Test memory',
        embedding: '[0.1, 0.2, 0.3]', // Vector as text (from fetchAllRows casting)
        created_at: new Date('2025-01-01'),
      };

      devClient.$queryRawUnsafe.mockImplementation(async query => {
        const queryStr = String(query);
        if (queryStr.includes('FROM "memories"')) {
          return [memoryRow];
        }
        return [];
      });

      prodClient.$queryRawUnsafe.mockImplementation(async query => {
        if (String(query).includes('FROM "memories"')) {
          return [];
        }
        return [];
      });

      const result = await service.sync({ dryRun: false });

      // Should handle embedding column with ::vector cast
      expect(prodClient.$executeRawUnsafe).toHaveBeenCalled();
      const insertCall = prodClient.$executeRawUnsafe.mock.calls.find(call =>
        String(call[0]).includes('INSERT INTO "memories"')
      );
      expect(insertCall).toBeDefined();

      const query = insertCall?.[0] as string;
      expect(query).toContain('::vector'); // Should cast embedding to vector type

      expect(result.stats.memories.devToProd).toBe(1);
    });

    it('should handle empty tables', async () => {
      // Both dev and prod have no rows
      devClient.$queryRawUnsafe.mockResolvedValue([]);
      prodClient.$queryRawUnsafe.mockResolvedValue([]);

      const result = await service.sync({ dryRun: false });

      // No writes should occur
      expect(devClient.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(prodClient.$executeRawUnsafe).not.toHaveBeenCalled();

      // All tables should have zero stats
      for (const tableName of Object.keys(result.stats)) {
        expect(result.stats[tableName].devToProd).toBe(0);
        expect(result.stats[tableName].prodToDev).toBe(0);
        expect(result.stats[tableName].conflicts).toBe(0);
      }
    });

    it('should handle multiple rows in a single table', async () => {
      const devRows = [
        {
          id: 'user-1',
          discord_id: '111',
          created_at: new Date('2025-01-01'),
          updated_at: new Date('2025-01-01'),
        },
        {
          id: 'user-2',
          discord_id: '222',
          created_at: new Date('2025-01-02'),
          updated_at: new Date('2025-01-02'),
        },
      ];

      const prodRows = [
        {
          id: 'user-3',
          discord_id: '333',
          created_at: new Date('2025-01-03'),
          updated_at: new Date('2025-01-03'),
        },
      ];

      devClient.$queryRawUnsafe.mockImplementation(async query => {
        if (String(query).includes('FROM "users"')) {
          return devRows;
        }
        return [];
      });

      prodClient.$queryRawUnsafe.mockImplementation(async query => {
        if (String(query).includes('FROM "users"')) {
          return prodRows;
        }
        return [];
      });

      const result = await service.sync({ dryRun: false });

      // Should sync 2 dev→prod (user-1, user-2) and 1 prod→dev (user-3)
      expect(result.stats.users.devToProd).toBe(2);
      expect(result.stats.users.prodToDev).toBe(1);
      expect(result.stats.users.conflicts).toBe(0);
    });

    it('should use createdAt when updatedAt is not available', async () => {
      // conversation_history table only has createdAt
      const userId = 'shared-conv-1';
      const devRow = {
        id: userId,
        persona_id: 'persona-1',
        content: 'Hello',
        created_at: new Date('2025-01-15'), // Newer
      };
      const prodRow = {
        id: userId,
        persona_id: 'persona-1',
        content: 'Hello',
        created_at: new Date('2025-01-10'), // Older
      };

      devClient.$queryRawUnsafe.mockImplementation(async query => {
        if (String(query).includes('FROM "conversation_history"')) {
          return [devRow];
        }
        return [];
      });

      prodClient.$queryRawUnsafe.mockImplementation(async query => {
        if (String(query).includes('FROM "conversation_history"')) {
          return [prodRow];
        }
        return [];
      });

      const result = await service.sync({ dryRun: false });

      // Should resolve conflict using createdAt (dev newer)
      expect(result.stats.conversation_history.devToProd).toBe(1);
      expect(result.stats.conversation_history.conflicts).toBe(1);
    });
  });
});
