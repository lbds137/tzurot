/**
 * Tests for ConversationHistoryService - Token Count Caching
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationHistoryService } from './ConversationHistoryService.js';
import { MessageRole } from '../config/constants.js';
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
});
