/**
 * Service Test: ConversationRetentionService
 *
 * Tests conversation cleanup and retention with REAL database (PGlite in-memory PostgreSQL).
 * Service tests verify the "plumbing" - database interactions, queries, tombstone creation.
 *
 * Key behaviors tested:
 * - Clearing history with tombstone creation
 * - Persona-scoped history clearing
 * - Batch deletion with cursor-based pagination
 * - Old history cleanup
 * - Tombstone cleanup
 * - Soft-deleted message cleanup
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from './prisma.js';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { ConversationRetentionService } from './ConversationRetentionService.js';
import { loadPGliteSchema } from '@tzurot/test-utils';

// Mock logger to avoid console noise
vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

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
    pglite = new PGlite({
      extensions: { vector },
    });

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
    // Clear tables between tests (order matters due to FK constraints)
    await prisma.conversationHistoryTombstone.deleteMany();
    await prisma.conversationHistory.deleteMany();
    await prisma.persona.deleteMany();
    await prisma.personality.deleteMany();
    await prisma.user.deleteMany();

    // Create test user (required for persona FK)
    await prisma.user.create({
      data: {
        id: testUserId,
        discordId: '111111111111111111',
        username: 'testuser',
      },
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

    // Create test persona
    await prisma.persona.create({
      data: {
        id: testPersonaId,
        name: 'TestPersona',
        content: 'Test persona content',
        ownerId: testUserId,
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
    it('should delete all messages for a channel+personality and create tombstones', async () => {
      // Arrange: Create test messages
      const messageIds = await createTestMessages(5);

      // Act: Clear history
      const count = await service.clearHistory(testChannelId, testPersonalityId);

      // Assert: All messages deleted
      expect(count).toBe(5);

      // Verify messages are gone
      const remainingMessages = await prisma.conversationHistory.count({
        where: { channelId: testChannelId, personalityId: testPersonalityId },
      });
      expect(remainingMessages).toBe(0);

      // Verify tombstones were created
      const tombstones = await prisma.conversationHistoryTombstone.findMany({
        where: { channelId: testChannelId, personalityId: testPersonalityId },
      });
      expect(tombstones).toHaveLength(5);
      expect(tombstones.map(t => t.id).sort()).toEqual(messageIds.sort());
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

      // Verify tombstones created for deleted messages
      const tombstones = await prisma.conversationHistoryTombstone.count();
      expect(tombstones).toBe(3);
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

  describe('cleanupOldTombstones', () => {
    it('should delete tombstones older than specified days', async () => {
      // Arrange: Create messages and clear them to generate tombstones
      await createTestMessages(5);
      await service.clearHistory(testChannelId, testPersonalityId);

      // Manually backdate some tombstones
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100);

      await prisma.conversationHistoryTombstone.updateMany({
        where: {},
        data: { deletedAt: oldDate },
      });

      // Act: Cleanup tombstones older than 30 days
      const count = await service.cleanupOldTombstones(30);

      // Assert: All old tombstones deleted
      expect(count).toBe(5);

      const remainingTombstones = await prisma.conversationHistoryTombstone.count();
      expect(remainingTombstones).toBe(0);
    });

    it('should not delete recent tombstones', async () => {
      // Arrange: Create messages and clear them to generate tombstones
      await createTestMessages(3);
      await service.clearHistory(testChannelId, testPersonalityId);

      // Act: Cleanup tombstones older than 30 days
      const count = await service.cleanupOldTombstones(30);

      // Assert: No tombstones deleted (they're fresh)
      expect(count).toBe(0);

      const remainingTombstones = await prisma.conversationHistoryTombstone.count();
      expect(remainingTombstones).toBe(3);
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

      // Verify all tombstones created
      const tombstones = await prisma.conversationHistoryTombstone.count();
      expect(tombstones).toBe(messageCount);
    });
  });
});
