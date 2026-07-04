/**
 * Component Test: ConversationHistoryService
 *
 * Tests conversation history with REAL database (PGlite in-memory PostgreSQL).
 *
 * WHY THIS IS CRITICAL:
 * - The database schema undergoes extensive refactoring
 * - ConversationHistoryService is used by every AI interaction
 * - These tests catch breaking changes in conversation history patterns
 * - Ensures CRUD, pagination, and cleanup operations work with real DB
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import { ConversationHistoryService } from './ConversationHistoryService.js';
import { MessageRole } from '@tzurot/common-types/constants/message';
import { PrismaClient } from '@tzurot/common-types/services/prisma';

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

  // A row's id is a DETERMINISTIC UUID over (channelId, personalityId, personaId,
  // createdAt). When a loop inserts rows sharing the first three keys and lets
  // createdAt default to `new Date()`, two inserts in the same millisecond collide
  // on the id → `Unique constraint failed on (id)` (an intermittent CI flake). Seed a
  // strictly-increasing explicit timestamp per row so each id is deterministic AND
  // unique; the 1s spacing also pins the insertion order the assertions rely on.
  const seededTimestamp = (i: number): Date =>
    new Date(new Date('2026-06-01T00:00:00Z').getTime() + i * 1000);

  beforeAll(async () => {
    // Set up PGlite (in-memory Postgres via WASM) with pgvector extension
    // Note: PGlite initialization is CPU-intensive and may be slow when running
    // in parallel with other tests, hence the extended timeout
    pglite = createTestPGlite();

    // Load the complete schema from the shared schema file
    // This ensures integration tests stay in sync with migrations
    await pglite.exec(loadPGliteSchema());

    // Create Prisma adapter for PGlite
    const adapter = new PrismaPGlite(pglite);

    // Create Prisma client with PGlite adapter
    prisma = new PrismaClient({ adapter }) as PrismaClient;

    // Seed test data. users.default_persona_id is NOT NULL, so the user +
    // default persona must be created atomically (CTE helper).
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
      // Explicit strictly-increasing timestamps pin insertion order AND keep each
      // deterministic-UUID row distinct (relying on default `new Date()` is flaky:
      // sub-ms inserts can both tie the ordering and collide the id — see the
      // seededTimestamp note above).
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'First message',
        guildId: testGuildId,
        timestamp: seededTimestamp(0),
      });
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.Assistant,
        content: 'Second message',
        guildId: testGuildId,
        timestamp: seededTimestamp(1),
      });
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Third message',
        guildId: testGuildId,
        timestamp: seededTimestamp(2),
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
          timestamp: seededTimestamp(i),
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
          timestamp: seededTimestamp(i),
        });
      }

      // Get first page (2 items)
      const page1 = await service.getHistory(testChannelId, testPersonalityId, 2);
      expect(page1.messages).toHaveLength(2);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).toBeDefined();
    });

    it('should indicate no more pages when exhausted', async () => {
      // Add 2 messages (explicit timestamps so the same-key rows can't collide)
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Only message 1',
        guildId: testGuildId,
        timestamp: seededTimestamp(0),
      });
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Only message 2',
        guildId: testGuildId,
        timestamp: seededTimestamp(1),
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
          timestamp: seededTimestamp(i),
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

  describe('getChannelHistory with contextEpoch', () => {
    it('should filter out messages before epoch', async () => {
      // Explicit seeded timestamps (not real-clock + setTimeout): the epoch sits at
      // index 1, between the message at index 0 (before) and index 2 (after) — no
      // message coincides with it, and the same-key rows can't collide on their
      // deterministic UUID (see seededTimestamp note).
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Old message before epoch',
        guildId: testGuildId,
        timestamp: seededTimestamp(0),
      });
      const epochTime = seededTimestamp(1);
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'New message after epoch',
        guildId: testGuildId,
        timestamp: seededTimestamp(2),
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
        timestamp: seededTimestamp(0),
      });

      // Epoch well after the seeded message — deterministic, no real clock.
      const futureEpoch = seededTimestamp(100);

      const history = await service.getChannelHistory(testChannelId, 10, futureEpoch);
      expect(history).toEqual([]);
    });
  });

  describe('getHistory (paginated) with contextEpoch', () => {
    it('should filter paginated results by epoch', async () => {
      // Seeded timestamps: two "before" rows at indices 0,1 and two "after" rows at
      // 2,3. The epoch sits strictly BETWEEN index 1 and 2 (a message coincides with
      // index 1, so the boundary is t1+500ms — excludes "Before epoch 2", includes
      // "After epoch 1"). Deterministic + collision-free (see seededTimestamp note).
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Before epoch 1',
        guildId: testGuildId,
        timestamp: seededTimestamp(0),
      });
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Before epoch 2',
        guildId: testGuildId,
        timestamp: seededTimestamp(1),
      });

      const epochTime = new Date(seededTimestamp(1).getTime() + 500);

      // Add messages after epoch
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'After epoch 1',
        guildId: testGuildId,
        timestamp: seededTimestamp(2),
      });
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'After epoch 2',
        guildId: testGuildId,
        timestamp: seededTimestamp(3),
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
      // Add user messages (explicit distinct timestamps keep the three same-key
      // rows from colliding on their deterministic UUID — see seededTimestamp note)
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'User message 1',
        guildId: testGuildId,
        timestamp: seededTimestamp(0),
      });
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'User message 2',
        guildId: testGuildId,
        timestamp: seededTimestamp(1),
      });

      // Add assistant messages
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.Assistant,
        content: 'Assistant message 1',
        guildId: testGuildId,
        timestamp: seededTimestamp(2),
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
      // Seeded timestamps: two "before" rows at indices 0,1; the epoch sits strictly
      // between index 1 and 2 (t1+500ms); one "after" row at index 2. Deterministic +
      // collision-free for the same-key rows (see seededTimestamp note).
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Before epoch',
        guildId: testGuildId,
        timestamp: seededTimestamp(0),
      });
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.Assistant,
        content: 'Before epoch response',
        guildId: testGuildId,
        timestamp: seededTimestamp(1),
      });

      const epochTime = new Date(seededTimestamp(1).getTime() + 500);

      // Add messages after epoch
      await service.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'After epoch',
        guildId: testGuildId,
        timestamp: seededTimestamp(2),
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

      // Add 5 messages to other channel with strictly-increasing timestamps so the
      // "3 most recent" assertion is deterministic regardless of insert-time ties.
      const base = new Date('2026-01-01T00:00:00Z').getTime();
      for (let i = 0; i < 5; i++) {
        await service.addMessage({
          channelId: chOther,
          personalityId: testPersonalityId,
          personaId: testPersonaId,
          role: MessageRole.User,
          content: `Cross-channel message ${i}`,
          guildId: testGuildId,
          timestamp: new Date(base + i * 1000),
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

      // Explicit strictly-increasing timestamps: every chNewer message is newer than
      // every chOlder one, so the limit=3 cutoff deterministically keeps only chNewer.
      // Without this the inserts could share a timestamp and the cutoff would be arbitrary.
      const base = new Date('2026-01-01T00:00:00Z').getTime();

      // Add 2 older messages to chOlder
      for (let i = 0; i < 2; i++) {
        await service.addMessage({
          channelId: chOlder,
          personalityId: testPersonalityId,
          personaId: testPersonaId,
          role: MessageRole.User,
          content: `Channel 2 older ${i}`,
          guildId: testGuildId,
          timestamp: new Date(base + i * 1000),
        });
      }

      // Add 3 newer messages to chNewer (all strictly after the chOlder pair)
      for (let i = 0; i < 3; i++) {
        await service.addMessage({
          channelId: chNewer,
          personalityId: testPersonalityId,
          personaId: testPersonaId,
          role: MessageRole.User,
          content: `Channel 3 recent ${i}`,
          guildId: testGuildId,
          timestamp: new Date(base + 10_000 + i * 1000),
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

    it('should order groups by most recent activity (oldest activity first, newest last)', async () => {
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
      // Groups are sorted ASC by their newest message — so the channel whose
      // most-recent activity is older appears first, and the channel closest
      // in time to the current turn appears last (closest to current_conversation).
      expect(result[0].channelId).toBe(chOlder);
      expect(result[1].channelId).toBe(chNewer);
    });

    it('should return messages in chronological order within groups', async () => {
      const chExclude = 'cross-chrono-ch1';
      const chOther = 'cross-chrono-ch2';

      // Add messages in sequence — explicit distinct timestamps pin the order the
      // assertions below rely on AND keep the same-key rows' deterministic UUIDs
      // unique (see seededTimestamp note).
      await service.addMessage({
        channelId: chOther,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'First',
        guildId: testGuildId,
        timestamp: seededTimestamp(0),
      });
      await service.addMessage({
        channelId: chOther,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.Assistant,
        content: 'Second',
        guildId: testGuildId,
        timestamp: seededTimestamp(1),
      });
      await service.addMessage({
        channelId: chOther,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Third',
        guildId: testGuildId,
        timestamp: seededTimestamp(2),
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
});
