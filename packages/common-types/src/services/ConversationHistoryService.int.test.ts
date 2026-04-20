/**
 * Component Test: ConversationHistoryService
 *
 * Tests conversation history with REAL database (PGlite in-memory PostgreSQL).
 *
 * WHY THIS IS CRITICAL:
 * - Phase 1 will refactor the database schema extensively
 * - ConversationHistoryService is used by every AI interaction
 * - These tests catch breaking changes in conversation history patterns
 * - Ensures CRUD, pagination, and cleanup operations work with real DB
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from './prisma.js';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import { ConversationHistoryService } from './ConversationHistoryService.js';
import { ConversationRetentionService } from './ConversationRetentionService.js';
import { MessageRole } from '../constants/index.js';

describe('ConversationHistoryService Component Test', () => {
  let prisma: PrismaClient;
  let pglite: PGlite;
  let service: ConversationHistoryService;
  let retentionService: ConversationRetentionService;

  // Test fixture IDs
  const testUserId = '00000000-0000-0000-0000-000000000001';
  const testPersonaId = '00000000-0000-0000-0000-000000000002';
  const testPersonalityId = '00000000-0000-0000-0000-000000000003';
  const testChannelId = '123456789012345678';
  const testGuildId = '987654321098765432';

  beforeAll(async () => {
    // Set up PGlite (in-memory Postgres via WASM) with pgvector extension
    // Note: PGlite initialization is CPU-intensive and may be slow when running
    // in parallel with other tests, hence the extended timeout
    pglite = new PGlite({
      extensions: { vector, citext },
    });

    // Load the complete schema from the shared schema file
    // This ensures integration tests stay in sync with migrations
    await pglite.exec(loadPGliteSchema());

    // Create Prisma adapter for PGlite
    const adapter = new PrismaPGlite(pglite);

    // Create Prisma client with PGlite adapter
    prisma = new PrismaClient({ adapter }) as PrismaClient;

    // Seed test data. Phase 5b made users.default_persona_id NOT NULL, so
    // the user + default persona must be created atomically (CTE helper).
    await seedUserWithPersona(prisma, {
      userId: testUserId,
      personaId: testPersonaId,
      discordId: '111111111111111111',
      username: 'testuser',
      personaName: 'Test Persona',
      personaPreferredName: 'Tester',
      personaContent: 'A test persona',
    });

    const systemPromptId = '00000000-0000-0000-0000-000000000004';
    await prisma.$executeRawUnsafe(`
      INSERT INTO system_prompts (id, name, content, updated_at)
      VALUES ('${systemPromptId}', 'Test Prompt', 'You are a test bot.', NOW())
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO personalities (id, name, slug, system_prompt_id, character_info, personality_traits, owner_id, updated_at)
      VALUES ('${testPersonalityId}', 'TestBot', 'testbot', '${systemPromptId}', 'Test bot', 'Helpful', '${testUserId}', NOW())
    `);

    // Create service instances
    service = new ConversationHistoryService(prisma);
    retentionService = new ConversationRetentionService(prisma);
  }, 30000); // 30 second timeout for PGlite WASM initialization under parallel load

  beforeEach(async () => {
    // Clear conversation history between tests
    await prisma.$executeRawUnsafe(`DELETE FROM conversation_history`);
  });

  afterAll(async () => {
    // Cleanup: Disconnect Prisma and close PGlite
    await prisma.$disconnect();
    await pglite.close();
  }, 30000);

  describe('addMessage', () => {
    it('should add user message to database', async () => {
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Hello bot!',
        guildId: testGuildId,
      });

      const history = await service.getChannelHistory(testChannelId, 10);
      expect(history).toHaveLength(1);
      expect(history[0].role).toBe(MessageRole.User);
      expect(history[0].content).toBe('Hello bot!');
      expect(history[0].personaId).toBe(testPersonaId);
      expect(history[0].personaName).toBe('Tester'); // preferredName
    });

    it('should add assistant message to database', async () => {
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.Assistant,
        content: 'Hello human!',
        guildId: testGuildId,
      });

      const history = await service.getChannelHistory(testChannelId, 10);
      expect(history).toHaveLength(1);
      expect(history[0].role).toBe(MessageRole.Assistant);
      expect(history[0].content).toBe('Hello human!');
    });

    it('should add message with Discord message ID', async () => {
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Test message',
        guildId: testGuildId,
        discordMessageId: 'discord-msg-123',
      });

      const history = await service.getChannelHistory(testChannelId, 10);
      expect(history[0].discordMessageId).toEqual(['discord-msg-123']);
    });

    it('should add message with multiple Discord message IDs (chunked)', async () => {
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.Assistant,
        content: 'Long response that was chunked',
        guildId: testGuildId,
        discordMessageId: ['chunk-1', 'chunk-2', 'chunk-3'],
      });

      const history = await service.getChannelHistory(testChannelId, 10);
      expect(history[0].discordMessageId).toEqual(['chunk-1', 'chunk-2', 'chunk-3']);
    });

    it('should cache token count when adding message', async () => {
      const content = 'This is a test message with some tokens';
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content,
        guildId: testGuildId,
      });

      const history = await service.getChannelHistory(testChannelId, 10);
      expect(history[0].tokenCount).toBeDefined();
      expect(history[0].tokenCount).toBeGreaterThan(0);
    });

    it('should handle DM messages (null guildId)', async () => {
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'DM message',
        guildId: null, // DM = no guild
      });

      const history = await service.getChannelHistory(testChannelId, 10);
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe('DM message');
    });
  });

  describe('getChannelHistory', () => {
    it('should return messages in chronological order (oldest first)', async () => {
      // Sequential awaits ensure created_at timestamps preserve insertion order
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'First message',
        guildId: testGuildId,
      });
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.Assistant,
        content: 'Second message',
        guildId: testGuildId,
      });
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Third message',
        guildId: testGuildId,
      });

      const history = await service.getChannelHistory(testChannelId, 10);

      expect(history).toHaveLength(3);
      expect(history[0].content).toBe('First message');
      expect(history[1].content).toBe('Second message');
      expect(history[2].content).toBe('Third message');
    });

    it('should respect limit parameter', async () => {
      // Add 5 messages
      for (let i = 0; i < 5; i++) {
        await service.addMessage({
          channelId: testChannelId,
          personalityId: testPersonalityId,
          personaId: testPersonaId,
          role: MessageRole.User,
          content: `Message ${i}`,
          guildId: testGuildId,
        });
      }

      const history = await service.getChannelHistory(testChannelId, 3);

      expect(history).toHaveLength(3);
      // Should return the 3 most recent messages
      expect(history[0].content).toBe('Message 2');
      expect(history[1].content).toBe('Message 3');
      expect(history[2].content).toBe('Message 4');
    });

    it('should return empty array for non-existent channel', async () => {
      const history = await service.getChannelHistory('non-existent', 10);
      expect(history).toEqual([]);
    });

    it('should return all messages regardless of personality', async () => {
      // getChannelHistory does NOT filter by personalityId - it fetches ALL channel messages
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Message to TestBot',
        guildId: testGuildId,
      });

      const history = await service.getChannelHistory(testChannelId, 10);
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe('Message to TestBot');
    });
  });

  describe('getHistory (paginated)', () => {
    it('should return paginated results with cursor', async () => {
      // Add 5 messages
      for (let i = 0; i < 5; i++) {
        await service.addMessage({
          channelId: testChannelId,
          personalityId: testPersonalityId,
          personaId: testPersonaId,
          role: MessageRole.User,
          content: `Page message ${i}`,
          guildId: testGuildId,
        });
      }

      // Get first page (2 items)
      const page1 = await service.getHistory(testChannelId, testPersonalityId, 2);
      expect(page1.messages).toHaveLength(2);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).toBeDefined();
    });

    it('should indicate no more pages when exhausted', async () => {
      // Add 2 messages
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Only message 1',
        guildId: testGuildId,
      });
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Only message 2',
        guildId: testGuildId,
      });

      // Request more than exist
      const result = await service.getHistory(testChannelId, testPersonalityId, 10);
      expect(result.messages).toHaveLength(2);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeUndefined();
    });

    it('should enforce max limit of 100', async () => {
      // Add a few messages
      for (let i = 0; i < 5; i++) {
        await service.addMessage({
          channelId: testChannelId,
          personalityId: testPersonalityId,
          personaId: testPersonaId,
          role: MessageRole.User,
          content: `Limit test ${i}`,
          guildId: testGuildId,
        });
      }

      // Request more than max (200)
      const result = await service.getHistory(testChannelId, testPersonalityId, 200);
      // Should still work (internal limit enforcement)
      expect(result.messages.length).toBeLessThanOrEqual(100);
    });
  });

  describe('updateLastUserMessage', () => {
    it('should update content of last user message', async () => {
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Original content',
        guildId: testGuildId,
      });

      const success = await service.updateLastUserMessage(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        'Updated content with attachment description'
      );

      expect(success).toBe(true);

      const history = await service.getChannelHistory(testChannelId, 10);
      expect(history[0].content).toBe('Updated content with attachment description');
    });

    it('should return false when no user message exists', async () => {
      const success = await service.updateLastUserMessage(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        'Updated content'
      );

      expect(success).toBe(false);
    });

    it('should update token count when content changes', async () => {
      const shortContent = 'Short';
      const longContent = 'This is a much longer content with many more tokens than before';

      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: shortContent,
        guildId: testGuildId,
      });

      const historyBefore = await service.getChannelHistory(testChannelId, 10);
      const tokensBefore = historyBefore[0].tokenCount;

      await service.updateLastUserMessage(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        longContent
      );

      const historyAfter = await service.getChannelHistory(testChannelId, 10);
      const tokensAfter = historyAfter[0].tokenCount;

      expect(tokensAfter).toBeGreaterThan(tokensBefore!);
    });
  });

  describe('updateLastAssistantMessageId', () => {
    it('should update Discord message IDs for last assistant message', async () => {
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.Assistant,
        content: 'Bot response',
        guildId: testGuildId,
      });

      const success = await service.updateLastAssistantMessageId(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        ['discord-id-1', 'discord-id-2']
      );

      expect(success).toBe(true);

      const history = await service.getChannelHistory(testChannelId, 10);
      expect(history[0].discordMessageId).toEqual(['discord-id-1', 'discord-id-2']);
    });

    it('should return false when no assistant message exists', async () => {
      const success = await service.updateLastAssistantMessageId(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        ['discord-id']
      );

      expect(success).toBe(false);
    });
  });

  describe('getMessageByDiscordId', () => {
    it('should find message by Discord ID', async () => {
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Findable message',
        guildId: testGuildId,
        discordMessageId: 'unique-discord-id',
      });

      const message = await service.getMessageByDiscordId('unique-discord-id');

      expect(message).not.toBeNull();
      expect(message?.content).toBe('Findable message');
      expect(message?.discordMessageId).toContain('unique-discord-id');
    });

    it('should return null for non-existent Discord ID', async () => {
      const message = await service.getMessageByDiscordId('non-existent-id');
      expect(message).toBeNull();
    });

    it('should find message when ID is in array of chunked IDs', async () => {
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.Assistant,
        content: 'Chunked response',
        guildId: testGuildId,
        discordMessageId: ['chunk-a', 'chunk-b', 'chunk-c'],
      });

      // Should find by any chunk ID
      const message = await service.getMessageByDiscordId('chunk-b');

      expect(message).not.toBeNull();
      expect(message?.content).toBe('Chunked response');
    });
  });

  describe('clearHistory (via RetentionService)', () => {
    it('should clear all messages for channel + personality', async () => {
      // Add messages
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Message 1',
        guildId: testGuildId,
      });
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.Assistant,
        content: 'Message 2',
        guildId: testGuildId,
      });

      const deletedCount = await retentionService.clearHistory(testChannelId, testPersonalityId);

      expect(deletedCount).toBe(2);

      const history = await service.getChannelHistory(testChannelId, 10);
      expect(history).toEqual([]);
    });

    it('should return 0 when no messages to clear', async () => {
      const deletedCount = await retentionService.clearHistory('empty-channel', testPersonalityId);
      expect(deletedCount).toBe(0);
    });
  });

  describe('getChannelHistory with contextEpoch', () => {
    it('should filter out messages before epoch', async () => {
      // Add first message
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Old message before epoch',
        guildId: testGuildId,
      });

      // Wait a bit to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 50));
      const epochTime = new Date();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Add second message after epoch
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'New message after epoch',
        guildId: testGuildId,
      });

      // Without epoch - should see both
      const allHistory = await service.getChannelHistory(testChannelId, 10);
      expect(allHistory).toHaveLength(2);

      // With epoch - should only see message after epoch
      const filteredHistory = await service.getChannelHistory(testChannelId, 10, epochTime);
      expect(filteredHistory).toHaveLength(1);
      expect(filteredHistory[0].content).toBe('New message after epoch');
    });

    it('should return empty array when all messages are before epoch', async () => {
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Old message',
        guildId: testGuildId,
      });

      // Set epoch to future
      const futureEpoch = new Date();
      futureEpoch.setDate(futureEpoch.getDate() + 1);

      const history = await service.getChannelHistory(testChannelId, 10, futureEpoch);
      expect(history).toEqual([]);
    });
  });

  describe('getHistory (paginated) with contextEpoch', () => {
    it('should filter paginated results by epoch', async () => {
      // Add messages before epoch
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Before epoch 1',
        guildId: testGuildId,
      });
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Before epoch 2',
        guildId: testGuildId,
      });

      await new Promise(resolve => setTimeout(resolve, 50));
      const epochTime = new Date();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Add messages after epoch
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'After epoch 1',
        guildId: testGuildId,
      });
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'After epoch 2',
        guildId: testGuildId,
      });

      // Without epoch - should see all 4
      const allResult = await service.getHistory(testChannelId, testPersonalityId, 10);
      expect(allResult.messages).toHaveLength(4);

      // With epoch - should only see 2 messages after epoch
      const filteredResult = await service.getHistory(
        testChannelId,
        testPersonalityId,
        10,
        undefined,
        epochTime
      );
      expect(filteredResult.messages).toHaveLength(2);
      expect(filteredResult.messages[0].content).toBe('After epoch 1');
      expect(filteredResult.messages[1].content).toBe('After epoch 2');
    });
  });

  describe('getHistoryStats', () => {
    it('should return correct message counts', async () => {
      // Add user messages
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'User message 1',
        guildId: testGuildId,
      });
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'User message 2',
        guildId: testGuildId,
      });

      // Add assistant messages
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.Assistant,
        content: 'Assistant message 1',
        guildId: testGuildId,
      });

      const stats = await service.getHistoryStats(testChannelId, testPersonalityId);

      expect(stats.totalMessages).toBe(3);
      expect(stats.userMessages).toBe(2);
      expect(stats.assistantMessages).toBe(1);
      expect(stats.oldestMessage).toBeDefined();
      expect(stats.newestMessage).toBeDefined();
    });

    it('should return zeros for empty channel', async () => {
      const stats = await service.getHistoryStats('empty-channel', testPersonalityId);

      expect(stats.totalMessages).toBe(0);
      expect(stats.userMessages).toBe(0);
      expect(stats.assistantMessages).toBe(0);
      expect(stats.oldestMessage).toBeUndefined();
      expect(stats.newestMessage).toBeUndefined();
    });

    it('should filter stats by epoch', async () => {
      // Add messages before epoch
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Before epoch',
        guildId: testGuildId,
      });
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.Assistant,
        content: 'Before epoch response',
        guildId: testGuildId,
      });

      await new Promise(resolve => setTimeout(resolve, 50));
      const epochTime = new Date();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Add messages after epoch
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'After epoch',
        guildId: testGuildId,
      });

      // Stats without epoch
      const allStats = await service.getHistoryStats(testChannelId, testPersonalityId);
      expect(allStats.totalMessages).toBe(3);

      // Stats with epoch - should only count message after epoch
      const filteredStats = await service.getHistoryStats(
        testChannelId,
        testPersonalityId,
        epochTime
      );
      expect(filteredStats.totalMessages).toBe(1);
      expect(filteredStats.userMessages).toBe(1);
      expect(filteredStats.assistantMessages).toBe(0);
    });
  });

  describe('getCrossChannelHistory', () => {
    it('should return messages from other channels, excluding specified channel', async () => {
      const ch1 = 'cross-basic-ch1';
      const ch2 = 'cross-basic-ch2';
      const ch3 = 'cross-basic-ch3';

      await service.addMessage({
        channelId: ch1,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Current channel message',
        guildId: testGuildId,
      });
      await service.addMessage({
        channelId: ch2,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Other channel message',
        guildId: testGuildId,
      });
      await service.addMessage({
        channelId: ch3,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Third channel message',
        guildId: testGuildId,
      });

      const result = await service.getCrossChannelHistory(
        testPersonaId,
        testPersonalityId,
        ch1, // exclude current channel
        50
      );

      expect(result).toHaveLength(2);
      const allChannelIds = result.map(g => g.channelId);
      expect(allChannelIds).toContain(ch2);
      expect(allChannelIds).toContain(ch3);
      expect(allChannelIds).not.toContain(ch1);
    });

    it('should exclude soft-deleted messages', async () => {
      const chExclude = 'cross-deleted-ch1';
      const chOther = 'cross-deleted-ch2';

      await service.addMessage({
        channelId: chOther,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Active message',
        guildId: testGuildId,
      });

      // Insert a soft-deleted message directly
      const deletedMsgId = '00000000-0000-0000-0000-000000000098';
      await prisma.$executeRaw`
        INSERT INTO conversation_history
        (id, channel_id, guild_id, personality_id, persona_id, role, content, deleted_at, created_at)
        VALUES (${deletedMsgId}, ${chOther}, ${testGuildId}, ${testPersonalityId}, ${testPersonaId}, 'user', 'Deleted message', NOW(), NOW())
      `;

      const result = await service.getCrossChannelHistory(
        testPersonaId,
        testPersonalityId,
        chExclude,
        50
      );

      expect(result).toHaveLength(1);
      expect(result[0].messages).toHaveLength(1);
      expect(result[0].messages[0].content).toBe('Active message');
    });

    it('should respect limit parameter', async () => {
      const chExclude = 'cross-limit-ch1';
      const chOther = 'cross-limit-ch2';

      // Add 5 messages to other channel
      for (let i = 0; i < 5; i++) {
        await service.addMessage({
          channelId: chOther,
          personalityId: testPersonalityId,
          personaId: testPersonaId,
          role: MessageRole.User,
          content: `Cross-channel message ${i}`,
          guildId: testGuildId,
        });
      }

      const result = await service.getCrossChannelHistory(
        testPersonaId,
        testPersonalityId,
        chExclude,
        3 // Only get 3 messages
      );

      expect(result).toHaveLength(1);
      expect(result[0].messages).toHaveLength(3);
      // Should get the 3 most recent messages (reversed to chronological)
      expect(result[0].messages[0].content).toBe('Cross-channel message 2');
      expect(result[0].messages[1].content).toBe('Cross-channel message 3');
      expect(result[0].messages[2].content).toBe('Cross-channel message 4');
    });

    it('should exclude older channels when limit is smaller than total messages', async () => {
      const chExclude = 'cross-exclude-ch1';
      const chOlder = 'cross-exclude-ch2';
      const chNewer = 'cross-exclude-ch3';

      // Add 2 older messages to chOlder
      for (let i = 0; i < 2; i++) {
        await service.addMessage({
          channelId: chOlder,
          personalityId: testPersonalityId,
          personaId: testPersonaId,
          role: MessageRole.User,
          content: `Channel 2 older ${i}`,
          guildId: testGuildId,
        });
      }

      // Add 3 newer messages to chNewer
      for (let i = 0; i < 3; i++) {
        await service.addMessage({
          channelId: chNewer,
          personalityId: testPersonalityId,
          personaId: testPersonaId,
          role: MessageRole.User,
          content: `Channel 3 recent ${i}`,
          guildId: testGuildId,
        });
      }

      // Limit = 3: all 3 most recent are from chNewer, so chOlder is absent
      const result = await service.getCrossChannelHistory(
        testPersonaId,
        testPersonalityId,
        chExclude,
        3
      );

      expect(result).toHaveLength(1);
      expect(result[0].channelId).toBe(chNewer);
    });

    it('should order groups by most recent activity', async () => {
      const chExclude = 'cross-order-ch1';
      const chOlder = 'cross-order-ch2';
      const chNewer = 'cross-order-ch3';

      // Add older message to chOlder
      await service.addMessage({
        channelId: chOlder,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Older channel 2 message',
        guildId: testGuildId,
      });

      // Add newer message to chNewer
      await service.addMessage({
        channelId: chNewer,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Newer channel 3 message',
        guildId: testGuildId,
      });

      const result = await service.getCrossChannelHistory(
        testPersonaId,
        testPersonalityId,
        chExclude,
        50
      );

      expect(result).toHaveLength(2);
      // chNewer has more recent activity, so it appears first
      expect(result[0].channelId).toBe(chNewer);
      expect(result[1].channelId).toBe(chOlder);
    });

    it('should return messages in chronological order within groups', async () => {
      const chExclude = 'cross-chrono-ch1';
      const chOther = 'cross-chrono-ch2';

      // Add messages in sequence
      await service.addMessage({
        channelId: chOther,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'First',
        guildId: testGuildId,
      });
      await service.addMessage({
        channelId: chOther,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.Assistant,
        content: 'Second',
        guildId: testGuildId,
      });
      await service.addMessage({
        channelId: chOther,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Third',
        guildId: testGuildId,
      });

      const result = await service.getCrossChannelHistory(
        testPersonaId,
        testPersonalityId,
        chExclude,
        50
      );

      expect(result).toHaveLength(1);
      expect(result[0].messages).toHaveLength(3);
      expect(result[0].messages[0].content).toBe('First');
      expect(result[0].messages[1].content).toBe('Second');
      expect(result[0].messages[2].content).toBe('Third');
    });

    it('should handle DM channels with null guildId', async () => {
      const chExclude = 'cross-dm-ch1';
      const chDM = 'cross-dm-ch2';

      await service.addMessage({
        channelId: chDM,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'DM message',
        guildId: null, // DM
      });

      const result = await service.getCrossChannelHistory(
        testPersonaId,
        testPersonalityId,
        chExclude,
        50
      );

      expect(result).toHaveLength(1);
      expect(result[0].channelId).toBe(chDM);
      expect(result[0].guildId).toBeNull();
    });

    it('should return empty when all messages are in excluded channel', async () => {
      const chExclude = 'cross-empty-ch1';

      await service.addMessage({
        channelId: chExclude,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Only in current channel',
        guildId: testGuildId,
      });

      const result = await service.getCrossChannelHistory(
        testPersonaId,
        testPersonalityId,
        chExclude,
        50
      );

      expect(result).toEqual([]);
    });
  });

  describe('cleanupOldHistory (via RetentionService)', () => {
    it('should delete messages older than specified days', async () => {
      // Add a message with explicit old timestamp
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 40); // 40 days ago

      // Insert directly with old timestamp (need explicit id for schema constraints)
      const oldMessageId = '00000000-0000-0000-0000-000000000099';
      await prisma.$executeRawUnsafe(`
        INSERT INTO conversation_history
        (id, channel_id, guild_id, personality_id, persona_id, role, content, created_at)
        VALUES ('${oldMessageId}', '${testChannelId}', '${testGuildId}', '${testPersonalityId}', '${testPersonaId}', 'user', 'Old message', '${oldDate.toISOString()}')
      `);

      // Add a recent message
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Recent message',
        guildId: testGuildId,
      });

      // Cleanup messages older than 30 days
      const deletedCount = await retentionService.cleanupOldHistory(30);

      expect(deletedCount).toBe(1);

      // Recent message should still exist
      const history = await service.getChannelHistory(testChannelId, 10);
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe('Recent message');
    });

    it('should not delete recent messages', async () => {
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Fresh message',
        guildId: testGuildId,
      });

      const deletedCount = await retentionService.cleanupOldHistory(30);

      expect(deletedCount).toBe(0);

      const history = await service.getChannelHistory(testChannelId, 10);
      expect(history).toHaveLength(1);
    });
  });
});
