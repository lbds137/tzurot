/**
 * Service Test: ConversationRetentionService
 *
 * Tests conversation cleanup and retention with REAL database (PGlite in-memory PostgreSQL).
 * Service tests verify the "plumbing" - database interactions and queries.
 *
 * Key behaviors tested:
 * - Clearing history for a channel + personality
 * - Persona-scoped history clearing
 * - Batch deletion with cursor-based pagination
 * - Old history cleanup
 * - Soft-deleted message cleanup
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { SYNC_LIMITS } from '@tzurot/common-types/constants/timing';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { ConversationRetentionService } from './ConversationRetentionService.js';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';

// Suppress logger noise — the service's createLogger comes from common-types
// (the old '../utils/logger.js' mock was a no-op: nothing imports that path).
vi.mock('@tzurot/common-types/utils/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/utils/logger')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});
describe('ConversationRetentionService', () => {
  let prisma: PrismaClient;
  let pglite: PGlite;
  let service: ConversationRetentionService;

  // Test fixture IDs (deterministic for reproducibility)
  const testUserId = '00000000-0000-0000-0000-000000000001';
  const testPersonalityId = '00000000-0000-0000-0000-000000000002';
  const testPersonaId = '00000000-0000-0000-0000-000000000003';
  const testChannelId = '123456789012345678';

  beforeAll(async () => {
    // Set up PGlite (in-memory Postgres via WASM) with pgvector extension
    pglite = createTestPGlite();

    // Load and execute the pre-generated schema
    const schemaSql = loadPGliteSchema();
    await pglite.exec(schemaSql);

    // Create Prisma adapter for PGlite
    const adapter = new PrismaPGlite(pglite);

    // Create Prisma client with PGlite adapter
    prisma = new PrismaClient({ adapter }) as PrismaClient;

    // Create service instance
    service = new ConversationRetentionService(prisma);
  }, 30000);

  beforeEach(async () => {
    // Clear tables between tests. Because of the Restrict FK on
    // users.default_persona_id we delete users FIRST — the Cascade on
    // persona.owner_id removes personas in the same statement.
    await prisma.conversationHistory.deleteMany();
    await prisma.personality.deleteMany();
    await prisma.user.deleteMany();

    // Create test user + default persona atomically (default_persona_id is NOT NULL).
    await seedUserWithPersona(prisma, {
      userId: testUserId,
      personaId: testPersonaId,
      discordId: '111111111111111111',
      username: 'testuser',
      personaName: 'TestPersona',
      personaContent: 'Test persona content',
    });

    // Create test personality (requires slug, ownerId, characterInfo, personalityTraits)
    await prisma.personality.create({
      data: {
        id: testPersonalityId,
        name: 'TestPersonality',
        slug: 'test-personality',
        ownerId: testUserId,
        characterInfo: 'A test personality for integration testing',
        personalityTraits: 'Helpful and deterministic',
      },
    });

    // Create fresh service instance
    service = new ConversationRetentionService(prisma);

    // Reset message counter for unique IDs
    messageCounter = 0;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  }, 30000);

  // Counter to ensure unique IDs across multiple calls
  let messageCounter = 0;

  // Helper to create conversation history entries
  async function createTestMessages(
    count: number,
    options: {
      channelId?: string;
      personalityId?: string;
      personaId?: string;
      createdAt?: Date;
      deletedAt?: Date | null;
    } = {}
  ): Promise<string[]> {
    const ids: string[] = [];
    const {
      channelId = testChannelId,
      personalityId = testPersonalityId,
      personaId = testPersonaId,
      createdAt = new Date(),
      deletedAt = null,
    } = options;

    for (let i = 0; i < count; i++) {
      const id = `00000000-0000-0000-0001-${String(messageCounter++).padStart(12, '0')}`;
      await prisma.conversationHistory.create({
        data: {
          id,
          channelId,
          personalityId,
          personaId,
          role: 'user',
          content: `Test message ${i}`,
          createdAt,
          deletedAt,
        },
      });
      ids.push(id);
    }
    return ids;
  }

  describe('clearHistory', () => {
    it('should delete all messages for a channel+personality', async () => {
      // Arrange: Create test messages
      await createTestMessages(5);

      // Act: Clear history
      const count = await service.clearHistory(testChannelId, testPersonalityId);

      // Assert: All messages deleted
      expect(count).toBe(5);

      // Verify messages are gone
      const remainingMessages = await prisma.conversationHistory.count({
        where: { channelId: testChannelId, personalityId: testPersonalityId },
      });
      expect(remainingMessages).toBe(0);
    });

    it('should only delete messages for specific persona when personaId provided', async () => {
      // Arrange: Create messages for two different personas
      const otherPersonaId = '00000000-0000-0000-0000-000000000099';
      await prisma.persona.create({
        data: {
          id: otherPersonaId,
          name: 'OtherPersona',
          content: 'Other persona content',
          ownerId: testUserId,
        },
      });

      await createTestMessages(3, { personaId: testPersonaId });
      await createTestMessages(2, { personaId: otherPersonaId });

      // Act: Clear history only for testPersonaId
      const count = await service.clearHistory(testChannelId, testPersonalityId, testPersonaId);

      // Assert: Only testPersonaId messages deleted
      expect(count).toBe(3);

      // Verify other persona's messages still exist
      const remainingMessages = await prisma.conversationHistory.count({
        where: { channelId: testChannelId, personaId: otherPersonaId },
      });
      expect(remainingMessages).toBe(2);
    });

    it('should return 0 when no messages to delete', async () => {
      const count = await service.clearHistory(testChannelId, testPersonalityId);
      expect(count).toBe(0);
    });
  });

  describe('cleanupOldHistory', () => {
    it('should delete messages older than specified days', async () => {
      // Arrange: Create old and new messages
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100); // 100 days ago

      await createTestMessages(3, { createdAt: oldDate });
      await createTestMessages(2, { createdAt: new Date() }); // Recent

      // Act: Cleanup messages older than 30 days
      const count = await service.cleanupOldHistory(30);

      // Assert: Only old messages deleted
      expect(count).toBe(3);

      // Verify recent messages still exist
      const remainingMessages = await prisma.conversationHistory.count();
      expect(remainingMessages).toBe(2);
    });

    it('should not delete messages within retention period', async () => {
      // Arrange: Create messages from 10 days ago
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 10);
      await createTestMessages(5, { createdAt: recentDate });

      // Act: Cleanup messages older than 30 days
      const count = await service.cleanupOldHistory(30);

      // Assert: No messages deleted
      expect(count).toBe(0);

      const remainingMessages = await prisma.conversationHistory.count();
      expect(remainingMessages).toBe(5);
    });
  });

  describe('cleanupSoftDeletedMessages', () => {
    it('should hard delete soft-deleted messages older than specified days', async () => {
      // Arrange: Create soft-deleted messages with old deletedAt
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100);

      await createTestMessages(4, { deletedAt: oldDate });
      await createTestMessages(2, { deletedAt: null }); // Not soft-deleted

      // Act: Cleanup soft-deleted messages older than 30 days
      const count = await service.cleanupSoftDeletedMessages(30);

      // Assert: Old soft-deleted messages hard deleted
      expect(count).toBe(4);

      // Verify non-soft-deleted messages still exist
      const remainingMessages = await prisma.conversationHistory.count();
      expect(remainingMessages).toBe(2);
    });

    it('should not delete recently soft-deleted messages', async () => {
      // Arrange: Create recently soft-deleted messages
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 5);

      await createTestMessages(3, { deletedAt: recentDate });

      // Act: Cleanup soft-deleted messages older than 30 days
      const count = await service.cleanupSoftDeletedMessages(30);

      // Assert: No messages deleted
      expect(count).toBe(0);

      const remainingMessages = await prisma.conversationHistory.count();
      expect(remainingMessages).toBe(3);
    });
  });

  describe('batch processing', () => {
    it('should handle large batch deletions with cursor-based pagination', async () => {
      // Arrange: Create more messages than batch size (RETENTION_BATCH_SIZE is 1000)
      // We'll use a smaller number for test speed but verify the count
      const messageCount = 25;
      await createTestMessages(messageCount);

      // Act: Clear all history
      const count = await service.clearHistory(testChannelId, testPersonalityId);

      // Assert: All messages deleted
      expect(count).toBe(messageCount);
    });
  });

  describe('mid-sweep failure (per-batch atomicity contract)', () => {
    /**
     * Wraps a real PrismaClient so the Nth `$transaction` call rejects.
     * All other members (including model delegates) pass through untouched,
     * so committed batches hit the real PGlite database.
     */
    function failNthTransaction(client: PrismaClient, failOn: number): PrismaClient {
      let calls = 0;
      return new Proxy(client, {
        get(target, prop, receiver): unknown {
          if (prop === '$transaction') {
            return (...args: unknown[]): Promise<unknown> => {
              calls += 1;
              if (calls === failOn) {
                return Promise.reject(new Error('simulated mid-sweep failure'));
              }
              return (target.$transaction as (...a: unknown[]) => Promise<unknown>).apply(
                target,
                args
              );
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as PrismaClient;
    }

    it('a batch-2 failure preserves batch 1 (deletes committed) and leaves the rest untouched', async () => {
      // The contract under test: atomicity is PER BATCH. A sweep that dies on
      // batch 2 must leave batch 1 fully committed (its rows deleted) while the
      // unswept remainder is untouched and a later retry can drain it. Unit
      // tests can't verify this: it's transaction-commit behavior, which needs a
      // real database. (Hard deletes are recorded for db-sync by the AFTER
      // DELETE sync_tombstone trigger; that propagation is covered by the
      // DatabaseSyncService sync tests, not here.)
      const BATCH = SYNC_LIMITS.RETENTION_BATCH_SIZE;
      const REMAINDER = 100;
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 40);

      // Bulk-seed BATCH + REMAINDER rows older than the 30-day cutoff.
      // (createMany, not the per-row helper — 1100 sequential creates is slow.)
      await prisma.conversationHistory.createMany({
        data: Array.from({ length: BATCH + REMAINDER }, (_, i) => ({
          id: `00000000-0000-0000-0002-${String(i).padStart(12, '0')}`,
          channelId: testChannelId,
          personalityId: testPersonalityId,
          personaId: testPersonaId,
          role: 'user',
          content: `Old message ${i}`,
          createdAt: oldDate,
        })),
      });

      const failingService = new ConversationRetentionService(failNthTransaction(prisma, 2));

      // The sweep dies on batch 2; the service rethrows.
      await expect(failingService.cleanupOldHistory(30)).rejects.toThrow(
        'simulated mid-sweep failure'
      );

      // Batch 1 (BATCH rows, ascending id order) committed: those rows are gone.
      // The REMAINDER rows survive untouched.
      const remaining = await prisma.conversationHistory.count();
      expect(remaining).toBe(REMAINDER);

      // Batch order is `id: 'asc'`, so the first un-swept row (id == BATCH) is
      // the boundary survivor — batch 1 (ids 0..BATCH-1) was deleted, the rest
      // remains for the retry to drain.
      const firstSurvivor = `00000000-0000-0000-0002-${String(BATCH).padStart(12, '0')}`;
      expect(await prisma.conversationHistory.count({ where: { id: firstSurvivor } })).toBe(1);

      // A retry with a healthy client drains the remainder — the partial
      // sweep is recoverable by construction.
      const retried = await service.cleanupOldHistory(30);
      expect(retried).toBe(REMAINDER);
      expect(await prisma.conversationHistory.count()).toBe(0);
    });
  });
});
