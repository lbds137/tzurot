/**
 * Database Sync Service Tests
 * Tests for bidirectional database synchronization with proper DI
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DatabaseSyncService } from './DatabaseSyncService.js';
import { SYNC_CONFIG, SYNC_TABLE_ORDER } from './sync/config/syncTables.js';

// Healthy trigger inventory derived from SYNC_CONFIG so the tombstone-trigger
// drift guard stays quiet in these tests (its scenario matrix lives in
// syncValidation.test.ts). Derivation keeps this in step when tables change.
const HEALTHY_TRIGGER_ROWS = Object.entries(SYNC_CONFIG)
  .filter(
    ([table]) =>
      !['conversation_history', 'conversation_history_tombstones', 'sync_tombstones'].includes(
        table
      )
  )
  .map(([table, config]) => ({
    event_object_table: table,
    action_statement: `EXECUTE FUNCTION sync_tombstone_capture(${(typeof config.pk === 'string'
      ? [config.pk]
      : config.pk
    )
      .map(col => `'${col}'`)
      .join(', ')})`,
  }));
import type { PrismaClient } from '@tzurot/common-types/services/prisma';

// Mock Prisma clients
const createMockPrismaClient = () => {
  const mock: {
    $connect: ReturnType<typeof vi.fn>;
    $disconnect: ReturnType<typeof vi.fn>;
    $queryRaw: ReturnType<typeof vi.fn>;
    $queryRawUnsafe: ReturnType<typeof vi.fn>;
    $executeRaw: ReturnType<typeof vi.fn>;
    $executeRawUnsafe: ReturnType<typeof vi.fn>;
    // Mock $transaction the way the Ouroboros refactor uses it: pass `this`
    // (the mock itself) as the `tx` handle so upserts inside the callback
    // route to the same $executeRawUnsafe the rest of the test asserts on.
    $transaction: ReturnType<typeof vi.fn>;
    conversationHistoryTombstone: { findMany: ReturnType<typeof vi.fn> };
    syncTombstone: {
      findMany: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
    conversationHistory: { deleteMany: ReturnType<typeof vi.fn> };
    llmConfig: {
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    ttsConfig: {
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  } = {
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn().mockResolvedValue([]),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn().mockResolvedValue(0),
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    $transaction: vi.fn(),
    conversationHistoryTombstone: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    syncTombstone: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    conversationHistory: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    llmConfig: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    ttsConfig: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  // Simulate Prisma's interactive $transaction(cb) by invoking the callback
  // with the mock itself. All $executeRawUnsafe calls made inside the cb
  // still land on the same mock, so existing assertions keep working.
  mock.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
    return cb(mock);
  });
  return mock;
};

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
        if (queryStr.includes('information_schema.triggers')) {
          return HEALTHY_TRIGGER_ROWS;
        }
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
        if (queryStr.includes('information_schema.triggers')) {
          return HEALTHY_TRIGGER_ROWS;
        }
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
        if (queryStr.includes('information_schema.triggers')) {
          return HEALTHY_TRIGGER_ROWS;
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
        if (queryStr.includes('information_schema.triggers')) {
          return HEALTHY_TRIGGER_ROWS;
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

  describe('Foreign Key Ordering', () => {
    /**
     * This test verifies that tables are synced in FK-dependency order.
     * The original bug was that Object.entries(SYNC_CONFIG) iterated in definition order,
     * causing users to sync before personas - which fails because
     * users.default_persona_id references personas.id.
     */
    beforeEach(() => {
      // Mock schema version and validation queries
      devClient.$queryRaw.mockImplementation(async query => {
        const queryStr = String(query);
        if (queryStr.includes('_prisma_migrations')) {
          return [{ migration_name: '20251117155350_update_memories_index_to_lists_50' }];
        }
        if (queryStr.includes('information_schema.triggers')) {
          return HEALTHY_TRIGGER_ROWS;
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

    it('should sync tables in SYNC_TABLE_ORDER order', async () => {
      // Track the order of table syncs by capturing SELECT * queries
      // (excludes SELECT id queries like loadTombstoneIds which runs before the sync loop)
      const syncedTables: string[] = [];

      devClient.$queryRawUnsafe.mockImplementation(async query => {
        const queryStr = String(query);
        // Match SELECT * FROM "tablename" pattern (full row fetches during sync)
        // Also match the vector-table queries (explicit column lists starting
        // with id, due to the embedding::text cast — memories, memory_facts)
        // Excludes: SELECT id FROM (tombstone loading), information_schema
        const selectStarMatch = queryStr.match(/SELECT \* FROM "([^"]+)"/);
        const vectorTableMatch = queryStr.match(/SELECT\s+id,.*FROM "([^"]+)"/s);
        if (selectStarMatch) {
          syncedTables.push(selectStarMatch[1]);
        } else if (vectorTableMatch) {
          syncedTables.push(vectorTableMatch[1]);
        }
        return [];
      });

      prodClient.$queryRawUnsafe.mockResolvedValue([]);

      await service.sync({ dryRun: true });

      // The tables should be synced in SYNC_TABLE_ORDER order
      // Filter out only the tables that are in SYNC_TABLE_ORDER (ignore validation queries)
      const syncedInOrder = syncedTables.filter(t =>
        SYNC_TABLE_ORDER.includes(t as (typeof SYNC_TABLE_ORDER)[number])
      );

      // Verify order matches SYNC_TABLE_ORDER
      expect(syncedInOrder).toEqual(SYNC_TABLE_ORDER);
    });

    it('should sync users before personas (personas.owner_id FK - NOT NULL)', async () => {
      // Circular FK dependency between users and personas:
      // - users.default_persona_id -> personas.id (NULLABLE - deferred to pass 2)
      // - personas.owner_id -> users.id (NOT NULL - must sync users first)
      const syncedTables: string[] = [];

      devClient.$queryRawUnsafe.mockImplementation(async query => {
        const queryStr = String(query);
        // Match SELECT * FROM (full row fetches during sync loop)
        const match = queryStr.match(/SELECT \* FROM "([^"]+)"/);
        if (match) {
          syncedTables.push(match[1]);
        }
        return [];
      });

      prodClient.$queryRawUnsafe.mockResolvedValue([]);

      await service.sync({ dryRun: true });

      const personasIndex = syncedTables.indexOf('personas');
      const usersIndex = syncedTables.indexOf('users');

      // Both tables should have been synced
      expect(personasIndex).toBeGreaterThanOrEqual(0);
      expect(usersIndex).toBeGreaterThanOrEqual(0);

      // users must come before personas (personas.owner_id -> users.id is NOT NULL)
      // default_persona_id is a NULLABLE circular FK, deferred to pass 2 by
      // ForeignKeyReconciler after personas are synced.
      expect(
        usersIndex,
        'users must be synced before personas to satisfy FK constraint (personas.owner_id is NOT NULL)'
      ).toBeLessThan(personasIndex);
    });

    it('should carry real values for circular-FK columns through the single-pass insert (Ouroboros)', async () => {
      // Inverse of the old two-pass regression guard. Under the Ouroboros
      // Insert pattern (see DatabaseSyncService docstring and migration
      // 20260418010642), users.default_persona_id and default_llm_config_id
      // pass through with the source environment's real values in a single
      // pass. Postgres validates the circular FKs at COMMIT thanks to
      // `SET CONSTRAINTS ALL DEFERRED` inside the sync transaction — which
      // `flushWrites` issues as the transaction's first statement.
      //
      // If a future refactor restores the NULL-strip or adds a second
      // UPDATE pass, this test fails and the author should read the
      // Ouroboros rationale before "fixing" it.
      const executedQueries: Array<{ query: string; params: unknown[] }> = [];
      const userId = '00000000-0000-5000-a000-000000000001';
      const personaId = '00000000-0000-5000-a000-000000000002';

      devClient.$queryRawUnsafe.mockImplementation(async query => {
        const queryStr = String(query);
        if (queryStr.includes('FROM "users"') && !queryStr.includes('UPDATE')) {
          return [
            {
              id: userId,
              discord_id: '123456789',
              username: 'testuser',
              default_persona_id: personaId,
              default_llm_config_id: null,
              created_at: new Date('2024-01-01'),
              updated_at: new Date('2024-01-02'),
              timezone: 'UTC',
              preferences: {},
            },
          ];
        }
        return [];
      });
      prodClient.$queryRawUnsafe.mockResolvedValue([]);

      prodClient.$executeRawUnsafe.mockImplementation(
        async (query: unknown, ...params: unknown[]) => {
          executedQueries.push({ query: String(query), params });
          return { count: 1 };
        }
      );

      await service.sync({ dryRun: false });

      // The first $executeRawUnsafe inside the prod transaction must be a
      // named `SET CONSTRAINTS ... DEFERRED` for the four circular FKs —
      // without it the circular-FK insert would violate at INSERT time.
      // We name them explicitly (rather than `ALL DEFERRED`) so future
      // migrations adding unrelated deferrable constraints don't get
      // silently softened inside the sync transaction (PR #826 R1 #4).
      const setConstraints = executedQueries.find(
        ({ query }) => query.includes('SET CONSTRAINTS') && query.includes('DEFERRED')
      );
      expect(
        setConstraints,
        'expected SET CONSTRAINTS DEFERRED inside prod transaction'
      ).toBeDefined();
      if (setConstraints) {
        expect(setConstraints.query).toContain('users_default_persona_id_fkey');
        expect(setConstraints.query).toContain('users_default_llm_config_id_fkey');
        expect(setConstraints.query).toContain('personas_owner_id_fkey');
        expect(setConstraints.query).toContain('llm_configs_owner_id_fkey');
      }

      // The users INSERT must carry the REAL default_persona_id value —
      // not NULL. Both circular-FK columns appear in both the INSERT column
      // list AND the DO UPDATE SET clause (conflict resolution updates them
      // rather than skipping them, which is correct now that the constraint
      // is deferred).
      const usersInsert = executedQueries.find(
        ({ query }) => query.includes('INSERT INTO "users"') && query.includes('ON CONFLICT')
      );
      expect(usersInsert, 'expected users upsert').toBeDefined();
      if (usersInsert) {
        const [columnListSection, updateSetSection] = usersInsert.query.split('DO UPDATE SET');
        expect(columnListSection).toContain('"default_persona_id"');
        expect(columnListSection).toContain('"default_llm_config_id"');
        // FK columns must be in the conflict update — stripping them would
        // leave stale values in the target row on upsert.
        expect(updateSetSection).toContain('default_persona_id');
        expect(updateSetSection).toContain('default_llm_config_id');

        // Values align with columns by position (SyncUpsertBuilder invariant).
        const columnOrder = /\(([^)]+)\)/.exec(columnListSection);
        expect(columnOrder).not.toBeNull();
        if (columnOrder) {
          const cols = columnOrder[1].split(',').map(c => c.trim().replace(/"/g, ''));
          const personaIdx = cols.indexOf('default_persona_id');
          // Real value flows through, no NULL strip.
          expect(usersInsert.params[personaIdx]).toBe(personaId);
        }
      }
    });

    it('defers only the constraints the target reports deferrable (migration-soak window)', async () => {
      const executedQueries: string[] = [];
      const userId = '4f9b0f66-0000-4000-8000-0000000000d1';
      const personaId = '4f9b0f66-0000-4000-8000-0000000000d2';

      devClient.$queryRawUnsafe.mockImplementation(async query => {
        const queryStr = String(query);
        if (queryStr.includes('FROM "users"') && !queryStr.includes('UPDATE')) {
          return [
            {
              id: userId,
              discord_id: '123456789',
              username: 'soakuser',
              default_persona_id: personaId,
              created_at: new Date('2024-01-01'),
              updated_at: new Date('2024-01-02'),
            },
          ];
        }
        return [];
      });
      // Prod reports every wanted constraint EXCEPT the memory_facts self-FK
      // as deferrable — the exact shape of a dev-ahead soak window.
      prodClient.$queryRawUnsafe.mockImplementation(async query => {
        if (String(query).includes('table_constraints')) {
          return [
            { constraint_name: 'users_default_persona_id_fkey' },
            { constraint_name: 'users_default_llm_config_id_fkey' },
            { constraint_name: 'users_default_tts_config_id_fkey' },
            { constraint_name: 'personas_owner_id_fkey' },
            { constraint_name: 'llm_configs_owner_id_fkey' },
          ];
        }
        return [];
      });
      prodClient.$executeRawUnsafe.mockImplementation(async (query: unknown) => {
        executedQueries.push(String(query));
        return { count: 1 };
      });

      await service.sync({ dryRun: false });

      const setConstraints = executedQueries.find(
        q => q.includes('SET CONSTRAINTS') && q.includes('DEFERRED')
      );
      expect(setConstraints, 'expected SET CONSTRAINTS on the prod flush').toBeDefined();
      // The not-yet-deferrable constraint must be OMITTED — naming it throws
      // Postgres 42809 and breaks the whole sync for the soak window.
      expect(setConstraints).not.toContain('memory_facts_superseded_by_id_fkey');
      expect(setConstraints).toContain('users_default_persona_id_fkey');
      expect(setConstraints).toContain('llm_configs_owner_id_fkey');
    });

    it('a tombstoned one-sided row queues a DELETE on the holding side instead of copying', async () => {
      const aliasId = '4f9b0f66-0000-4000-8000-0000000000f1';
      const executed: string[] = [];
      // personality_aliases is created_at-only (immutable) — exercises the
      // createdAt fallback of the tombstone comparison.
      prodClient.$queryRawUnsafe.mockImplementation(async query => {
        const queryStr = String(query);
        if (queryStr.includes('FROM "personality_aliases"')) {
          return [
            {
              id: aliasId,
              personality_id: '4f9b0f66-0000-4000-8000-0000000000f2',
              alias: 'doomed',
              created_at: new Date('2026-07-01T00:00:00Z'),
            },
          ];
        }
        return [];
      });
      prodClient.syncTombstone.findMany
        .mockResolvedValueOnce([
          {
            tableName: 'personality_aliases',
            rowPk: aliasId,
            deletedAt: new Date('2026-07-09T00:00:00Z'), // newer than created_at
          },
        ])
        .mockResolvedValue([]);
      prodClient.$executeRawUnsafe.mockImplementation(async (query: unknown) => {
        executed.push(String(query));
        return 1;
      });

      const result = await service.sync({ dryRun: false });

      // The row was NOT copied to dev …
      const inserts = vi
        .mocked(devClient.$executeRawUnsafe)
        .mock.calls.filter(c => String(c[0]).includes('INSERT INTO "personality_aliases"'));
      expect(inserts).toHaveLength(0);
      // … it was DELETED from prod (the side still holding it).
      expect(executed.some(q => q.includes('DELETE FROM "personality_aliases"'))).toBe(true);
      expect(result.stats.personality_aliases.deleted).toBe(1);
      // Row-level detail names the exact row and the losing side.
      expect(result.deletions).toEqual([
        { table: 'personality_aliases', rowKey: aliasId, target: 'prod' },
      ]);
      expect(result.deletionsTruncated).toBe(false);
    });

    it('flushes propagated DELETEs before upserts (delete-then-recreate under a new id)', async () => {
      // Delete-then-recreate under a new id: an alias removed on dev and
      // re-added under its deterministic id queues a prod-bound DELETE (old
      // random-id row, tombstoned) AND a prod-bound INSERT (new id, same
      // lower(alias)).
      // With writes first, the INSERT 23505s the partial unique
      // personality_aliases_global_alias_unique while the doomed row still
      // holds the slot, rolling back the whole write transaction. Deletes
      // must vacate unique slots first.
      const oldId = '13656360-2291-437e-9c91-000000000001'; // prod's random-id row
      const newId = '2ef6438e-2309-5e06-9f98-000000000002'; // dev's deterministic row
      const executed: string[] = [];

      devClient.$queryRawUnsafe.mockImplementation(async query => {
        if (String(query).includes('FROM "personality_aliases"')) {
          return [
            {
              id: newId,
              personality_id: '4f9b0f66-0000-4000-8000-0000000000f2',
              alias: 'emberlynn',
              created_at: new Date('2026-07-18T00:00:00Z'),
            },
          ];
        }
        return [];
      });
      prodClient.$queryRawUnsafe.mockImplementation(async query => {
        if (String(query).includes('FROM "personality_aliases"')) {
          return [
            {
              id: oldId,
              personality_id: '4f9b0f66-0000-4000-8000-0000000000f2',
              alias: 'emberlynn',
              created_at: new Date('2026-07-01T00:00:00Z'),
            },
          ];
        }
        return [];
      });
      devClient.syncTombstone.findMany
        .mockResolvedValueOnce([
          {
            tableName: 'personality_aliases',
            rowPk: oldId,
            deletedAt: new Date('2026-07-18T22:00:00Z'),
          },
        ])
        .mockResolvedValue([]);
      prodClient.$executeRawUnsafe.mockImplementation(async (query: unknown) => {
        executed.push(String(query));
        return 1;
      });

      await service.sync({ dryRun: false });

      const deleteIndex = executed.findIndex(q => q.includes('DELETE FROM "personality_aliases"'));
      const insertIndex = executed.findIndex(q => q.includes('INSERT INTO "personality_aliases"'));
      expect(deleteIndex, 'the tombstoned row must be deleted').toBeGreaterThanOrEqual(0);
      expect(insertIndex, 'the replacement row must be inserted').toBeGreaterThanOrEqual(0);
      expect(
        deleteIndex,
        'the DELETE must vacate the unique slot BEFORE the replacement INSERT'
      ).toBeLessThan(insertIndex);
    });

    it('caps row-level deletion detail at 500 and flags the truncation loudly', async () => {
      // 501 tombstoned one-sided rows: the response-size backstop must slice
      // the detail to 500 and set the flag, while the per-table stats keep
      // the COMPLETE candidate count (dry run — no flush reconciliation).
      const rows = Array.from({ length: 501 }, (_, i) => ({
        id: `id-${i}`,
        personality_id: '4f9b0f66-0000-4000-8000-0000000000f9',
        alias: `doomed-${i}`,
        created_at: new Date('2026-07-01T00:00:00Z'),
      }));
      prodClient.$queryRawUnsafe.mockImplementation(async query => {
        if (String(query).includes('FROM "personality_aliases"')) {
          return rows;
        }
        return [];
      });
      prodClient.syncTombstone.findMany
        .mockResolvedValueOnce(
          rows.map(row => ({
            tableName: 'personality_aliases',
            rowPk: row.id,
            deletedAt: new Date('2026-07-09T00:00:00Z'),
          }))
        )
        .mockResolvedValue([]);

      const result = await service.sync({ dryRun: true });

      expect(result.deletions).toHaveLength(500);
      expect(result.deletionsTruncated).toBe(true);
      // The slice keeps the head of the queue — first row present, 501st cut.
      expect(result.deletions[0]).toEqual({
        table: 'personality_aliases',
        rowKey: 'id-0',
        target: 'prod',
      });
      expect(result.deletions.some(d => d.rowKey === 'id-500')).toBe(false);
      // Per-table counts stay complete; only the row-level DETAIL is capped.
      expect(result.stats.personality_aliases.deleted).toBe(501);
    });

    it('a failed delete propagation SKIPS tombstone pruning (protects the unpropagated deletion)', async () => {
      const aliasId = '4f9b0f66-0000-4000-8000-0000000000f3';
      prodClient.$queryRawUnsafe.mockImplementation(async query => {
        if (String(query).includes('FROM "personality_aliases"')) {
          return [
            {
              id: aliasId,
              personality_id: '4f9b0f66-0000-4000-8000-0000000000f4',
              alias: 'stuck',
              created_at: new Date('2026-07-01T00:00:00Z'),
            },
          ];
        }
        return [];
      });
      prodClient.syncTombstone.findMany
        .mockResolvedValueOnce([
          {
            tableName: 'personality_aliases',
            rowPk: aliasId,
            deletedAt: new Date('2026-07-09T00:00:00Z'),
          },
        ])
        .mockResolvedValue([]);
      // The propagated DELETE fails (RESTRICT-divergence shape).
      prodClient.$executeRawUnsafe.mockImplementation(async (query: unknown) => {
        if (String(query).includes('DELETE FROM "personality_aliases"')) {
          throw new Error('violates foreign key constraint');
        }
        return 1;
      });

      const result = await service.sync({ dryRun: false });

      // Pruning must NOT run — the failed deletion's tombstone is all that
      // prevents the row from resurrecting after the retention window.
      expect(prodClient.syncTombstone.deleteMany).not.toHaveBeenCalled();
      expect(devClient.syncTombstone.deleteMany).not.toHaveBeenCalled();
      expect(result.warnings.some(w => w.includes('pruning skipped'))).toBe(true);
      expect(result.warnings.some(w => w.includes('personality_aliases'))).toBe(true);
      // Stats report the ACTUAL flush outcome (0 rows deleted — it failed),
      // not the scan-time candidate count (1) — the embed and the warning
      // must never disagree.
      expect(result.stats.personality_aliases.deleted).toBe(0);
    });

    it('should return stats for all tables in SYNC_TABLE_ORDER', async () => {
      devClient.$queryRawUnsafe.mockResolvedValue([]);
      prodClient.$queryRawUnsafe.mockResolvedValue([]);

      const result = await service.sync({ dryRun: true });

      // Every table in SYNC_TABLE_ORDER should have stats
      for (const tableName of SYNC_TABLE_ORDER) {
        expect(result.stats[tableName], `Stats missing for table "${tableName}"`).toBeDefined();
        expect(result.stats[tableName]).toHaveProperty('devToProd');
        expect(result.stats[tableName]).toHaveProperty('prodToDev');
        expect(result.stats[tableName]).toHaveProperty('conflicts');
      }
    });

    it('should handle composite primary keys correctly (personality_owners)', async () => {
      // personality_owners has composite PK: ['personality_id', 'user_id']
      const personalityId = '00000000-0000-5000-a000-000000000001';
      const userId = '00000000-0000-5000-a000-000000000002';
      const prodQueries: string[] = [];

      devClient.$queryRawUnsafe.mockImplementation(async query => {
        const queryStr = String(query);

        if (queryStr.includes('FROM "personality_owners"')) {
          return [
            {
              personality_id: personalityId,
              user_id: userId,
              created_at: new Date('2024-01-01'),
            },
          ];
        }
        return [];
      });

      prodClient.$queryRawUnsafe.mockResolvedValue([]);
      prodClient.$executeRawUnsafe.mockImplementation(async (query: unknown) => {
        prodQueries.push(String(query));
        return { count: 1 };
      });

      await service.sync({ dryRun: false });

      // Find the INSERT query for personality_owners
      const insertQuery = prodQueries.find(
        q => q.includes('INSERT') && q.includes('"personality_owners"')
      );
      expect(insertQuery).toBeDefined();

      // Verify the ON CONFLICT clause uses BOTH columns of the composite PK
      expect(insertQuery).toContain('"personality_id"');
      expect(insertQuery).toContain('"user_id"');
      expect(insertQuery).toContain('ON CONFLICT');
    });
  });
});
