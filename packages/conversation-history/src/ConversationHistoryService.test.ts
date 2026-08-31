/**
 * Tests for ConversationHistoryService - Token Count Caching
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ConversationHistoryService,
  getChannelHistoryWindow,
} from './ConversationHistoryService.js';
import { MessageRole } from '@tzurot/common-types/constants/message';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';

// countTextTokens now lives in @tzurot/common-types (consumed by the production
// service via the barrel), so intercept it through a partial mock rather than a
// namespace spy — the latter doesn't reliably catch a re-exported binding.
const { mockCountTextTokens } = vi.hoisted(() => ({ mockCountTextTokens: vi.fn() }));
const { mockLoggerInfo, mockLoggerWarn, mockLoggerDebug, mockLoggerError } = vi.hoisted(() => ({
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerDebug: vi.fn(),
  mockLoggerError: vi.fn(),
}));
vi.mock('@tzurot/common-types/utils/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/utils/logger')>();
  return {
    ...actual,
    createLogger: () => ({
      info: mockLoggerInfo,
      debug: mockLoggerDebug,
      warn: mockLoggerWarn,
      error: mockLoggerError,
    }),
  };
});
vi.mock('@tzurot/common-types/utils/tokenCounter', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/utils/tokenCounter')>();
  return {
    ...actual,
    countTextTokens: mockCountTextTokens,
  };
});
// Create mock Prisma client
const createMockPrismaClient = () => {
  const client = {
    conversationHistory: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
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
    // Windowed reads count first and short-circuit the fetch when the window
    // resolves to zero rows, so an unmocked `count` would make findMany
    // unreachable. 20 matches the cap these tests pass: the window is exactly
    // full, nothing is evicted, and `take` is the whole cap — the same fetch
    // shape the pre-window code issued.
    mockPrismaClient.conversationHistory.count.mockResolvedValue(20);
    service = new ConversationHistoryService(mockPrismaClient as unknown as PrismaClient);
  });

  describe('addMessage - Token Count Computation', () => {
    it('should compute and store token count when adding user message', async () => {
      const content = 'Hello, this is a test message!';
      const expectedTokenCount = 8; // Mocked value

      // Mock token counter to return predictable value
      mockCountTextTokens.mockReturnValue(expectedTokenCount);

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
      expect(mockCountTextTokens).toHaveBeenCalledWith(content);

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

      mockCountTextTokens.mockReturnValue(expectedTokenCount);

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

      expect(mockCountTextTokens).toHaveBeenCalledWith(content);
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

      mockCountTextTokens.mockReturnValue(expectedTokenCount);

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

      expect(mockCountTextTokens).toHaveBeenCalledWith(longContent);
      expect(mockPrismaClient.conversationHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tokenCount: expectedTokenCount,
        }),
      });
    });

    it('should handle token count of zero for empty messages', async () => {
      const content = '';
      const expectedTokenCount = 0;

      mockCountTextTokens.mockReturnValue(expectedTokenCount);

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

      expect(mockCountTextTokens).toHaveBeenCalledWith(content);
      expect(mockPrismaClient.conversationHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tokenCount: 0,
        }),
      });
    });
  });

  describe('addMessage — create-payload shape (the persisted wire contract)', () => {
    const base = {
      channelId: 'chan-1',
      personalityId: 'pers-1',
      personaId: 'persona-1',
      role: MessageRole.User,
      content: 'hello',
      guildId: null,
    };

    beforeEach(() => {
      mockCountTextTokens.mockReturnValue(3);
      mockPrismaClient.conversationHistory.create.mockResolvedValue({});
    });

    function createdData(): Record<string, unknown> {
      return mockPrismaClient.conversationHistory.create.mock.calls[0][0].data;
    }

    it('wraps a single discordMessageId string into an array', async () => {
      await service.addMessage({ ...base, discordMessageId: 'd-1' });
      expect(createdData().discordMessageId).toEqual(['d-1']);
    });

    it('passes a discordMessageId array through unchanged', async () => {
      await service.addMessage({ ...base, discordMessageId: ['d-1', 'd-2'] });
      expect(createdData().discordMessageId).toEqual(['d-1', 'd-2']);
    });

    it('stores an empty id array when discordMessageId is absent', async () => {
      await service.addMessage({ ...base });
      expect(createdData().discordMessageId).toEqual([]);
    });

    it('omits the thinkingContent key entirely when not provided', async () => {
      await service.addMessage({ ...base });
      expect(createdData()).not.toHaveProperty('thinkingContent');
    });

    it('persists a provided thinkingContent verbatim', async () => {
      await service.addMessage({ ...base, thinkingContent: 'weighed two options' });
      expect(createdData().thinkingContent).toBe('weighed two options');
    });

    it('normalizes an empty thinkingContent to null, not an empty string', async () => {
      // "No trace" must have one representation in the column, so a `!== null`
      // reader and a `.length === 0` reader can never disagree about a row.
      await service.addMessage({ ...base, thinkingContent: '' });
      expect(createdData().thinkingContent).toBeNull();
    });

    it('omits the messageMetadata key entirely when not provided', async () => {
      await service.addMessage({ ...base });
      expect(createdData()).not.toHaveProperty('messageMetadata');
    });

    it('persists messageMetadata when provided and stores the guild id', async () => {
      const messageMetadata = { referencedMessages: [] };
      await service.addMessage({ ...base, guildId: 'guild-9', messageMetadata });
      expect(createdData().messageMetadata).toEqual(messageMetadata);
      expect(createdData().guildId).toBe('guild-9');
    });

    it('stores null guildId for DMs', async () => {
      await service.addMessage({ ...base });
      expect(createdData().guildId).toBeNull();
    });
  });

  describe('getHistoryStats — count wiring and epoch threading', () => {
    beforeEach(() => {
      mockPrismaClient.conversationHistory.count.mockResolvedValue(0);
      mockPrismaClient.conversationHistory.findFirst.mockResolvedValue(null);
    });

    it('issues role-split counts over the same base where clause', async () => {
      mockPrismaClient.conversationHistory.count
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(6)
        .mockResolvedValueOnce(4);

      const stats = await service.getHistoryStats('chan-1', 'pers-1');

      expect(stats).toEqual({
        totalMessages: 10,
        userMessages: 6,
        assistantMessages: 4,
        oldestMessage: undefined,
        newestMessage: undefined,
      });
      const countCalls = mockPrismaClient.conversationHistory.count.mock.calls as [
        { where: Record<string, unknown> },
      ][];
      const wheres = countCalls.map(c => c[0].where);
      expect(wheres[0]).toEqual({ channelId: 'chan-1', personalityId: 'pers-1' });
      expect(wheres[1].role).toBe(MessageRole.User);
      expect(wheres[2].role).toBe(MessageRole.Assistant);
    });

    it('threads the context epoch into every where clause', async () => {
      const epoch = new Date('2026-02-02T00:00:00Z');
      await service.getHistoryStats('chan-1', 'pers-1', epoch);

      for (const call of mockPrismaClient.conversationHistory.count.mock.calls) {
        expect((call[0].where as Record<string, unknown>).createdAt).toEqual({ gt: epoch });
      }
    });

    it('surfaces oldest/newest timestamps from the two findFirst probes', async () => {
      const oldest = new Date('2026-01-01T00:00:00Z');
      const newest = new Date('2026-03-01T00:00:00Z');
      mockPrismaClient.conversationHistory.findFirst
        .mockResolvedValueOnce({ createdAt: oldest })
        .mockResolvedValueOnce({ createdAt: newest });

      const stats = await service.getHistoryStats('chan-1', 'pers-1');

      expect(stats.oldestMessage).toEqual(oldest);
      expect(stats.newestMessage).toEqual(newest);
      // The probes must ask for opposite extremes of createdAt, nothing more.
      const probeArgs = mockPrismaClient.conversationHistory.findFirst.mock.calls;
      expect(probeArgs[0][0].orderBy).toEqual({ createdAt: 'asc' });
      expect(probeArgs[1][0].orderBy).toEqual({ createdAt: 'desc' });
      expect(probeArgs[0][0].select).toEqual({ createdAt: true });
    });

    it('the newest and oldest probes select only createdAt', async () => {
      await service.getHistoryStats('chan-1', 'pers-1');

      const calls = mockPrismaClient.conversationHistory.findFirst.mock.calls as [
        { orderBy: { createdAt: string }; select: Record<string, unknown> },
      ][];
      const desc = calls.find(c => c[0].orderBy.createdAt === 'desc');
      const asc = calls.find(c => c[0].orderBy.createdAt === 'asc');

      expect(desc?.[0].select).toEqual({ createdAt: true });
      expect(asc?.[0].select).toEqual({ createdAt: true });
    });

    it('degrades to zeroed stats on a query failure', async () => {
      mockPrismaClient.conversationHistory.count.mockRejectedValue(new Error('db down'));

      const stats = await service.getHistoryStats('chan-1', 'pers-1');

      expect(stats).toEqual({ totalMessages: 0, userMessages: 0, assistantMessages: 0 });
    });
  });

  describe('getChannelHistoryWindow - Token Count Retrieval', () => {
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

      const { messages: result } = await getChannelHistoryWindow(
        mockPrismaClient as unknown as PrismaClient,
        {
          channelId: 'channel-123',
          cap: 20,
        }
      );

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

      const { messages: result } = await getChannelHistoryWindow(
        mockPrismaClient as unknown as PrismaClient,
        {
          channelId: 'channel-123',
          cap: 20,
        }
      );

      expect(result).toHaveLength(2);
      // Service reverses to chronological order (oldest first)
      expect(result[0].tokenCount).toBeUndefined(); // msg-old (null becomes undefined)
      expect(result[1].tokenCount).toBe(6); // msg-new
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

      mockCountTextTokens.mockReturnValue(enrichedTokenCount);

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
      expect(mockCountTextTokens).toHaveBeenCalledWith(enrichedContent);
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

      mockCountTextTokens.mockReturnValue(largeTokenCount);

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

      expect(mockCountTextTokens).toHaveBeenCalledWith(enrichedContent);
      expect(mockPrismaClient.conversationHistory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tokenCount: largeTokenCount,
          }),
        })
      );
    });

    it('never writes message_metadata, so it cannot clobber a concurrent key', async () => {
      // The invariant this method's narrow client enforces structurally, pinned
      // here as behaviour: the metadata column has concurrent writers that
      // merge server-side, and any Prisma write of it from this path would be
      // the read-modify-write they exist to avoid.
      mockPrismaClient.conversationHistory.findFirst.mockResolvedValue({
        id: 'msg-merge',
        content: 'original',
        tokenCount: 2,
        role: MessageRole.User,
        messageMetadata: { embedsXml: ['<embed>keep me</embed>'] },
      });
      mockCountTextTokens.mockReturnValue(9);
      mockPrismaClient.conversationHistory.update.mockResolvedValue({});

      await service.updateLastUserMessage('channel-123', 'personality-456', 'persona-789', 'new');

      expect(mockPrismaClient.conversationHistory.update.mock.calls[0][0].data).not.toHaveProperty(
        'messageMetadata'
      );
    });
  });

  describe('Performance Optimization Validation', () => {
    it('should only call countTextTokens once per message addition', async () => {
      const content1 = 'First message';
      const content2 = 'Second message';
      const content3 = 'Third message';

      mockCountTextTokens.mockReturnValueOnce(3).mockReturnValueOnce(3).mockReturnValueOnce(3);

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
      expect(mockCountTextTokens).toHaveBeenCalledTimes(3);
      expect(mockCountTextTokens).toHaveBeenNthCalledWith(1, content1);
      expect(mockCountTextTokens).toHaveBeenNthCalledWith(2, content2);
      expect(mockCountTextTokens).toHaveBeenNthCalledWith(3, content3);
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
      await getChannelHistoryWindow(mockPrismaClient as unknown as PrismaClient, {
        channelId: 'channel-123',
        cap: 20,
      });

      // Token counter should NOT be called during retrieval
      expect(mockCountTextTokens).not.toHaveBeenCalled();
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
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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

  describe('trigger-row lookup and miss logging', () => {
    it('scopes the trigger lookup to channel + personality + persona', async () => {
      mockPrismaClient.conversationHistory.findFirst.mockResolvedValue({ id: 'msg-1' });
      mockPrismaClient.conversationHistory.update.mockResolvedValue({});
      mockCountTextTokens.mockReturnValue(1);

      await service.updateLastUserMessage('chan-1', 'pers-1', 'persona-1', 'new content');

      expect(mockPrismaClient.conversationHistory.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            channelId: 'chan-1',
            personalityId: 'pers-1',
            personaId: 'persona-1',
          }),
        })
      );
    });

    it('warns when there is no user message to update', async () => {
      mockPrismaClient.conversationHistory.findFirst.mockResolvedValue(null);

      const result = await service.updateLastUserMessage(
        'chan-1',
        'pers-1',
        'persona-1',
        'content'
      );

      expect(result).toBe(false);
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        {},
        expect.stringContaining('No user message found to update')
      );
    });

    it('warns when there is no assistant message to update', async () => {
      mockPrismaClient.conversationHistory.findFirst.mockResolvedValue(null);

      const result = await service.updateLastAssistantMessageId('chan-1', 'pers-1', 'persona-1', [
        'discord-1',
      ]);

      expect(result).toBe(false);
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        {},
        expect.stringContaining('No assistant message found to update')
      );
    });

    it('returns null for an unknown discord id without logging an error — a miss is an ordinary outcome', async () => {
      // The mutant this pins reaches the mapper with a null record and turns
      // the miss into a logged error.
      mockPrismaClient.conversationHistory.findFirst.mockResolvedValue(null);

      const result = await service.getMessageByDiscordId('unknown-id');

      expect(result).toBeNull();
      expect(mockLoggerError).not.toHaveBeenCalled();
    });

    it('short-circuits before the retrieval telemetry when cross-channel history is empty', async () => {
      // The telemetry line would otherwise report a retrieval that never happened.
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      const result = await service.getCrossChannelHistory('persona-1', 'personality-1', 'chan-1');

      expect(result).toEqual([]);
      expect(mockLoggerDebug).not.toHaveBeenCalledWith(
        expect.anything(),
        'Retrieved cross-channel messages'
      );
    });
  });

  // Note: clearHistory and cleanupOldHistory tests moved to ConversationRetentionService.test.ts
  // Note: Soft delete / edit sync tests moved to ConversationSyncService.test.ts

  describe('getChannelHistoryWindow - Soft Delete Filtering', () => {
    it('should exclude soft-deleted messages (deletedAt not null)', async () => {
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      await getChannelHistoryWindow(mockPrismaClient as unknown as PrismaClient, {
        channelId: 'channel-123',
        cap: 20,
      });

      expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
          }),
        })
      );
    });
  });

  describe('getChannelHistoryWindow - Cross-Personality Channel History', () => {
    it('should fetch messages without personality filter', async () => {
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      await getChannelHistoryWindow(mockPrismaClient as unknown as PrismaClient, {
        channelId: 'channel-123',
        cap: 20,
      });

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

    it('scopes the window to one personality when personalityId is supplied', async () => {
      // cap 22 pushes into the eviction-chunk regime, which routes through the
      // transaction path (readWindowIn) — the count and the fetch must both
      // see the SAME predicate, or the window's count and its rows would
      // describe two different row sets.
      mockPrismaClient.conversationHistory.count.mockResolvedValue(5);
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      await getChannelHistoryWindow(mockPrismaClient as unknown as PrismaClient, {
        channelId: 'channel-123',
        cap: 22,
        personalityId: 'personality-456',
      });

      const countArg = mockPrismaClient.conversationHistory.count.mock.calls[0][0];
      const findManyArg = mockPrismaClient.conversationHistory.findMany.mock.calls[0][0];
      expect(countArg.where.personalityId).toBe('personality-456');
      expect(findManyArg.where.personalityId).toBe('personality-456');
      // Same predicate object reference — the shared-builder guarantee the
      // module doc describes, not two independently-built where clauses.
      expect(countArg.where).toBe(findManyArg.where);
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
          channelId: 'channel-123',
          guildId: 'guild-456',
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
          channelId: 'channel-123',
          guildId: 'guild-456',
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

      const { messages: result } = await getChannelHistoryWindow(
        mockPrismaClient as unknown as PrismaClient,
        {
          channelId: 'channel-123',
          cap: 20,
        }
      );

      expect(result).toHaveLength(2);
      // Service reverses to chronological order (oldest first)
      expect(result[0].id).toBe('msg-1');
      expect(result[1].id).toBe('msg-2');
    });

    it('should apply context epoch filter when provided', async () => {
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);
      const contextEpoch = new Date('2025-01-01T00:00:00Z');

      await getChannelHistoryWindow(mockPrismaClient as unknown as PrismaClient, {
        channelId: 'channel-123',
        cap: 20,
        contextEpoch,
      });

      // gte (not gt) — matches the DiscordChannelFetcher inclusive cutoff
      // semantic and ensures a message timestamped at the exact reset moment
      // is included rather than dropped at the boundary.
      expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            channelId: 'channel-123',
            deletedAt: null,
            createdAt: {
              gte: contextEpoch,
            },
          }),
        })
      );
    });

    describe('time-filter behavior', () => {
      // Fake timers per project standard (02-code-standards.md) — collapses the
      // wall-clock tolerance window to a deterministic equality check, immune
      // to slow CI.
      beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      it('should apply maxAge filter when provided (no contextEpoch)', async () => {
        mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

        await getChannelHistoryWindow(mockPrismaClient as unknown as PrismaClient, {
          channelId: 'channel-123',
          cap: 20,
          maxAgeSeconds: 60,
        }); // 60s

        const call = mockPrismaClient.conversationHistory.findMany.mock.calls[0][0];
        expect(call.where.createdAt.gte).toEqual(new Date('2026-05-10T11:59:00Z'));
      });

      it('should pick the more recent of maxAge and contextEpoch when both provided', async () => {
        mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);
        // contextEpoch is 1 hour ago; maxAge=60s gives a 60s-ago cutoff
        // The 60s-ago cutoff is more recent → it wins
        const contextEpoch = new Date('2026-05-10T11:00:00Z');

        await getChannelHistoryWindow(mockPrismaClient as unknown as PrismaClient, {
          channelId: 'channel-123',
          cap: 20,
          contextEpoch,
          maxAgeSeconds: 60,
        });

        const call = mockPrismaClient.conversationHistory.findMany.mock.calls[0][0];
        expect(call.where.createdAt.gte).toEqual(new Date('2026-05-10T11:59:00Z'));
      });

      it('omits the time filter when neither maxAge nor contextEpoch is provided', async () => {
        mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

        await getChannelHistoryWindow(mockPrismaClient as unknown as PrismaClient, {
          channelId: 'channel-123',
          cap: 20,
        });

        const call = mockPrismaClient.conversationHistory.findMany.mock.calls[0][0];
        expect(call.where).not.toHaveProperty('createdAt');
      });
    });

    it('should return empty array on error', async () => {
      mockPrismaClient.conversationHistory.findMany.mockRejectedValue(
        new Error('Database query failed')
      );

      const { messages, meta } = await getChannelHistoryWindow(
        mockPrismaClient as unknown as PrismaClient,
        {
          channelId: 'channel-123',
          cap: 20,
        }
      );

      expect(messages).toEqual([]);
      // An empty window and a failed read look identical without this flag.
      expect(meta.degraded).toBe(true);
    });
  });

  describe('getChannelHistoryWindow - count-cap hysteresis', () => {
    const row = (id: string, minute: number) => ({
      id,
      role: MessageRole.User,
      content: `message ${id}`,
      tokenCount: 1,
      createdAt: new Date(`2026-01-01T00:${String(minute).padStart(2, '0')}:00Z`),
      personaId: 'persona-1',
      personalityId: 'personality-1',
      discordMessageId: [`discord-${id}`],
      messageMetadata: null,
      persona: { name: 'Alice', preferredName: null, owner: { username: 'alice' } },
      personality: { name: 'Bot', displayName: 'Bot' },
    });

    it('reads the count and the rows inside ONE repeatable-read transaction', async () => {
      // The isolation level is the whole point of the transaction: without it a
      // write between the two reads makes the window arithmetic describe a row
      // set that no longer exists.
      mockPrismaClient.conversationHistory.count.mockResolvedValue(10);
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      await getChannelHistoryWindow(mockPrismaClient as unknown as PrismaClient, {
        channelId: 'channel-1',
        cap: 50,
      });

      expect(mockPrismaClient.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'RepeatableRead',
      });
    });

    it('gives the count and the fetch the very same predicate object', async () => {
      mockPrismaClient.conversationHistory.count.mockResolvedValue(10);
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      await getChannelHistoryWindow(mockPrismaClient as unknown as PrismaClient, {
        channelId: 'channel-1',
        cap: 50,
      });

      const countWhere = mockPrismaClient.conversationHistory.count.mock.calls[0][0].where;
      const fetchWhere = mockPrismaClient.conversationHistory.findMany.mock.calls[0][0].where;
      // Reference identity, not deep equality: two separately-built predicates
      // could match today and drift apart later with nothing to detect it.
      expect(countWhere).toBe(fetchWhere);
    });

    it('excludes the trigger message DB-side, in the predicate both reads share', async () => {
      mockPrismaClient.conversationHistory.count.mockResolvedValue(10);
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      await getChannelHistoryWindow(mockPrismaClient as unknown as PrismaClient, {
        channelId: 'channel-1',
        cap: 50,
        excludeDiscordMessageId: 'trigger-99',
      });

      expect(mockPrismaClient.conversationHistory.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          NOT: { discordMessageId: { has: 'trigger-99' } },
        }),
      });
    });

    it('applies the trigger exclusion on the un-snapshotted path too', async () => {
      // The two paths share one `where` object built by the caller, so this
      // cannot diverge today — but nothing pins that. The reference-identity
      // test covers only the transactional branch, so a future refactor that
      // rebuilt the predicate inside the cap-only branch would silently stop
      // excluding the trigger for every sub-21 cap. `maxMessages` accepts 1.
      mockPrismaClient.conversationHistory.count.mockResolvedValue(5);
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      await getChannelHistoryWindow(mockPrismaClient as unknown as PrismaClient, {
        channelId: 'channel-1',
        cap: 10,
        excludeDiscordMessageId: 'trigger-99',
      });

      expect(mockPrismaClient.$transaction).not.toHaveBeenCalled();
      expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ NOT: { discordMessageId: { has: 'trigger-99' } } }),
        })
      );
    });

    it('omits the exclusion entirely when no trigger id is given', async () => {
      mockPrismaClient.conversationHistory.count.mockResolvedValue(10);
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      await getChannelHistoryWindow(mockPrismaClient as unknown as PrismaClient, {
        channelId: 'channel-1',
        cap: 50,
      });

      const where = mockPrismaClient.conversationHistory.count.mock.calls[0][0].where;
      expect(where).not.toHaveProperty('NOT');
    });

    it('quantizes the fetch size once the window is over the cap', async () => {
      // n=100, cap=50 -> chunk 13, evicted 13*ceil(50/13) = 52, take 48.
      // The un-quantized answer would be take=50; that is the sliding head.
      mockPrismaClient.conversationHistory.count.mockResolvedValue(100);
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      const { meta } = await getChannelHistoryWindow(mockPrismaClient as unknown as PrismaClient, {
        channelId: 'channel-1',
        cap: 50,
      });

      expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 48 })
      );
      expect(meta).toMatchObject({ inScopeCount: 100, evicted: 52, take: 48, chunk: 13 });
    });

    it('skips the fetch entirely when the window resolves to zero rows', async () => {
      mockPrismaClient.conversationHistory.count.mockResolvedValue(0);
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      const { messages, meta } = await getChannelHistoryWindow(
        mockPrismaClient as unknown as PrismaClient,
        {
          channelId: 'channel-1',
          cap: 50,
        }
      );

      expect(mockPrismaClient.conversationHistory.findMany).not.toHaveBeenCalled();
      expect(messages).toEqual([]);
      expect(meta.degraded).toBe(false);
    });

    it('skips the fetch entirely when the cap itself is zero', async () => {
      mockPrismaClient.conversationHistory.count.mockResolvedValue(0);

      const { messages, meta } = await getChannelHistoryWindow(
        mockPrismaClient as unknown as PrismaClient,
        { channelId: 'channel-1', cap: 0 }
      );

      expect(mockPrismaClient.conversationHistory.findMany).not.toHaveBeenCalled();
      expect(messages).toEqual([]);
      // An empty window and a FAILED read both surface as zero messages, so the
      // row count alone cannot tell them apart — `degraded` is the field that
      // does, and asserting it is what makes this an empty-by-design claim.
      expect(meta.degraded).toBe(false);
      expect(meta.take).toBe(0);
    });

    it('shares the SAME predicate between the count and the fetch on the cap-only path', async () => {
      mockPrismaClient.conversationHistory.count.mockResolvedValue(5);
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      await getChannelHistoryWindow(mockPrismaClient as unknown as PrismaClient, {
        channelId: 'channel-1',
        cap: 10,
      });

      // Sharing the predicate object is the mechanism: two independently-built
      // predicates would count one row set and window another with nothing to
      // detect it.
      const countWhere = mockPrismaClient.conversationHistory.count.mock.calls[0][0].where;
      const findManyWhere = mockPrismaClient.conversationHistory.findMany.mock.calls[0][0].where;
      expect(countWhere).toBe(findManyWhere);
    });

    it('skips the transaction entirely when the cap cannot quantize', async () => {
      // The snapshot couples the count to the fetch so the eviction computed
      // from one applies to the other. With chunk 0 there is no eviction, so
      // there is nothing to couple — and holding a pooled connection across two
      // sequential queries is exactly the cost the rollout is told to watch.
      // `resolveEvictionChunk` is cap-only, so this is decidable before opening
      // anything.
      mockPrismaClient.conversationHistory.count.mockResolvedValue(500);
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      const { meta } = await getChannelHistoryWindow(mockPrismaClient as unknown as PrismaClient, {
        channelId: 'channel-1',
        cap: 10,
      });

      expect(mockPrismaClient.$transaction).not.toHaveBeenCalled();
      // ...and the count still happens: inScopeCount is the only signal for how
      // much history the cap dropped, so the cheap path must not buy its speed
      // by giving up the telemetry.
      expect(mockPrismaClient.conversationHistory.count).toHaveBeenCalledTimes(1);
      expect(meta).toMatchObject({ inScopeCount: 500, evicted: 0, chunk: 0 });
    });

    it('fetches the CAP, not the counted value, on the un-snapshotted path', async () => {
      // The bug this pins: deriving `take` from the count bounds the fetch by a
      // number a concurrent insert can already have invalidated, and without a
      // transaction there is nothing holding the two together. Asking for the
      // cap lets Postgres self-limit, which is what makes the missing snapshot
      // harmless — and it is the ONLY thing that does.
      //
      // The interleaving itself is not representable in a synchronous mock, but
      // it does not need to be: `take === cap` is the property that makes the
      // interleaving benign, and that is checkable right here.
      mockPrismaClient.conversationHistory.count.mockResolvedValue(8);
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      await getChannelHistoryWindow(mockPrismaClient as unknown as PrismaClient, {
        channelId: 'channel-1',
        cap: 10,
      });

      expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 })
      );
    });

    it('keeps already-fetched rows when the telemetry count fails', async () => {
      // The second round trip is new failure surface: before the window, this
      // path was one query with nothing downstream of it that could throw. A
      // count blip must cost a telemetry field, not the turn's entire history.
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([row('a', 2), row('b', 1)]);
      mockPrismaClient.conversationHistory.count.mockRejectedValue(new Error('pool timeout'));

      const { messages, meta } = await getChannelHistoryWindow(
        mockPrismaClient as unknown as PrismaClient,
        { channelId: 'channel-1', cap: 10 }
      );

      expect(messages).toHaveLength(2);
      expect(meta.degraded).toBe(false);
      // inScopeCount falls back to what was actually fetched — understated, but
      // never below `take`, and never a reason to throw the rows away.
      expect(meta.inScopeCount).toBe(2);
      expect(meta.take).toBe(2);
    });

    it('reports take as rows ACTUALLY returned, and never below inScopeCount', async () => {
      // Un-snapshotted, so the count can lag the fetch. `take` must describe the
      // rows in hand rather than a prediction, and the meta must not claim fewer
      // rows exist than were just returned.
      mockPrismaClient.conversationHistory.count.mockResolvedValue(8);
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([
        row('a', 3),
        row('b', 2),
        row('c', 1),
      ]);

      const { meta } = await getChannelHistoryWindow(mockPrismaClient as unknown as PrismaClient, {
        channelId: 'channel-1',
        cap: 10,
      });

      expect(meta.take).toBe(3);
      expect(meta.inScopeCount).toBeGreaterThanOrEqual(meta.take);
    });

    it('DOES open the transaction once the cap can quantize', async () => {
      mockPrismaClient.conversationHistory.count.mockResolvedValue(500);
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      await getChannelHistoryWindow(mockPrismaClient as unknown as PrismaClient, {
        channelId: 'channel-1',
        cap: 50,
      });

      expect(mockPrismaClient.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'RepeatableRead',
      });
    });

    it('reports the TRUE row count when hysteresis is off and the channel is over cap', async () => {
      // Regression: meta.inScopeCount was reconstructed as `evicted + take`,
      // which equals the CAP here — chunk is 0 below cap 21, so nothing is
      // evicted and take saturates. `maxMessages` accepts 1, so this is a
      // reachable prod configuration, not a boundary curiosity.
      mockPrismaClient.conversationHistory.count.mockResolvedValue(500);
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      const { meta } = await getChannelHistoryWindow(mockPrismaClient as unknown as PrismaClient, {
        channelId: 'channel-1',
        cap: 10,
      });

      expect(meta.inScopeCount).toBe(500);
      expect(meta).toMatchObject({ evicted: 0, chunk: 0 });
    });

    it('emits the window telemetry at INFO, not debug', async () => {
      // The design is judged by these fields in prod logs, and prod defaults to
      // LOG_LEVEL=info — at debug the acceptance evidence simply is not there,
      // and nobody would know to bump the level to look for it. Demoting this
      // line would silently un-verify the whole mechanism, so the level is
      // pinned rather than left to convention.
      mockPrismaClient.conversationHistory.count.mockResolvedValue(3);
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([row('oldest', 1)]);

      await getChannelHistoryWindow(mockPrismaClient as unknown as PrismaClient, {
        channelId: 'channel-1',
        cap: 50,
      });

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.objectContaining({ headRowId: 'oldest', channelId: 'channel-1' }),
        'Retrieved channel history window'
      );
    });

    it('reports the OLDEST returned row as the window head', async () => {
      // findMany returns newest-first; the head is the other end.
      mockPrismaClient.conversationHistory.count.mockResolvedValue(3);
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([
        row('newest', 3),
        row('middle', 2),
        row('oldest', 1),
      ]);

      const { messages, meta } = await getChannelHistoryWindow(
        mockPrismaClient as unknown as PrismaClient,
        {
          channelId: 'channel-1',
          cap: 50,
        }
      );

      expect(messages.map(m => m.id)).toEqual(['oldest', 'middle', 'newest']);
      expect(meta.headRowId).toBe('oldest');
    });
  });

  describe('getCrossChannelHistory', () => {
    it('should query with correct WHERE clause', async () => {
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      await service.getCrossChannelHistory('persona-1', 'personality-1', 'current-channel', 50);

      expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            personaId: 'persona-1',
            personalityId: 'personality-1',
            channelId: { not: 'current-channel' },
            deletedAt: null,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 50,
          select: expect.objectContaining({
            channelId: true,
            guildId: true,
          }),
        })
      );
    });

    it('should cap limit at 100', async () => {
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      await service.getCrossChannelHistory('persona-1', 'personality-1', 'current-channel', 200);

      expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 100,
        })
      );
    });

    it('should return empty array when no messages found', async () => {
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      const result = await service.getCrossChannelHistory(
        'persona-1',
        'personality-1',
        'current-channel'
      );

      expect(result).toEqual([]);
    });

    it('should group messages by channelId', async () => {
      const mockMessages = [
        {
          id: 'msg-3',
          role: MessageRole.Assistant,
          content: 'Reply in channel A',
          tokenCount: 5,
          createdAt: new Date('2025-01-03T00:00:00Z'),
          personaId: 'persona-1',
          personalityId: 'personality-1',
          channelId: 'channel-a',
          guildId: 'guild-1',
          discordMessageId: ['d-3'],
          messageMetadata: null,
          persona: { name: 'User', preferredName: null, owner: { username: 'user1' } },
          personality: { name: 'TestBot', displayName: 'Test Bot' },
        },
        {
          id: 'msg-2',
          role: MessageRole.User,
          content: 'Hello in channel B',
          tokenCount: 4,
          createdAt: new Date('2025-01-02T00:00:00Z'),
          personaId: 'persona-1',
          personalityId: 'personality-1',
          channelId: 'channel-b',
          guildId: 'guild-1',
          discordMessageId: ['d-2'],
          messageMetadata: null,
          persona: { name: 'User', preferredName: null, owner: { username: 'user1' } },
          personality: { name: 'TestBot', displayName: 'Test Bot' },
        },
        {
          id: 'msg-1',
          role: MessageRole.User,
          content: 'Hello in channel A',
          tokenCount: 3,
          createdAt: new Date('2025-01-01T00:00:00Z'),
          personaId: 'persona-1',
          personalityId: 'personality-1',
          channelId: 'channel-a',
          guildId: 'guild-1',
          discordMessageId: ['d-1'],
          messageMetadata: null,
          persona: { name: 'User', preferredName: null, owner: { username: 'user1' } },
          personality: { name: 'TestBot', displayName: 'Test Bot' },
        },
      ];

      mockPrismaClient.conversationHistory.findMany.mockResolvedValue(mockMessages);

      const result = await service.getCrossChannelHistory(
        'persona-1',
        'personality-1',
        'current-channel'
      );

      expect(result).toHaveLength(2);
      // Groups are sorted by their newest message ASC, so the channel whose
      // most-recent activity is older comes first. Channel B's newest message
      // is older than Channel A's, so B appears first and A appears last —
      // closer to current_conversation, matching the LLM's "most-recent
      // context closest to the current turn" intuition.
      expect(result[0].channelId).toBe('channel-b');
      expect(result[0].messages).toHaveLength(1);
      expect(result[0].messages[0].id).toBe('msg-2');

      expect(result[1].channelId).toBe('channel-a');
      expect(result[1].guildId).toBe('guild-1');
      expect(result[1].messages).toHaveLength(2);
      // Messages within group are chronological (oldest first)
      expect(result[1].messages[0].id).toBe('msg-1');
      expect(result[1].messages[1].id).toBe('msg-3');
    });

    it('should handle DM channels with null guildId', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          role: MessageRole.User,
          content: 'DM message',
          tokenCount: 3,
          createdAt: new Date('2025-01-01T00:00:00Z'),
          personaId: 'persona-1',
          personalityId: 'personality-1',
          channelId: 'dm-channel',
          guildId: null,
          discordMessageId: ['d-1'],
          messageMetadata: null,
          persona: { name: 'User', preferredName: null, owner: { username: 'user1' } },
          personality: { name: 'TestBot', displayName: 'Test Bot' },
        },
      ];

      mockPrismaClient.conversationHistory.findMany.mockResolvedValue(mockMessages);

      const result = await service.getCrossChannelHistory(
        'persona-1',
        'personality-1',
        'current-channel'
      );

      expect(result).toHaveLength(1);
      expect(result[0].channelId).toBe('dm-channel');
      expect(result[0].guildId).toBeNull();
    });

    it('should return empty array on error', async () => {
      mockPrismaClient.conversationHistory.findMany.mockRejectedValue(
        new Error('Database query failed')
      );

      const result = await service.getCrossChannelHistory(
        'persona-1',
        'personality-1',
        'current-channel'
      );

      expect(result).toEqual([]);
    });

    it('should use default limit of 50', async () => {
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      await service.getCrossChannelHistory('persona-1', 'personality-1', 'current-channel');

      expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
        })
      );
    });

    describe('time-filter behavior', () => {
      // Fake timers per project standard (02-code-standards.md). See same block
      // in getChannelHistoryWindow tests above for rationale.
      beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      it('applies maxAge cutoff when provided', async () => {
        mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

        await service.getCrossChannelHistory('persona-1', 'personality-1', 'current-channel', 50, {
          maxAgeSeconds: 60,
        });

        const call = mockPrismaClient.conversationHistory.findMany.mock.calls[0][0];
        expect(call.where.createdAt.gte).toEqual(new Date('2026-05-10T11:59:00Z'));
      });

      it('applies contextEpoch cutoff when provided', async () => {
        mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);
        const epoch = new Date('2026-05-01T00:00:00Z');

        await service.getCrossChannelHistory('persona-1', 'personality-1', 'current-channel', 50, {
          contextEpoch: epoch,
        });

        expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              createdAt: { gte: epoch },
            }),
          })
        );
      });

      it('omits the time filter when neither maxAge nor contextEpoch is provided', async () => {
        mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

        await service.getCrossChannelHistory('persona-1', 'personality-1', 'current-channel');

        const call = mockPrismaClient.conversationHistory.findMany.mock.calls[0][0];
        expect(call.where).not.toHaveProperty('createdAt');
      });
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

    it('should return empty array when getChannelHistoryWindow fails', async () => {
      const error = new Error('Database query failed');
      mockPrismaClient.conversationHistory.findMany.mockRejectedValue(error);

      const { messages, meta } = await getChannelHistoryWindow(
        mockPrismaClient as unknown as PrismaClient,
        {
          channelId: 'channel-123',
          cap: 20,
        }
      );

      expect(messages).toEqual([]);
      // An empty window and a failed read look identical without this flag.
      expect(meta.degraded).toBe(true);
    });
  });
});
