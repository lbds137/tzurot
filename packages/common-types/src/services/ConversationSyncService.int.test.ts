/**
 * Integration Test: ConversationSyncService
 *
 * Tests conversation sync operations with REAL database (PGlite in-memory PostgreSQL).
 *
 * WHY THIS IS CRITICAL:
 * - ConversationSyncService handles Discord/DB synchronization
 * - Tests verify soft delete, tombstone creation, and sync lookups
 * - Ensures edit detection and bulk operations work correctly
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from './prisma.js';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { loadPGliteSchema } from '@tzurot/test-utils';
import { ConversationSyncService } from './ConversationSyncService.js';
import { ConversationHistoryService } from './ConversationHistoryService.js';
import { MessageRole } from '../constants/index.js';

describe('ConversationSyncService Integration Test', () => {
  let prisma: PrismaClient;
  let pglite: PGlite;
  let syncService: ConversationSyncService;
  let historyService: ConversationHistoryService;

  // Test fixture IDs
  const testUserId = '00000000-0000-0000-0000-000000000001';
  const testPersonaId = '00000000-0000-0000-0000-000000000002';
  const testPersonalityId = '00000000-0000-0000-0000-000000000003';
  const testChannelId = '123456789012345678';
  const testGuildId = '987654321098765432';

  beforeAll(async () => {
    // Set up PGlite with pgvector extension (required by schema)
    pglite = new PGlite({
      extensions: { vector },
    });

    // Load and execute the pre-generated schema from Prisma
    const schemaSql = loadPGliteSchema();
    await pglite.exec(schemaSql);

    // Create Prisma adapter for PGlite
    const adapter = new PrismaPGlite(pglite);

    // Create Prisma client with PGlite adapter
    prisma = new PrismaClient({ adapter }) as PrismaClient;

    // Seed test data (explicit timestamps required - Prisma @updatedAt doesn't add SQL DEFAULT)
    const now = new Date().toISOString();
    const systemPromptId = '00000000-0000-0000-0000-000000000004';

    await prisma.$executeRawUnsafe(`
      INSERT INTO users (id, discord_id, username, updated_at)
      VALUES ('${testUserId}', '111111111111111111', 'testuser', '${now}')
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO personas (id, name, content, preferred_name, owner_id, updated_at)
      VALUES ('${testPersonaId}', 'Test Persona', 'A test persona', 'Tester', '${testUserId}', '${now}')
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO system_prompts (id, name, content, updated_at)
      VALUES ('${systemPromptId}', 'Test Prompt', 'You are a test bot.', '${now}')
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO personalities (id, name, slug, system_prompt_id, owner_id, character_info, personality_traits, updated_at)
      VALUES ('${testPersonalityId}', 'TestBot', 'testbot', '${systemPromptId}', '${testUserId}', 'Test bot', 'Helpful', '${now}')
    `);

    // Create service instances
    syncService = new ConversationSyncService(prisma);
    historyService = new ConversationHistoryService(prisma);
  }, 30000); // 30 second timeout for PGlite WASM initialization

  beforeEach(async () => {
    // Clear conversation history and tombstones between tests
    await prisma.$executeRawUnsafe(`DELETE FROM conversation_history_tombstones`);
    await prisma.$executeRawUnsafe(`DELETE FROM conversation_history`);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  }, 30000);

  describe('softDeleteMessage', () => {
    it('should soft delete a single message', async () => {
      // Add a message
      await historyService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Message to delete',
        guildId: testGuildId,
        discordMessageId: 'discord-123',
      });

      // Get the message ID
      const history = await historyService.getRecentHistory(testChannelId, testPersonalityId, 10);
      const messageId = history[0].id;

      // Soft delete
      const result = await syncService.softDeleteMessage(messageId);

      expect(result).toBe(true);

      // Verify message is soft deleted (deleted_at is set)
      const rows = await prisma.$queryRaw<{ deleted_at: Date | null }[]>`
        SELECT deleted_at FROM conversation_history WHERE id = ${messageId}::uuid
      `;
      expect(rows[0].deleted_at).not.toBeNull();
    });

    it('should return false for non-existent message', async () => {
      const result = await syncService.softDeleteMessage('00000000-0000-0000-0000-000000000099');
      expect(result).toBe(false);
    });
  });

  describe('softDeleteMessages', () => {
    it('should bulk soft delete messages with tombstones', async () => {
      // Add multiple messages
      await historyService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Message 1',
        guildId: testGuildId,
        discordMessageId: 'discord-1',
      });
      await historyService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.Assistant,
        content: 'Message 2',
        guildId: testGuildId,
        discordMessageId: 'discord-2',
      });

      // Get message IDs
      const history = await historyService.getRecentHistory(testChannelId, testPersonalityId, 10);
      const messageIds = history.map(h => h.id);

      // Bulk soft delete
      const result = await syncService.softDeleteMessages(messageIds);

      expect(result).toBe(2);

      // Verify messages are soft deleted
      const deletedRows = await prisma.$queryRaw<{ deleted_at: Date | null }[]>`
        SELECT deleted_at FROM conversation_history WHERE deleted_at IS NOT NULL
      `;
      expect(deletedRows).toHaveLength(2);

      // Verify tombstones created
      const tombstones = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM conversation_history_tombstones
      `;
      expect(tombstones).toHaveLength(2);
    });

    it('should return 0 for empty array', async () => {
      const result = await syncService.softDeleteMessages([]);
      expect(result).toBe(0);
    });
  });

  describe('updateMessageContent', () => {
    it('should update message content and editedAt timestamp', async () => {
      // Add a message
      await historyService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Original content',
        guildId: testGuildId,
        discordMessageId: 'discord-edit',
      });

      const history = await historyService.getRecentHistory(testChannelId, testPersonalityId, 10);
      const messageId = history[0].id;

      // Update content
      const newContent = 'Edited content with more text';
      const result = await syncService.updateMessageContent(messageId, newContent);

      expect(result).toBe(true);

      // Verify content updated
      const rows = await prisma.$queryRaw<{ content: string; edited_at: Date | null }[]>`
        SELECT content, edited_at FROM conversation_history WHERE id = ${messageId}::uuid
      `;
      expect(rows[0].content).toBe(newContent);
      expect(rows[0].edited_at).not.toBeNull();
    });

    it('should update token count when content changes', async () => {
      // Add a message
      await historyService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Short',
        guildId: testGuildId,
      });

      const history = await historyService.getRecentHistory(testChannelId, testPersonalityId, 10);
      const messageId = history[0].id;
      const originalTokens = history[0].tokenCount;

      // Update with longer content
      const longContent = 'This is a much longer piece of content with many more tokens';
      await syncService.updateMessageContent(messageId, longContent);

      const rows = await prisma.$queryRaw<{ token_count: number }[]>`
        SELECT token_count FROM conversation_history WHERE id = ${messageId}::uuid
      `;
      expect(rows[0].token_count).toBeGreaterThan(originalTokens!);
    });

    it('should return false for non-existent message', async () => {
      const result = await syncService.updateMessageContent(
        '00000000-0000-0000-0000-000000000099',
        'New content'
      );
      expect(result).toBe(false);
    });
  });

  describe('getMessagesByDiscordIds', () => {
    it('should return messages by Discord IDs', async () => {
      // Add messages with Discord IDs
      await historyService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'First message',
        guildId: testGuildId,
        discordMessageId: 'discord-aaa',
      });
      await historyService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Second message',
        guildId: testGuildId,
        discordMessageId: 'discord-bbb',
      });

      // Look up by Discord IDs
      const result = await syncService.getMessagesByDiscordIds(['discord-aaa', 'discord-bbb']);

      expect(result.size).toBe(2);
      expect(result.get('discord-aaa')?.content).toBe('First message');
      expect(result.get('discord-bbb')?.content).toBe('Second message');
    });

    it('should return empty map for non-existent Discord IDs', async () => {
      const result = await syncService.getMessagesByDiscordIds([
        'non-existent-1',
        'non-existent-2',
      ]);
      expect(result.size).toBe(0);
    });

    it('should return empty map for empty input', async () => {
      const result = await syncService.getMessagesByDiscordIds([]);
      expect(result.size).toBe(0);
    });

    it('should include soft-deleted messages', async () => {
      // Add a message
      await historyService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Soon to be deleted',
        guildId: testGuildId,
        discordMessageId: 'discord-deleted',
      });

      // Soft delete it
      const history = await historyService.getRecentHistory(testChannelId, testPersonalityId, 10);
      await syncService.softDeleteMessage(history[0].id);

      // Should still find it by Discord ID
      const result = await syncService.getMessagesByDiscordIds(['discord-deleted']);
      expect(result.size).toBe(1);
      expect(result.get('discord-deleted')?.deletedAt).not.toBeNull();
    });

    it('should filter by channelId when provided', async () => {
      // Add messages to different channels
      await historyService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Channel 1 message',
        guildId: testGuildId,
        discordMessageId: 'discord-ch1',
      });
      await historyService.addMessage({
        channelId: 'other-channel',
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Channel 2 message',
        guildId: testGuildId,
        discordMessageId: 'discord-ch2',
      });

      // Look up with channel filter
      const result = await syncService.getMessagesByDiscordIds(
        ['discord-ch1', 'discord-ch2'],
        testChannelId
      );

      expect(result.size).toBe(1);
      expect(result.get('discord-ch1')?.content).toBe('Channel 1 message');
    });
  });

  describe('getMessagesInTimeWindow', () => {
    it('should return messages within time window', async () => {
      const beforeTime = new Date();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Add messages after beforeTime
      await historyService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Recent message 1',
        guildId: testGuildId,
        discordMessageId: 'discord-recent-1',
      });
      await historyService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Recent message 2',
        guildId: testGuildId,
        discordMessageId: 'discord-recent-2',
      });

      const result = await syncService.getMessagesInTimeWindow(
        testChannelId,
        testPersonalityId,
        beforeTime
      );

      expect(result).toHaveLength(2);
      expect(result[0].discordMessageId).toContain('discord-recent-1');
      expect(result[1].discordMessageId).toContain('discord-recent-2');
    });

    it('should exclude soft-deleted messages', async () => {
      const beforeTime = new Date();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Add messages
      await historyService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Will be deleted',
        guildId: testGuildId,
        discordMessageId: 'discord-del',
      });
      await historyService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Will stay',
        guildId: testGuildId,
        discordMessageId: 'discord-stay',
      });

      // Soft delete first message
      const history = await historyService.getRecentHistory(testChannelId, testPersonalityId, 10);
      const deleteMsg = history.find(h => h.content === 'Will be deleted');
      await syncService.softDeleteMessage(deleteMsg!.id);

      // Query time window
      const result = await syncService.getMessagesInTimeWindow(
        testChannelId,
        testPersonalityId,
        beforeTime
      );

      expect(result).toHaveLength(1);
      expect(result[0].discordMessageId).toContain('discord-stay');
    });

    it('should exclude messages without Discord ID', async () => {
      const beforeTime = new Date();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Add message without Discord ID
      await historyService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'No Discord ID',
        guildId: testGuildId,
        // No discordMessageId
      });

      // Add message with Discord ID
      await historyService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Has Discord ID',
        guildId: testGuildId,
        discordMessageId: 'discord-has-id',
      });

      const result = await syncService.getMessagesInTimeWindow(
        testChannelId,
        testPersonalityId,
        beforeTime
      );

      expect(result).toHaveLength(1);
      expect(result[0].discordMessageId).toContain('discord-has-id');
    });

    it('should respect limit parameter', async () => {
      const beforeTime = new Date();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Add multiple messages
      for (let i = 0; i < 5; i++) {
        await historyService.addMessage({
          channelId: testChannelId,
          personalityId: testPersonalityId,
          personaId: testPersonaId,
          role: MessageRole.User,
          content: `Message ${i}`,
          guildId: testGuildId,
          discordMessageId: `discord-limit-${i}`,
        });
      }

      const result = await syncService.getMessagesInTimeWindow(
        testChannelId,
        testPersonalityId,
        beforeTime,
        3
      );

      expect(result).toHaveLength(3);
    });

    it('should return empty array for future time window', async () => {
      // Add a message
      await historyService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Old message',
        guildId: testGuildId,
        discordMessageId: 'discord-old',
      });

      const futureTime = new Date();
      futureTime.setDate(futureTime.getDate() + 1);

      const result = await syncService.getMessagesInTimeWindow(
        testChannelId,
        testPersonalityId,
        futureTime
      );

      expect(result).toHaveLength(0);
    });
  });
});
