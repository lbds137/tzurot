/**
 * Tests for ConversationHistoryService - Token Count Caching
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationHistoryService } from './ConversationHistoryService.js';
import { MessageRole } from '../constants/index.js';
import * as tokenCounter from '../utils/tokenCounter.js';

// Mock getPrismaClient
const mockPrismaClient = {
  conversationHistory: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
};

vi.mock('./prisma.js', () => ({
  getPrismaClient: vi.fn(() => mockPrismaClient),
}));

// Spy on countTextTokens to verify it's called correctly
vi.spyOn(tokenCounter, 'countTextTokens');

describe('ConversationHistoryService - Token Count Caching', () => {
  let service: ConversationHistoryService;

  beforeEach(() => {
    service = new ConversationHistoryService();
    vi.clearAllMocks();
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

      await service.addMessage(
        'channel-123',
        'personality-456',
        'persona-789',
        MessageRole.User,
        content,
        'guild-111',
        'discord-msg-123'
      );

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

      await service.addMessage(
        'channel-123',
        'personality-456',
        'persona-789',
        MessageRole.Assistant,
        content,
        null,
        ['discord-msg-1', 'discord-msg-2'] // Chunked message
      );

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

      await service.addMessage(
        'channel-123',
        'personality-456',
        'persona-789',
        MessageRole.User,
        longContent
      );

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

      await service.addMessage(
        'channel-123',
        'personality-456',
        'persona-789',
        MessageRole.User,
        content
      );

      expect(tokenCounter.countTextTokens).toHaveBeenCalledWith(content);
      expect(mockPrismaClient.conversationHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tokenCount: 0,
        }),
      });
    });
  });

  describe('getRecentHistory - Token Count Retrieval', () => {
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
          discordMessageId: ['discord-2'],
          persona: {
            name: 'Bot',
            preferredName: null,
          },
        },
        {
          id: 'msg-1',
          role: MessageRole.User,
          content: 'First message',
          tokenCount: 3,
          createdAt: new Date('2025-11-08T10:00:00Z'),
          personaId: 'persona-123',
          discordMessageId: ['discord-1'],
          persona: {
            name: 'Alice',
            preferredName: 'Alice Smith',
          },
        },
      ];

      mockPrismaClient.conversationHistory.findMany.mockResolvedValue(mockMessages);

      const result = await service.getRecentHistory('channel-123', 'personality-456', 20);

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
          discordMessageId: ['discord-new'],
          persona: {
            name: 'Bot',
            preferredName: null,
          },
        },
        {
          id: 'msg-old',
          role: MessageRole.User,
          content: 'Old message without cached tokens',
          tokenCount: null, // Old message from before token caching
          createdAt: new Date('2025-01-01T00:00:00Z'),
          personaId: 'persona-123',
          discordMessageId: ['discord-old'],
          persona: {
            name: 'Alice',
            preferredName: null,
          },
        },
      ];

      mockPrismaClient.conversationHistory.findMany.mockResolvedValue(mockMessages);

      const result = await service.getRecentHistory('channel-123', 'personality-456', 20);

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
          discordMessageId: ['discord-2'],
          persona: {
            name: 'Bot',
            preferredName: null,
          },
        },
        {
          id: 'msg-1',
          role: MessageRole.User,
          content: 'Message 1',
          tokenCount: 3,
          createdAt: new Date('2025-11-08T10:00:00Z'),
          personaId: 'persona-123',
          discordMessageId: ['discord-1'],
          persona: {
            name: 'Alice',
            preferredName: 'Alice Smith',
          },
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
          discordMessageId: ['discord-new-2'],
          persona: { name: 'Bot', preferredName: null },
        },
        {
          id: 'msg-new-1',
          role: MessageRole.Assistant,
          content: 'New message 1',
          tokenCount: 7,
          createdAt: new Date('2025-11-08T10:00:00Z'),
          personaId: 'persona-456',
          discordMessageId: ['discord-new-1'],
          persona: { name: 'Bot', preferredName: null },
        },
        {
          id: 'msg-old-2',
          role: MessageRole.User,
          content: 'Old message 2',
          tokenCount: null,
          createdAt: new Date('2025-01-02T00:00:00Z'),
          personaId: 'persona-123',
          discordMessageId: ['discord-old-2'],
          persona: { name: 'Alice', preferredName: null },
        },
        {
          id: 'msg-old-1',
          role: MessageRole.User,
          content: 'Old message 1',
          tokenCount: null,
          createdAt: new Date('2025-01-01T00:00:00Z'),
          personaId: 'persona-123',
          discordMessageId: ['discord-old-1'],
          persona: { name: 'Alice', preferredName: null },
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
      await service.addMessage(
        'channel-123',
        'personality-456',
        'persona-789',
        MessageRole.User,
        content1
      );
      await service.addMessage(
        'channel-123',
        'personality-456',
        'persona-789',
        MessageRole.Assistant,
        content2
      );
      await service.addMessage(
        'channel-123',
        'personality-456',
        'persona-789',
        MessageRole.User,
        content3
      );

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
          discordMessageId: ['discord-1'],
          persona: { name: 'Alice', preferredName: null },
        },
      ];

      mockPrismaClient.conversationHistory.findMany.mockResolvedValue(mockMessages);

      // Retrieve messages
      await service.getRecentHistory('channel-123', 'personality-456', 20);

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
        discordMessageId: [discordMessageId],
        persona: {
          name: 'Alice',
          preferredName: 'Alice Smith',
        },
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
        discordMessageId: ['discord-old-123'],
        persona: {
          name: 'Bob',
          preferredName: null,
        },
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
        discordMessageId: ['discord-msg-456'],
        persona: {
          name: 'Bob',
          preferredName: null, // No preferred name set
        },
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
        discordMessageId: ['discord-chunk-1', 'discord-chunk-2', 'discord-chunk-3'], // Chunked message
        persona: {
          name: 'Lilith',
          preferredName: null,
        },
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
});
