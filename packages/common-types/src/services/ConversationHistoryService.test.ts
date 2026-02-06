/**
 * Tests for ConversationHistoryService - Token Count Caching
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from './prisma.js';
import { ConversationHistoryService } from './ConversationHistoryService.js';
import { MessageRole } from '../constants/index.js';
import * as tokenCounter from '../utils/tokenCounter.js';

// Create mock Prisma client
const createMockPrismaClient = () => {
  const client = {
    conversationHistory: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    conversationHistoryTombstone: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    // $transaction executes the callback with the mock client as the transaction
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      return callback(client);
    }),
  };
  return client;
};

describe('ConversationHistoryService - Token Count Caching', () => {
  let service: ConversationHistoryService;
  let mockPrismaClient: ReturnType<typeof createMockPrismaClient>;

  beforeEach(() => {
    // Clear mocks from previous tests
    vi.clearAllMocks();
    // Create fresh mocks for each test
    mockPrismaClient = createMockPrismaClient();
    service = new ConversationHistoryService(mockPrismaClient as unknown as PrismaClient);
    // Create fresh spy for each test
    vi.spyOn(tokenCounter, 'countTextTokens');
  });

  describe('addMessage - Token Count Computation', () => {
    it('should compute and store token count when adding user message', async () => {
      const content = 'Hello, this is a test message!';
      const expectedTokenCount = 8; // Mocked value

      // Mock token counter to return predictable value
      (tokenCounter.countTextTokens as any).mockReturnValue(expectedTokenCount);

      mockPrismaClient.conversationHistory.create.mockResolvedValue({
        id: 'msg-123',
        content,
        tokenCount: expectedTokenCount,
      });

      await service.addMessage({
        channelId: 'channel-123',
        personalityId: 'personality-456',
        personaId: 'persona-789',
        role: MessageRole.User,
        content,
        guildId: 'guild-111',
        discordMessageId: 'discord-msg-123',
      });

      // Verify token counter was called
      expect(tokenCounter.countTextTokens).toHaveBeenCalledWith(content);

      // Verify token count was stored in database
      expect(mockPrismaClient.conversationHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          content,
          tokenCount: expectedTokenCount,
        }),
      });
    });

    it('should compute and store token count when adding assistant message', async () => {
      const content = 'This is an AI response with more tokens than the user message!';
      const expectedTokenCount = 15;

      (tokenCounter.countTextTokens as any).mockReturnValue(expectedTokenCount);

      mockPrismaClient.conversationHistory.create.mockResolvedValue({
        id: 'msg-456',
        content,
        tokenCount: expectedTokenCount,
      });

      await service.addMessage({
        channelId: 'channel-123',
        personalityId: 'personality-456',
        personaId: 'persona-789',
        role: MessageRole.Assistant,
        content,
        guildId: null,
        discordMessageId: ['discord-msg-1', 'discord-msg-2'], // Chunked message
      });

      expect(tokenCounter.countTextTokens).toHaveBeenCalledWith(content);
      expect(mockPrismaClient.conversationHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          content,
          tokenCount: expectedTokenCount,
        }),
      });
    });

    it('should compute token count for very long messages', async () => {
      const longContent = 'A'.repeat(10000); // Very long message
      const expectedTokenCount = 2500; // Approximate tokens

      (tokenCounter.countTextTokens as any).mockReturnValue(expectedTokenCount);

      mockPrismaClient.conversationHistory.create.mockResolvedValue({
        id: 'msg-long',
        content: longContent,
        tokenCount: expectedTokenCount,
      });

      await service.addMessage({
        channelId: 'channel-123',
        personalityId: 'personality-456',
        personaId: 'persona-789',
        role: MessageRole.User,
        content: longContent,
        guildId: null,
      });

      expect(tokenCounter.countTextTokens).toHaveBeenCalledWith(longContent);
      expect(mockPrismaClient.conversationHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tokenCount: expectedTokenCount,
        }),
      });
    });

    it('should handle token count of zero for empty messages', async () => {
      const content = '';
      const expectedTokenCount = 0;

      (tokenCounter.countTextTokens as any).mockReturnValue(expectedTokenCount);

      mockPrismaClient.conversationHistory.create.mockResolvedValue({
        id: 'msg-empty',
        content,
        tokenCount: expectedTokenCount,
      });

      await service.addMessage({
        channelId: 'channel-123',
        personalityId: 'personality-456',
        personaId: 'persona-789',
        role: MessageRole.User,
        content,
        guildId: null,
      });

      expect(tokenCounter.countTextTokens).toHaveBeenCalledWith(content);
      expect(mockPrismaClient.conversationHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tokenCount: 0,
        }),
      });
    });
  });

  describe('getChannelHistory - Token Count Retrieval', () => {
    it('should include cached token counts in returned messages', async () => {
      // Mock returns messages in DESC order (newest first)
      const mockMessages = [
        {
          id: 'msg-2',
          role: MessageRole.Assistant,
          content: 'Second message with more tokens',
          tokenCount: 7,
          createdAt: new Date('2025-11-08T10:01:00Z'),
          personaId: 'persona-456',
          personalityId: 'personality-456',
          discordMessageId: ['discord-2'],
          messageMetadata: null,
          persona: {
            name: 'Bot',
            preferredName: null,
            owner: { username: 'botuser' },
          },
          personality: { name: 'TestBot', displayName: 'Test Bot' },
        },
        {
          id: 'msg-1',
          role: MessageRole.User,
          content: 'First message',
          tokenCount: 3,
          createdAt: new Date('2025-11-08T10:00:00Z'),
          personaId: 'persona-123',
          personalityId: 'personality-456',
          discordMessageId: ['discord-1'],
          messageMetadata: null,
          persona: {
            name: 'Alice',
            preferredName: 'Alice Smith',
            owner: { username: 'aliceuser' },
          },
          personality: { name: 'TestBot', displayName: 'Test Bot' },
        },
      ];

      mockPrismaClient.conversationHistory.findMany.mockResolvedValue(mockMessages);

      const result = await service.getChannelHistory('channel-123', 20);

      expect(result).toHaveLength(2);
      // Service reverses to chronological order (oldest first)
      expect(result[0].tokenCount).toBe(3); // msg-1
      expect(result[1].tokenCount).toBe(7); // msg-2

      // Verify tokenCount was requested in the query
      expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            tokenCount: true,
          }),
        })
      );
    });

    it('should handle null token counts for old messages (graceful degradation)', async () => {
      // Mock returns messages in DESC order (newest first)
      const mockMessages = [
        {
          id: 'msg-new',
          role: MessageRole.Assistant,
          content: 'New message with cached tokens',
          tokenCount: 6,
          createdAt: new Date('2025-11-08T10:00:00Z'),
          personaId: 'persona-456',
          personalityId: 'personality-456',
          discordMessageId: ['discord-new'],
          messageMetadata: null,
          persona: {
            name: 'Bot',
            preferredName: null,
            owner: { username: 'botuser' },
          },
          personality: { name: 'TestBot', displayName: 'Test Bot' },
        },
        {
          id: 'msg-old',
          role: MessageRole.User,
          content: 'Old message without cached tokens',
          tokenCount: null, // Old message from before token caching
          createdAt: new Date('2025-01-01T00:00:00Z'),
          personaId: 'persona-123',
          personalityId: 'personality-456',
          discordMessageId: ['discord-old'],
          messageMetadata: null,
          persona: {
            name: 'Alice',
            preferredName: null,
            owner: { username: 'aliceuser' },
          },
          personality: { name: 'TestBot', displayName: 'Test Bot' },
        },
      ];

      mockPrismaClient.conversationHistory.findMany.mockResolvedValue(mockMessages);

      const result = await service.getChannelHistory('channel-123', 20);

      expect(result).toHaveLength(2);
      // Service reverses to chronological order (oldest first)
      expect(result[0].tokenCount).toBeUndefined(); // msg-old (null becomes undefined)
      expect(result[1].tokenCount).toBe(6); // msg-new
    });
  });

  describe('getHistory - Paginated Token Count Retrieval', () => {
    it('should include cached token counts in paginated results', async () => {
      // Mock returns messages in DESC order (newest first)
      const mockMessages = [
        {
          id: 'msg-2',
          role: MessageRole.Assistant,
          content: 'Message 2',
          tokenCount: 5,
          createdAt: new Date('2025-11-08T10:01:00Z'),
          personaId: 'persona-456',
          personalityId: 'personality-456',
          discordMessageId: ['discord-2'],
          messageMetadata: null,
          persona: {
            name: 'Bot',
            preferredName: null,
            owner: { username: 'botuser' },
          },
          personality: { name: 'TestBot', displayName: 'Test Bot' },
        },
        {
          id: 'msg-1',
          role: MessageRole.User,
          content: 'Message 1',
          tokenCount: 3,
          createdAt: new Date('2025-11-08T10:00:00Z'),
          personaId: 'persona-123',
          personalityId: 'personality-456',
          discordMessageId: ['discord-1'],
          messageMetadata: null,
          persona: {
            name: 'Alice',
            preferredName: 'Alice Smith',
            owner: { username: 'aliceuser' },
          },
          personality: { name: 'TestBot', displayName: 'Test Bot' },
        },
      ];

      mockPrismaClient.conversationHistory.findMany.mockResolvedValue(mockMessages);

      const result = await service.getHistory('channel-123', 'personality-456', 20);

      expect(result.messages).toHaveLength(2);
      // Service reverses to chronological order (oldest first)
      expect(result.messages[0].tokenCount).toBe(3); // msg-1
      expect(result.messages[1].tokenCount).toBe(5); // msg-2

      // Verify tokenCount was requested in the query
      expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            tokenCount: true,
          }),
        })
      );
    });

    it('should handle mixed null and non-null token counts in paginated results', async () => {
      // Mock returns messages in DESC order (newest first)
      const mockMessages = [
        {
          id: 'msg-new-2',
          role: MessageRole.Assistant,
          content: 'New message 2',
          tokenCount: 9,
          createdAt: new Date('2025-11-08T10:01:00Z'),
          personaId: 'persona-456',
          personalityId: 'personality-456',
          discordMessageId: ['discord-new-2'],
          messageMetadata: null,
          persona: { name: 'Bot', preferredName: null, owner: { username: 'botuser' } },
          personality: { name: 'TestBot', displayName: 'Test Bot' },
        },
        {
          id: 'msg-new-1',
          role: MessageRole.Assistant,
          content: 'New message 1',
          tokenCount: 7,
          createdAt: new Date('2025-11-08T10:00:00Z'),
          personaId: 'persona-456',
          personalityId: 'personality-456',
          discordMessageId: ['discord-new-1'],
          messageMetadata: null,
          persona: { name: 'Bot', preferredName: null, owner: { username: 'botuser' } },
          personality: { name: 'TestBot', displayName: 'Test Bot' },
        },
        {
          id: 'msg-old-2',
          role: MessageRole.User,
          content: 'Old message 2',
          tokenCount: null,
          createdAt: new Date('2025-01-02T00:00:00Z'),
          personaId: 'persona-123',
          personalityId: 'personality-456',
          discordMessageId: ['discord-old-2'],
          messageMetadata: null,
          persona: { name: 'Alice', preferredName: null, owner: { username: 'aliceuser' } },
          personality: { name: 'TestBot', displayName: 'Test Bot' },
        },
        {
          id: 'msg-old-1',
          role: MessageRole.User,
          content: 'Old message 1',
          tokenCount: null,
          createdAt: new Date('2025-01-01T00:00:00Z'),
          personaId: 'persona-123',
          personalityId: 'personality-456',
          discordMessageId: ['discord-old-1'],
          messageMetadata: null,
          persona: { name: 'Alice', preferredName: null, owner: { username: 'aliceuser' } },
          personality: { name: 'TestBot', displayName: 'Test Bot' },
        },
      ];

      mockPrismaClient.conversationHistory.findMany.mockResolvedValue(mockMessages);

      const result = await service.getHistory('channel-123', 'personality-456', 20);

      expect(result.messages).toHaveLength(4);
      // Service reverses to chronological order (oldest first)
      expect(result.messages[0].tokenCount).toBeUndefined(); // msg-old-1
      expect(result.messages[1].tokenCount).toBeUndefined(); // msg-old-2
      expect(result.messages[2].tokenCount).toBe(7); // msg-new-1
      expect(result.messages[3].tokenCount).toBe(9); // msg-new-2
    });
  });

  describe('updateLastUserMessage - Token Count Recomputation', () => {
    it('should recompute token count when updating message content', async () => {
      const originalContent = 'Hello';
      const enrichedContent = 'Hello [Image: cat.jpg]\nA cute cat sitting on a mat';
      const originalTokenCount = 2;
      const enrichedTokenCount = 15;

      mockPrismaClient.conversationHistory.findFirst.mockResolvedValue({
        id: 'msg-123',
        content: originalContent,
        tokenCount: originalTokenCount,
        role: MessageRole.User,
        channelId: 'channel-123',
        personalityId: 'personality-456',
        personaId: 'persona-789',
        createdAt: new Date(),
        discordMessageId: ['discord-123'],
      });

      (tokenCounter.countTextTokens as any).mockReturnValue(enrichedTokenCount);

      mockPrismaClient.conversationHistory.update.mockResolvedValue({
        id: 'msg-123',
        content: enrichedContent,
        tokenCount: enrichedTokenCount,
      });

      const result = await service.updateLastUserMessage(
        'channel-123',
        'personality-456',
        'persona-789',
        enrichedContent
      );

      expect(result).toBe(true);
      expect(tokenCounter.countTextTokens).toHaveBeenCalledWith(enrichedContent);
      expect(mockPrismaClient.conversationHistory.update).toHaveBeenCalledWith({
        where: { id: 'msg-123' },
        data: {
          content: enrichedContent,
          tokenCount: enrichedTokenCount,
        },
      });
    });

    it('should handle token count recomputation for very long enriched content', async () => {
      const originalContent = 'Check out this image';
      const longDescription = 'A'.repeat(1000); // Very long attachment description
      const enrichedContent = `${originalContent} [Image: photo.jpg]\n${longDescription}`;
      const largeTokenCount = 250;

      mockPrismaClient.conversationHistory.findFirst.mockResolvedValue({
        id: 'msg-456',
        content: originalContent,
        tokenCount: 4,
      });

      (tokenCounter.countTextTokens as any).mockReturnValue(largeTokenCount);

      mockPrismaClient.conversationHistory.update.mockResolvedValue({
        id: 'msg-456',
        content: enrichedContent,
        tokenCount: largeTokenCount,
      });

      await service.updateLastUserMessage(
        'channel-123',
        'personality-456',
        'persona-789',
        enrichedContent
      );

      expect(tokenCounter.countTextTokens).toHaveBeenCalledWith(enrichedContent);
      expect(mockPrismaClient.conversationHistory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tokenCount: largeTokenCount,
          }),
        })
      );
    });
  });

  describe('Performance Optimization Validation', () => {
    it('should only call countTextTokens once per message addition', async () => {
      const content1 = 'First message';
      const content2 = 'Second message';
      const content3 = 'Third message';

      (tokenCounter.countTextTokens as any)
        .mockReturnValueOnce(3)
        .mockReturnValueOnce(3)
        .mockReturnValueOnce(3);

      mockPrismaClient.conversationHistory.create.mockResolvedValue({
        id: 'msg-123',
      });

      // Add 3 messages
      await service.addMessage({
        channelId: 'channel-123',
        personalityId: 'personality-456',
        personaId: 'persona-789',
        role: MessageRole.User,
        content: content1,
        guildId: null,
      });
      await service.addMessage({
        channelId: 'channel-123',
        personalityId: 'personality-456',
        personaId: 'persona-789',
        role: MessageRole.Assistant,
        content: content2,
        guildId: null,
      });
      await service.addMessage({
        channelId: 'channel-123',
        personalityId: 'personality-456',
        personaId: 'persona-789',
        role: MessageRole.User,
        content: content3,
        guildId: null,
      });

      // Verify token counter was called exactly 3 times (once per message)
      expect(tokenCounter.countTextTokens).toHaveBeenCalledTimes(3);
      expect(tokenCounter.countTextTokens).toHaveBeenNthCalledWith(1, content1);
      expect(tokenCounter.countTextTokens).toHaveBeenNthCalledWith(2, content2);
      expect(tokenCounter.countTextTokens).toHaveBeenNthCalledWith(3, content3);
    });

    it('should NOT call countTextTokens when retrieving messages', async () => {
      vi.clearAllMocks();

      const mockMessages = [
        {
          id: 'msg-1',
          role: MessageRole.User,
          content: 'Message 1 with cached tokens',
          tokenCount: 5,
          createdAt: new Date(),
          personaId: 'persona-123',
          personalityId: 'personality-456',
          discordMessageId: ['discord-1'],
          messageMetadata: null,
          persona: { name: 'Alice', preferredName: null, owner: { username: 'aliceuser' } },
          personality: { name: 'TestBot', displayName: 'Test Bot' },
        },
      ];

      mockPrismaClient.conversationHistory.findMany.mockResolvedValue(mockMessages);

      // Retrieve messages
      await service.getChannelHistory('channel-123', 20);

      // Token counter should NOT be called during retrieval
      expect(tokenCounter.countTextTokens).not.toHaveBeenCalled();
    });
  });

  describe('getMessageByDiscordId - Voice Transcript Retrieval', () => {
    it('should retrieve message by Discord message ID', async () => {
      const discordMessageId = 'discord-voice-123';
      const mockMessage = {
        id: 'msg-voice-123',
        role: MessageRole.User,
        content: 'This is the transcribed voice message',
        tokenCount: 6,
        createdAt: new Date('2025-11-14T12:00:00Z'),
        personaId: 'persona-123',
        personalityId: 'personality-456',
        discordMessageId: [discordMessageId],
        messageMetadata: null,
        persona: {
          name: 'Alice',
          preferredName: 'Alice Smith',
          owner: { username: 'aliceuser' },
        },
        personality: { name: 'TestBot', displayName: 'Test Bot' },
      };

      mockPrismaClient.conversationHistory.findFirst.mockResolvedValue(mockMessage);

      const result = await service.getMessageByDiscordId(discordMessageId);

      expect(result).not.toBeNull();
      expect(result?.id).toBe('msg-voice-123');
      expect(result?.content).toBe('This is the transcribed voice message');
      expect(result?.role).toBe(MessageRole.User);
      expect(result?.tokenCount).toBe(6);
      expect(result?.personaId).toBe('persona-123');
      expect(result?.personaName).toBe('Alice Smith'); // Uses preferredName
      expect(result?.discordMessageId).toEqual([discordMessageId]);

      // Verify correct query was made
      expect(mockPrismaClient.conversationHistory.findFirst).toHaveBeenCalledWith({
        where: {
          discordMessageId: {
            has: discordMessageId,
          },
        },
        select: expect.objectContaining({
          id: true,
          role: true,
          content: true,
          tokenCount: true,
          createdAt: true,
          personaId: true,
          discordMessageId: true,
          persona: {
            select: {
              name: true,
              preferredName: true,
              owner: {
                select: {
                  username: true,
                },
              },
            },
          },
        }),
      });
    });

    it('should return null when message not found', async () => {
      mockPrismaClient.conversationHistory.findFirst.mockResolvedValue(null);

      const result = await service.getMessageByDiscordId('nonexistent-msg-id');

      expect(result).toBeNull();
      expect(mockPrismaClient.conversationHistory.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            discordMessageId: {
              has: 'nonexistent-msg-id',
            },
          },
        })
      );
    });

    it('should handle null tokenCount for old messages', async () => {
      const mockMessage = {
        id: 'msg-old',
        role: MessageRole.User,
        content: 'Old voice message without cached tokens',
        tokenCount: null, // Old message from before token caching
        createdAt: new Date('2025-01-01T00:00:00Z'),
        personaId: 'persona-456',
        personalityId: 'personality-456',
        discordMessageId: ['discord-old-123'],
        messageMetadata: null,
        persona: {
          name: 'Bob',
          preferredName: null,
          owner: { username: 'bobuser' },
        },
        personality: { name: 'TestBot', displayName: 'Test Bot' },
      };

      mockPrismaClient.conversationHistory.findFirst.mockResolvedValue(mockMessage);

      const result = await service.getMessageByDiscordId('discord-old-123');

      expect(result).not.toBeNull();
      expect(result?.tokenCount).toBeUndefined(); // null becomes undefined
      expect(result?.personaName).toBe('Bob'); // Falls back to name when preferredName is null
    });

    it('should use persona name when preferredName is null', async () => {
      const mockMessage = {
        id: 'msg-123',
        role: MessageRole.User,
        content: 'Voice message',
        tokenCount: 4,
        createdAt: new Date('2025-11-14T12:00:00Z'),
        personaId: 'persona-456',
        personalityId: 'personality-456',
        discordMessageId: ['discord-msg-456'],
        messageMetadata: null,
        persona: {
          name: 'Bob',
          preferredName: null, // No preferred name set
          owner: { username: 'bobuser' },
        },
        personality: { name: 'TestBot', displayName: 'Test Bot' },
      };

      mockPrismaClient.conversationHistory.findFirst.mockResolvedValue(mockMessage);

      const result = await service.getMessageByDiscordId('discord-msg-456');

      expect(result?.personaName).toBe('Bob'); // Uses name as fallback
    });

    it('should handle errors gracefully and return null', async () => {
      const error = new Error('Database connection failed');
      mockPrismaClient.conversationHistory.findFirst.mockRejectedValue(error);

      const result = await service.getMessageByDiscordId('discord-error-msg');

      expect(result).toBeNull();
    });

    it('should query with "has" filter for Discord message ID array', async () => {
      mockPrismaClient.conversationHistory.findFirst.mockResolvedValue(null);

      await service.getMessageByDiscordId('test-id-123');

      // Verify the query uses the "has" filter (for array fields)
      expect(mockPrismaClient.conversationHistory.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            discordMessageId: {
              has: 'test-id-123',
            },
          },
        })
      );
    });

    it('should handle chunked assistant messages (multiple Discord IDs)', async () => {
      const discordId = 'discord-chunk-2';
      const mockMessage = {
        id: 'msg-chunked',
        role: MessageRole.Assistant,
        content: 'This is a long assistant response that was chunked',
        tokenCount: 12,
        createdAt: new Date('2025-11-14T12:00:00Z'),
        personaId: 'persona-bot',
        personalityId: 'personality-456',
        discordMessageId: ['discord-chunk-1', 'discord-chunk-2', 'discord-chunk-3'], // Chunked message
        messageMetadata: null,
        persona: {
          name: 'Lilith',
          preferredName: null,
          owner: { username: 'lilithuser' },
        },
        personality: { name: 'TestBot', displayName: 'Test Bot' },
      };

      mockPrismaClient.conversationHistory.findFirst.mockResolvedValue(mockMessage);

      const result = await service.getMessageByDiscordId(discordId);

      expect(result).not.toBeNull();
      expect(result?.content).toBe('This is a long assistant response that was chunked');
      expect(result?.discordMessageId).toEqual([
        'discord-chunk-1',
        'discord-chunk-2',
        'discord-chunk-3',
      ]);
    });
  });

  describe('getHistory - Pagination', () => {
    it('should enforce max limit of 100', async () => {
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      await service.getHistory('channel-123', 'personality-456', 500); // Request 500

      expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 101, // Should be limited to 100 + 1
        })
      );
    });

    it('should indicate hasMore when more messages exist', async () => {
      // Mock returns 21 messages (limit + 1) in DESC order (newest first)
      const mockMessages = Array.from({ length: 21 }, (_, i) => ({
        id: `msg-${20 - i}`, // Reverse order: msg-20, msg-19, ..., msg-0
        role: MessageRole.User,
        content: `Message ${20 - i}`,
        tokenCount: 3,
        createdAt: new Date(`2025-11-08T10:${(20 - i).toString().padStart(2, '0')}:00Z`),
        personaId: `persona-${20 - i}`,
        personalityId: 'personality-456',
        discordMessageId: [`discord-${20 - i}`],
        messageMetadata: null,
        persona: { name: 'User', preferredName: null, owner: { username: 'testuser' } },
        personality: { name: 'TestBot', displayName: 'Test Bot' },
      }));

      mockPrismaClient.conversationHistory.findMany.mockResolvedValue(mockMessages);

      const result = await service.getHistory('channel-123', 'personality-456', 20);

      expect(result.messages).toHaveLength(20); // Should only return 20
      expect(result.hasMore).toBe(true);
      // nextCursor is the last message after reversal (newest message in result: msg-20)
      expect(result.nextCursor).toBe('msg-20');
    });

    it('should indicate no more messages when at the end', async () => {
      const mockMessages = Array.from({ length: 10 }, (_, i) => ({
        id: `msg-${i}`,
        role: MessageRole.User,
        content: `Message ${i}`,
        tokenCount: 3,
        createdAt: new Date(`2025-11-08T10:${i.toString().padStart(2, '0')}:00Z`),
        personaId: `persona-${i}`,
        personalityId: 'personality-456',
        discordMessageId: [`discord-${i}`],
        messageMetadata: null,
        persona: { name: 'User', preferredName: null, owner: { username: 'testuser' } },
        personality: { name: 'TestBot', displayName: 'Test Bot' },
      }));

      mockPrismaClient.conversationHistory.findMany.mockResolvedValue(mockMessages);

      const result = await service.getHistory('channel-123', 'personality-456', 20);

      expect(result.messages).toHaveLength(10);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeUndefined();
    });

    it('should use cursor for pagination', async () => {
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      await service.getHistory('channel-123', 'personality-456', 20, 'cursor-msg-123');

      expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { id: 'cursor-msg-123' },
          skip: 1,
        })
      );
    });

    it('should not use cursor when empty string provided', async () => {
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      await service.getHistory('channel-123', 'personality-456', 20, '');

      expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith(
        expect.not.objectContaining({
          cursor: expect.anything(),
        })
      );
    });

    it('should return empty result on error', async () => {
      const error = new Error('Database connection failed');
      mockPrismaClient.conversationHistory.findMany.mockRejectedValue(error);

      const result = await service.getHistory('channel-123', 'personality-456', 20);

      expect(result.messages).toEqual([]);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeUndefined();
    });
  });

  describe('updateLastAssistantMessageId', () => {
    it('should update assistant message with Discord message IDs', async () => {
      const discordIds = ['discord-chunk-1', 'discord-chunk-2', 'discord-chunk-3'];

      mockPrismaClient.conversationHistory.findFirst.mockResolvedValue({
        id: 'msg-assistant-123',
        role: MessageRole.Assistant,
        content: 'Long response',
        channelId: 'channel-123',
        personalityId: 'personality-456',
        personaId: 'persona-789',
        createdAt: new Date(),
        discordMessageId: [],
      });

      mockPrismaClient.conversationHistory.update.mockResolvedValue({
        id: 'msg-assistant-123',
        discordMessageId: discordIds,
      });

      const result = await service.updateLastAssistantMessageId(
        'channel-123',
        'personality-456',
        'persona-789',
        discordIds
      );

      expect(result).toBe(true);
      expect(mockPrismaClient.conversationHistory.findFirst).toHaveBeenCalledWith({
        where: {
          channelId: 'channel-123',
          personalityId: 'personality-456',
          personaId: 'persona-789',
          role: MessageRole.Assistant,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      expect(mockPrismaClient.conversationHistory.update).toHaveBeenCalledWith({
        where: {
          id: 'msg-assistant-123',
        },
        data: {
          discordMessageId: discordIds,
        },
      });
    });

    it('should return false when no assistant message found', async () => {
      mockPrismaClient.conversationHistory.findFirst.mockResolvedValue(null);

      const result = await service.updateLastAssistantMessageId(
        'channel-123',
        'personality-456',
        'persona-789',
        ['discord-1']
      );

      expect(result).toBe(false);
      expect(mockPrismaClient.conversationHistory.update).not.toHaveBeenCalled();
    });

    it('should return false on error', async () => {
      mockPrismaClient.conversationHistory.findFirst.mockRejectedValue(new Error('Database error'));

      const result = await service.updateLastAssistantMessageId(
        'channel-123',
        'personality-456',
        'persona-789',
        ['discord-1']
      );

      expect(result).toBe(false);
    });
  });

  // Note: clearHistory and cleanupOldHistory tests moved to ConversationRetentionService.test.ts
  // Note: Soft delete / edit sync tests moved to ConversationSyncService.test.ts

  describe('getChannelHistory - Soft Delete Filtering', () => {
    it('should exclude soft-deleted messages (deletedAt not null)', async () => {
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      await service.getChannelHistory('channel-123', 20);

      expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
          }),
        })
      );
    });
  });

  describe('getChannelHistory - Cross-Personality Channel History', () => {
    it('should fetch messages without personality filter', async () => {
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      await service.getChannelHistory('channel-123', 20);

      expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            channelId: 'channel-123',
            deletedAt: null,
            // Note: NO personalityId filter - fetches all messages in the channel
          }),
        })
      );

      // Verify personalityId is NOT in the where clause
      const callArg = mockPrismaClient.conversationHistory.findMany.mock.calls[0][0];
      expect(callArg.where.personalityId).toBeUndefined();
    });

    it('should return messages in chronological order', async () => {
      // Mock messages must match the structure expected by mapToConversationMessages
      const mockMessages = [
        {
          id: 'msg-2',
          role: MessageRole.Assistant,
          content: 'Response',
          tokenCount: 5,
          createdAt: new Date('2025-01-01T01:00:00Z'),
          personaId: 'persona-1',
          personalityId: 'personality-456',
          persona: {
            name: 'User',
            preferredName: 'User Persona',
            owner: { username: 'user123' },
          },
          personality: { name: 'TestBot', displayName: 'Test Bot' },
          discordMessageId: ['discord-2'],
          messageMetadata: null,
        },
        {
          id: 'msg-1',
          role: MessageRole.User,
          content: 'Hello',
          tokenCount: 3,
          createdAt: new Date('2025-01-01T00:00:00Z'),
          personaId: 'persona-1',
          personalityId: 'personality-456',
          persona: {
            name: 'User',
            preferredName: 'User Persona',
            owner: { username: 'user123' },
          },
          personality: { name: 'TestBot', displayName: 'Test Bot' },
          discordMessageId: ['discord-1'],
          messageMetadata: null,
        },
      ];

      mockPrismaClient.conversationHistory.findMany.mockResolvedValue(mockMessages);

      const result = await service.getChannelHistory('channel-123', 20);

      expect(result).toHaveLength(2);
      // Service reverses to chronological order (oldest first)
      expect(result[0].id).toBe('msg-1');
      expect(result[1].id).toBe('msg-2');
    });

    it('should apply context epoch filter when provided', async () => {
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);
      const contextEpoch = new Date('2025-01-01T00:00:00Z');

      await service.getChannelHistory('channel-123', 20, contextEpoch);

      expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            channelId: 'channel-123',
            deletedAt: null,
            createdAt: {
              gt: contextEpoch,
            },
          }),
        })
      );
    });

    it('should return empty array on error', async () => {
      mockPrismaClient.conversationHistory.findMany.mockRejectedValue(
        new Error('Database query failed')
      );

      const result = await service.getChannelHistory('channel-123', 20);

      expect(result).toEqual([]);
    });
  });

  describe('Error Handling', () => {
    it('should throw error when addMessage fails', async () => {
      const error = new Error('Database connection failed');
      mockPrismaClient.conversationHistory.create.mockRejectedValue(error);

      await expect(
        service.addMessage({
          channelId: 'channel-123',
          personalityId: 'personality-456',
          personaId: 'persona-789',
          role: MessageRole.User,
          content: 'test message',
          guildId: null,
        })
      ).rejects.toThrow('Database connection failed');
    });

    it('should return false when updateLastUserMessage finds no message', async () => {
      mockPrismaClient.conversationHistory.findFirst.mockResolvedValue(null);

      const result = await service.updateLastUserMessage(
        'channel-123',
        'personality-456',
        'persona-789',
        'enriched content'
      );

      expect(result).toBe(false);
      expect(mockPrismaClient.conversationHistory.update).not.toHaveBeenCalled();
    });

    it('should return false when updateLastUserMessage fails on update', async () => {
      mockPrismaClient.conversationHistory.findFirst.mockResolvedValue({
        id: 'msg-123',
        content: 'original content',
      });

      mockPrismaClient.conversationHistory.update.mockRejectedValue(new Error('Update failed'));

      const result = await service.updateLastUserMessage(
        'channel-123',
        'personality-456',
        'persona-789',
        'enriched content'
      );

      expect(result).toBe(false);
    });

    it('should return empty array when getChannelHistory fails', async () => {
      const error = new Error('Database query failed');
      mockPrismaClient.conversationHistory.findMany.mockRejectedValue(error);

      const result = await service.getChannelHistory('channel-123', 20);

      expect(result).toEqual([]);
    });
  });
});
