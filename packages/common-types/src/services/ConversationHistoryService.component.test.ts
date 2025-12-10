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
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { ConversationHistoryService } from './ConversationHistoryService.js';
import { MessageRole } from '../constants/index.js';

describe('ConversationHistoryService Component Test', () => {
  let prisma: PrismaClient;
  let pglite: PGlite;
  let service: ConversationHistoryService;

  // Test fixture IDs
  const testUserId = '00000000-0000-0000-0000-000000000001';
  const testPersonaId = '00000000-0000-0000-0000-000000000002';
  const testPersonalityId = '00000000-0000-0000-0000-000000000003';
  const testChannelId = '123456789012345678';
  const testGuildId = '987654321098765432';

  beforeAll(async () => {
    // Set up PGlite (in-memory Postgres via WASM)
    // Note: PGlite initialization is CPU-intensive and may be slow when running
    // in parallel with other tests, hence the extended timeout
    pglite = new PGlite();

    // Create Prisma adapter for PGlite
    const adapter = new PrismaPGlite(pglite);

    // Create Prisma client with PGlite adapter
    prisma = new PrismaClient({ adapter }) as PrismaClient;

    // Create tables in dependency order
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        discord_id VARCHAR(20) UNIQUE NOT NULL,
        username VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS personas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        content TEXT NOT NULL,
        preferred_name VARCHAR(255),
        pronouns VARCHAR(100),
        owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS system_prompts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        content TEXT NOT NULL,
        is_default BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS personalities (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        display_name VARCHAR(255),
        slug VARCHAR(255) UNIQUE NOT NULL,
        system_prompt_id UUID REFERENCES system_prompts(id),
        character_info TEXT NOT NULL,
        personality_traits TEXT NOT NULL,
        personality_tone TEXT,
        personality_age TEXT,
        personality_appearance TEXT,
        personality_likes TEXT,
        personality_dislikes TEXT,
        conversational_goals TEXT,
        conversational_examples TEXT,
        custom_fields JSONB,
        voice_enabled BOOLEAN DEFAULT FALSE,
        voice_settings JSONB,
        image_enabled BOOLEAN DEFAULT FALSE,
        image_settings JSONB,
        avatar_data BYTEA,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS conversation_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        channel_id VARCHAR(20) NOT NULL,
        guild_id VARCHAR(20),
        personality_id UUID NOT NULL REFERENCES personalities(id) ON DELETE CASCADE,
        persona_id UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        token_count INTEGER,
        discord_message_id TEXT[] DEFAULT '{}',
        message_metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Seed test data
    await prisma.$executeRawUnsafe(`
      INSERT INTO users (id, discord_id, username)
      VALUES ('${testUserId}', '111111111111111111', 'testuser')
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO personas (id, name, content, preferred_name, owner_id)
      VALUES ('${testPersonaId}', 'Test Persona', 'A test persona', 'Tester', '${testUserId}')
    `);

    const systemPromptId = '00000000-0000-0000-0000-000000000004';
    await prisma.$executeRawUnsafe(`
      INSERT INTO system_prompts (id, name, content)
      VALUES ('${systemPromptId}', 'Test Prompt', 'You are a test bot.')
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO personalities (id, name, slug, system_prompt_id, character_info, personality_traits)
      VALUES ('${testPersonalityId}', 'TestBot', 'testbot', '${systemPromptId}', 'Test bot', 'Helpful')
    `);

    // Create service instance
    service = new ConversationHistoryService(prisma);
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
      await service.addMessage(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        MessageRole.User,
        'Hello bot!',
        testGuildId
      );

      const history = await service.getRecentHistory(testChannelId, testPersonalityId, 10);
      expect(history).toHaveLength(1);
      expect(history[0].role).toBe(MessageRole.User);
      expect(history[0].content).toBe('Hello bot!');
      expect(history[0].personaId).toBe(testPersonaId);
      expect(history[0].personaName).toBe('Tester'); // preferredName
    });

    it('should add assistant message to database', async () => {
      await service.addMessage(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        MessageRole.Assistant,
        'Hello human!',
        testGuildId
      );

      const history = await service.getRecentHistory(testChannelId, testPersonalityId, 10);
      expect(history).toHaveLength(1);
      expect(history[0].role).toBe(MessageRole.Assistant);
      expect(history[0].content).toBe('Hello human!');
    });

    it('should add message with Discord message ID', async () => {
      await service.addMessage(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        MessageRole.User,
        'Test message',
        testGuildId,
        'discord-msg-123'
      );

      const history = await service.getRecentHistory(testChannelId, testPersonalityId, 10);
      expect(history[0].discordMessageId).toEqual(['discord-msg-123']);
    });

    it('should add message with multiple Discord message IDs (chunked)', async () => {
      await service.addMessage(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        MessageRole.Assistant,
        'Long response that was chunked',
        testGuildId,
        ['chunk-1', 'chunk-2', 'chunk-3']
      );

      const history = await service.getRecentHistory(testChannelId, testPersonalityId, 10);
      expect(history[0].discordMessageId).toEqual(['chunk-1', 'chunk-2', 'chunk-3']);
    });

    it('should cache token count when adding message', async () => {
      const content = 'This is a test message with some tokens';
      await service.addMessage(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        MessageRole.User,
        content,
        testGuildId
      );

      const history = await service.getRecentHistory(testChannelId, testPersonalityId, 10);
      expect(history[0].tokenCount).toBeDefined();
      expect(history[0].tokenCount).toBeGreaterThan(0);
    });

    it('should handle DM messages (null guildId)', async () => {
      await service.addMessage(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        MessageRole.User,
        'DM message',
        null // DM = no guild
      );

      const history = await service.getRecentHistory(testChannelId, testPersonalityId, 10);
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe('DM message');
    });
  });

  describe('getRecentHistory', () => {
    it('should return messages in chronological order (oldest first)', async () => {
      // Sequential awaits ensure created_at timestamps preserve insertion order
      await service.addMessage(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        MessageRole.User,
        'First message',
        testGuildId
      );
      await service.addMessage(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        MessageRole.Assistant,
        'Second message',
        testGuildId
      );
      await service.addMessage(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        MessageRole.User,
        'Third message',
        testGuildId
      );

      const history = await service.getRecentHistory(testChannelId, testPersonalityId, 10);

      expect(history).toHaveLength(3);
      expect(history[0].content).toBe('First message');
      expect(history[1].content).toBe('Second message');
      expect(history[2].content).toBe('Third message');
    });

    it('should respect limit parameter', async () => {
      // Add 5 messages
      for (let i = 0; i < 5; i++) {
        await service.addMessage(
          testChannelId,
          testPersonalityId,
          testPersonaId,
          MessageRole.User,
          `Message ${i}`,
          testGuildId
        );
      }

      const history = await service.getRecentHistory(testChannelId, testPersonalityId, 3);

      expect(history).toHaveLength(3);
      // Should return the 3 most recent messages
      expect(history[0].content).toBe('Message 2');
      expect(history[1].content).toBe('Message 3');
      expect(history[2].content).toBe('Message 4');
    });

    it('should return empty array for non-existent channel', async () => {
      const history = await service.getRecentHistory('non-existent', testPersonalityId, 10);
      expect(history).toEqual([]);
    });

    it('should filter by personality', async () => {
      // This test requires another personality, but we can test that the filter works
      // by ensuring we only get messages for the specified personality
      await service.addMessage(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        MessageRole.User,
        'Message to TestBot',
        testGuildId
      );

      const history = await service.getRecentHistory(testChannelId, testPersonalityId, 10);
      expect(history).toHaveLength(1);

      // Different personality ID should return empty
      const otherHistory = await service.getRecentHistory(
        testChannelId,
        '00000000-0000-0000-0000-000000000099',
        10
      );
      expect(otherHistory).toEqual([]);
    });
  });

  describe('getHistory (paginated)', () => {
    it('should return paginated results with cursor', async () => {
      // Add 5 messages
      for (let i = 0; i < 5; i++) {
        await service.addMessage(
          testChannelId,
          testPersonalityId,
          testPersonaId,
          MessageRole.User,
          `Page message ${i}`,
          testGuildId
        );
      }

      // Get first page (2 items)
      const page1 = await service.getHistory(testChannelId, testPersonalityId, 2);
      expect(page1.messages).toHaveLength(2);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).toBeDefined();
    });

    it('should indicate no more pages when exhausted', async () => {
      // Add 2 messages
      await service.addMessage(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        MessageRole.User,
        'Only message 1',
        testGuildId
      );
      await service.addMessage(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        MessageRole.User,
        'Only message 2',
        testGuildId
      );

      // Request more than exist
      const result = await service.getHistory(testChannelId, testPersonalityId, 10);
      expect(result.messages).toHaveLength(2);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeUndefined();
    });

    it('should enforce max limit of 100', async () => {
      // Add a few messages
      for (let i = 0; i < 5; i++) {
        await service.addMessage(
          testChannelId,
          testPersonalityId,
          testPersonaId,
          MessageRole.User,
          `Limit test ${i}`,
          testGuildId
        );
      }

      // Request more than max (200)
      const result = await service.getHistory(testChannelId, testPersonalityId, 200);
      // Should still work (internal limit enforcement)
      expect(result.messages.length).toBeLessThanOrEqual(100);
    });
  });

  describe('updateLastUserMessage', () => {
    it('should update content of last user message', async () => {
      await service.addMessage(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        MessageRole.User,
        'Original content',
        testGuildId
      );

      const success = await service.updateLastUserMessage(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        'Updated content with attachment description'
      );

      expect(success).toBe(true);

      const history = await service.getRecentHistory(testChannelId, testPersonalityId, 10);
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

      await service.addMessage(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        MessageRole.User,
        shortContent,
        testGuildId
      );

      const historyBefore = await service.getRecentHistory(testChannelId, testPersonalityId, 10);
      const tokensBefore = historyBefore[0].tokenCount;

      await service.updateLastUserMessage(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        longContent
      );

      const historyAfter = await service.getRecentHistory(testChannelId, testPersonalityId, 10);
      const tokensAfter = historyAfter[0].tokenCount;

      expect(tokensAfter).toBeGreaterThan(tokensBefore!);
    });
  });

  describe('updateLastAssistantMessageId', () => {
    it('should update Discord message IDs for last assistant message', async () => {
      await service.addMessage(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        MessageRole.Assistant,
        'Bot response',
        testGuildId
      );

      const success = await service.updateLastAssistantMessageId(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        ['discord-id-1', 'discord-id-2']
      );

      expect(success).toBe(true);

      const history = await service.getRecentHistory(testChannelId, testPersonalityId, 10);
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
      await service.addMessage(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        MessageRole.User,
        'Findable message',
        testGuildId,
        'unique-discord-id'
      );

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
      await service.addMessage(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        MessageRole.Assistant,
        'Chunked response',
        testGuildId,
        ['chunk-a', 'chunk-b', 'chunk-c']
      );

      // Should find by any chunk ID
      const message = await service.getMessageByDiscordId('chunk-b');

      expect(message).not.toBeNull();
      expect(message?.content).toBe('Chunked response');
    });
  });

  describe('clearHistory', () => {
    it('should clear all messages for channel + personality', async () => {
      // Add messages
      await service.addMessage(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        MessageRole.User,
        'Message 1',
        testGuildId
      );
      await service.addMessage(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        MessageRole.Assistant,
        'Message 2',
        testGuildId
      );

      const deletedCount = await service.clearHistory(testChannelId, testPersonalityId);

      expect(deletedCount).toBe(2);

      const history = await service.getRecentHistory(testChannelId, testPersonalityId, 10);
      expect(history).toEqual([]);
    });

    it('should return 0 when no messages to clear', async () => {
      const deletedCount = await service.clearHistory('empty-channel', testPersonalityId);
      expect(deletedCount).toBe(0);
    });
  });

  describe('cleanupOldHistory', () => {
    it('should delete messages older than specified days', async () => {
      // Add a message with explicit old timestamp
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 40); // 40 days ago

      // Insert directly with old timestamp
      await prisma.$executeRawUnsafe(`
        INSERT INTO conversation_history
        (channel_id, guild_id, personality_id, persona_id, role, content, created_at)
        VALUES ('${testChannelId}', '${testGuildId}', '${testPersonalityId}', '${testPersonaId}', 'user', 'Old message', '${oldDate.toISOString()}')
      `);

      // Add a recent message
      await service.addMessage(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        MessageRole.User,
        'Recent message',
        testGuildId
      );

      // Cleanup messages older than 30 days
      const deletedCount = await service.cleanupOldHistory(30);

      expect(deletedCount).toBe(1);

      // Recent message should still exist
      const history = await service.getRecentHistory(testChannelId, testPersonalityId, 10);
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe('Recent message');
    });

    it('should not delete recent messages', async () => {
      await service.addMessage(
        testChannelId,
        testPersonalityId,
        testPersonaId,
        MessageRole.User,
        'Fresh message',
        testGuildId
      );

      const deletedCount = await service.cleanupOldHistory(30);

      expect(deletedCount).toBe(0);

      const history = await service.getRecentHistory(testChannelId, testPersonalityId, 10);
      expect(history).toHaveLength(1);
    });
  });
});
