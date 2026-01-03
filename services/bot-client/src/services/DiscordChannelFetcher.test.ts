/**
 * Tests for DiscordChannelFetcher
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Collection, MessageType } from 'discord.js';
import type { Message, TextChannel } from 'discord.js';
import { MessageRole } from '@tzurot/common-types';
import { DiscordChannelFetcher, type FetchableChannel } from './DiscordChannelFetcher.js';

// Mock the logger (keep everything else from actual module)
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    // Ensure MESSAGE_LIMITS is available for the module under test
    MESSAGE_LIMITS: {
      ...actual.MESSAGE_LIMITS,
      MAX_EXTENDED_CONTEXT: 100,
    },
  };
});

// Helper to create mock Discord messages
function createMockMessage(
  overrides: Partial<{
    id: string;
    content: string;
    authorId: string;
    authorUsername: string;
    authorGlobalName: string | null;
    memberDisplayName: string | null;
    isBot: boolean;
    type: MessageType;
    createdAt: Date;
    attachments: Map<string, { contentType: string | null; name: string | null }>;
  }>
): Message {
  const defaults = {
    id: '123456789',
    content: 'Test message',
    authorId: 'user123',
    authorUsername: 'testuser',
    authorGlobalName: null,
    memberDisplayName: null,
    isBot: false,
    type: MessageType.Default,
    createdAt: new Date('2024-01-01T12:00:00Z'),
    attachments: new Map(),
  };

  const config = { ...defaults, ...overrides };

  return {
    id: config.id,
    content: config.content,
    author: {
      id: config.authorId,
      username: config.authorUsername,
      globalName: config.authorGlobalName,
      bot: config.isBot,
    },
    member: config.memberDisplayName ? { displayName: config.memberDisplayName } : null,
    type: config.type,
    createdAt: config.createdAt,
    createdTimestamp: config.createdAt.getTime(),
    attachments: new Collection(config.attachments),
  } as unknown as Message;
}

// Helper to create mock channel
function createMockChannel(messages: Message[]): FetchableChannel {
  const messageCollection = new Collection<string, Message>();
  for (const msg of messages) {
    messageCollection.set(msg.id, msg);
  }

  return {
    id: 'channel123',
    messages: {
      fetch: vi.fn().mockResolvedValue(messageCollection),
    },
  } as unknown as TextChannel;
}

describe('DiscordChannelFetcher', () => {
  let fetcher: DiscordChannelFetcher;

  beforeEach(() => {
    vi.clearAllMocks();
    fetcher = new DiscordChannelFetcher();
  });

  describe('fetchRecentMessages', () => {
    it('should fetch and convert messages from Discord', async () => {
      const messages = [
        createMockMessage({
          id: '1',
          content: 'Hello world',
          authorId: 'user1',
          authorUsername: 'alice',
          createdAt: new Date('2024-01-01T12:00:00Z'),
        }),
        createMockMessage({
          id: '2',
          content: 'Hi there',
          authorId: 'user2',
          authorUsername: 'bob',
          createdAt: new Date('2024-01-01T12:01:00Z'),
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.fetchedCount).toBe(2);
      expect(result.filteredCount).toBe(2);
      expect(result.messages).toHaveLength(2);

      // Should be newest first
      expect(result.messages[0].content).toBe('[bob]: Hi there');
      expect(result.messages[1].content).toBe('[alice]: Hello world');
    });

    it('should identify bot messages as assistant role', async () => {
      const botUserId = 'bot123';

      const messages = [
        createMockMessage({
          id: '1',
          content: 'User message',
          authorId: 'user1',
          authorUsername: 'alice',
        }),
        createMockMessage({
          id: '2',
          content: 'Bot response',
          authorId: botUserId,
          authorUsername: 'TestBot',
          isBot: true,
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId,
        personalityName: 'TestPersonality',
      });

      const userMsg = result.messages.find(m => m.role === MessageRole.User);
      const assistantMsg = result.messages.find(m => m.role === MessageRole.Assistant);

      expect(userMsg).toBeDefined();
      expect(userMsg!.content).toBe('[alice]: User message');

      expect(assistantMsg).toBeDefined();
      expect(assistantMsg!.content).toBe('Bot response');
      expect(assistantMsg!.personaName).toBe('TestPersonality');
    });

    it('should filter out system messages', async () => {
      const messages = [
        createMockMessage({
          id: '1',
          content: 'Normal message',
          type: MessageType.Default,
        }),
        createMockMessage({
          id: '2',
          content: 'User joined the server',
          type: MessageType.UserJoin,
        }),
        createMockMessage({
          id: '3',
          content: 'Someone boosted the server',
          type: MessageType.GuildBoost,
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.fetchedCount).toBe(3);
      expect(result.filteredCount).toBe(1);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toContain('Normal message');
    });

    it('should include Reply messages', async () => {
      const messages = [
        createMockMessage({
          id: '1',
          content: 'Original message',
          type: MessageType.Default,
        }),
        createMockMessage({
          id: '2',
          content: 'This is a reply',
          type: MessageType.Reply,
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.messages).toHaveLength(2);
    });

    it('should filter empty messages without attachments', async () => {
      const messages = [
        createMockMessage({
          id: '1',
          content: 'Has content',
        }),
        createMockMessage({
          id: '2',
          content: '',
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.filteredCount).toBe(1);
      expect(result.messages[0].content).toContain('Has content');
    });

    it('should include empty messages with attachments', async () => {
      const messages = [
        createMockMessage({
          id: '1',
          content: '',
          authorUsername: 'alice',
          attachments: new Map([['att1', { contentType: 'image/png', name: 'photo.png' }]]),
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toContain('[image/png: photo.png]');
    });

    it('should use display name for user messages', async () => {
      const messages = [
        createMockMessage({
          id: '1',
          content: 'Hello',
          authorUsername: 'alice_123',
          memberDisplayName: 'Alice',
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.messages[0].content).toBe('[Alice]: Hello');
    });

    it('should use global name when display name is not available', async () => {
      const messages = [
        createMockMessage({
          id: '1',
          content: 'Hello',
          authorUsername: 'alice_123',
          authorGlobalName: 'AliceG',
          memberDisplayName: null,
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.messages[0].content).toBe('[AliceG]: Hello');
    });

    it('should respect before parameter', async () => {
      const messages = [createMockMessage({ id: '1', content: 'First' })];

      const channel = createMockChannel(messages);

      await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
        before: 'message999',
      });

      expect(channel.messages.fetch).toHaveBeenCalledWith({
        limit: 100,
        before: 'message999',
      });
    });

    it('should handle fetch errors gracefully', async () => {
      const channel = {
        id: 'channel123',
        messages: {
          fetch: vi.fn().mockRejectedValue(new Error('Permission denied')),
        },
      } as unknown as TextChannel;

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.messages).toEqual([]);
      expect(result.fetchedCount).toBe(0);
      expect(result.filteredCount).toBe(0);
    });
  });

  describe('mergeWithHistory', () => {
    it('should deduplicate messages by Discord ID', () => {
      const extendedMessages = [
        {
          id: 'msg1',
          role: MessageRole.User,
          content: '[Alice]: Hello from Discord',
          createdAt: new Date('2024-01-01T12:00:00Z'),
          personaId: 'discord:user1',
          discordMessageId: ['discord1'],
        },
        {
          id: 'msg2',
          role: MessageRole.User,
          content: '[Bob]: Also from Discord',
          createdAt: new Date('2024-01-01T12:01:00Z'),
          personaId: 'discord:user2',
          discordMessageId: ['discord2'],
        },
      ];

      const dbHistory = [
        {
          id: 'db1',
          role: MessageRole.User,
          content: '[Alice]: Hello from DB',
          createdAt: new Date('2024-01-01T12:00:00Z'),
          personaId: 'persona1',
          discordMessageId: ['discord1'], // Same as first extended message
        },
      ];

      const merged = fetcher.mergeWithHistory(extendedMessages, dbHistory);

      // Should have 2 messages: 1 from DB (deduplicated), 1 unique from extended
      expect(merged).toHaveLength(2);
      // DB message should be present (has priority)
      expect(merged.some(m => m.content === '[Alice]: Hello from DB')).toBe(true);
      // Unique extended message should be present
      expect(merged.some(m => m.content === '[Bob]: Also from Discord')).toBe(true);
      // Duplicate from extended should NOT be present
      expect(merged.some(m => m.content === '[Alice]: Hello from Discord')).toBe(false);
    });

    it('should sort merged messages by timestamp (newest first)', () => {
      const extendedMessages = [
        {
          id: 'ext1',
          role: MessageRole.User,
          content: '[Charlie]: Newest',
          createdAt: new Date('2024-01-01T12:05:00Z'),
          personaId: 'discord:user3',
          discordMessageId: ['discord3'],
        },
      ];

      const dbHistory = [
        {
          id: 'db1',
          role: MessageRole.User,
          content: '[Alice]: Oldest',
          createdAt: new Date('2024-01-01T12:00:00Z'),
          personaId: 'persona1',
          discordMessageId: ['discord1'],
        },
        {
          id: 'db2',
          role: MessageRole.User,
          content: '[Bob]: Middle',
          createdAt: new Date('2024-01-01T12:02:00Z'),
          personaId: 'persona2',
          discordMessageId: ['discord2'],
        },
      ];

      const merged = fetcher.mergeWithHistory(extendedMessages, dbHistory);

      expect(merged[0].content).toBe('[Charlie]: Newest');
      expect(merged[1].content).toBe('[Bob]: Middle');
      expect(merged[2].content).toBe('[Alice]: Oldest');
    });

    it('should handle empty extended messages', () => {
      const dbHistory = [
        {
          id: 'db1',
          role: MessageRole.User,
          content: '[Alice]: From DB',
          createdAt: new Date('2024-01-01T12:00:00Z'),
          personaId: 'persona1',
          discordMessageId: ['discord1'],
        },
      ];

      const merged = fetcher.mergeWithHistory([], dbHistory);

      expect(merged).toHaveLength(1);
      expect(merged[0].content).toBe('[Alice]: From DB');
    });

    it('should handle empty DB history', () => {
      const extendedMessages = [
        {
          id: 'ext1',
          role: MessageRole.User,
          content: '[Alice]: From Discord',
          createdAt: new Date('2024-01-01T12:00:00Z'),
          personaId: 'discord:user1',
          discordMessageId: ['discord1'],
        },
      ];

      const merged = fetcher.mergeWithHistory(extendedMessages, []);

      expect(merged).toHaveLength(1);
      expect(merged[0].content).toBe('[Alice]: From Discord');
    });
  });

  describe('syncWithDatabase', () => {
    it('should return empty result when no Discord messages', async () => {
      const emptyMessages = new Collection<string, Message>();
      const mockSyncService = {
        getMessagesByDiscordIds: vi.fn(),
        updateMessageContent: vi.fn(),
        softDeleteMessages: vi.fn(),
        getMessagesInTimeWindow: vi.fn(),
      };

      const result = await fetcher.syncWithDatabase(
        emptyMessages,
        'channel123',
        'personality123',
        mockSyncService as never
      );

      expect(result.updated).toBe(0);
      expect(result.deleted).toBe(0);
      expect(mockSyncService.getMessagesByDiscordIds).not.toHaveBeenCalled();
    });

    it('should return empty result when no matching DB messages', async () => {
      const discordMessages = new Collection<string, Message>();
      discordMessages.set('discord1', createMockMessage({ id: 'discord1', content: 'Hello' }));

      const mockSyncService = {
        getMessagesByDiscordIds: vi.fn().mockResolvedValue(new Map()),
        updateMessageContent: vi.fn(),
        softDeleteMessages: vi.fn(),
        getMessagesInTimeWindow: vi.fn(),
      };

      const result = await fetcher.syncWithDatabase(
        discordMessages,
        'channel123',
        'personality123',
        mockSyncService as never
      );

      expect(result.updated).toBe(0);
      expect(result.deleted).toBe(0);
    });

    it('should detect and sync edited messages', async () => {
      const discordMessages = new Collection<string, Message>();
      discordMessages.set(
        'discord1',
        createMockMessage({
          id: 'discord1',
          content: 'Updated message content',
          createdAt: new Date('2024-01-01T12:00:00Z'),
        })
      );

      const mockSyncService = {
        getMessagesByDiscordIds: vi.fn().mockResolvedValue(
          new Map([
            [
              'discord1',
              {
                id: 'db-msg-1',
                content: 'Original message content',
                discordMessageId: ['discord1'],
                deletedAt: null,
                createdAt: new Date('2024-01-01T12:00:00Z'),
              },
            ],
          ])
        ),
        updateMessageContent: vi.fn().mockResolvedValue(true),
        softDeleteMessages: vi.fn().mockResolvedValue(0),
        getMessagesInTimeWindow: vi.fn().mockResolvedValue([]),
      };

      const result = await fetcher.syncWithDatabase(
        discordMessages,
        'channel123',
        'personality123',
        mockSyncService as never
      );

      expect(result.updated).toBe(1);
      expect(mockSyncService.updateMessageContent).toHaveBeenCalledWith(
        'db-msg-1',
        'Updated message content'
      );
    });

    it('should not update messages when content matches (with prefix)', async () => {
      const discordMessages = new Collection<string, Message>();
      discordMessages.set(
        'discord1',
        createMockMessage({
          id: 'discord1',
          content: 'Hello world',
          createdAt: new Date('2024-01-01T12:00:00Z'),
        })
      );

      const mockSyncService = {
        getMessagesByDiscordIds: vi.fn().mockResolvedValue(
          new Map([
            [
              'discord1',
              {
                id: 'db-msg-1',
                content: '[Alice]: Hello world', // Has prefix but same content
                discordMessageId: ['discord1'],
                deletedAt: null,
                createdAt: new Date('2024-01-01T12:00:00Z'),
              },
            ],
          ])
        ),
        updateMessageContent: vi.fn(),
        softDeleteMessages: vi.fn(),
        getMessagesInTimeWindow: vi.fn().mockResolvedValue([]),
      };

      const result = await fetcher.syncWithDatabase(
        discordMessages,
        'channel123',
        'personality123',
        mockSyncService as never
      );

      expect(result.updated).toBe(0);
      expect(mockSyncService.updateMessageContent).not.toHaveBeenCalled();
    });

    it('should detect and soft-delete missing messages', async () => {
      const discordMessages = new Collection<string, Message>();
      // Only one message in Discord
      discordMessages.set(
        'discord2',
        createMockMessage({
          id: 'discord2',
          content: 'Still exists',
          createdAt: new Date('2024-01-01T12:00:00Z'),
        })
      );

      const mockSyncService = {
        getMessagesByDiscordIds: vi.fn().mockResolvedValue(
          new Map([
            [
              'discord2',
              {
                id: 'db-msg-2',
                content: 'Still exists',
                discordMessageId: ['discord2'],
                deletedAt: null,
                createdAt: new Date('2024-01-01T12:00:00Z'),
              },
            ],
          ])
        ),
        updateMessageContent: vi.fn(),
        softDeleteMessages: vi.fn().mockResolvedValue(1),
        getMessagesInTimeWindow: vi.fn().mockResolvedValue([
          // This message is in DB but not in Discord - should be deleted
          {
            id: 'db-msg-1',
            discordMessageId: ['discord1'],
            createdAt: new Date('2024-01-01T12:00:00Z'),
          },
          // This message is in both - should NOT be deleted
          {
            id: 'db-msg-2',
            discordMessageId: ['discord2'],
            createdAt: new Date('2024-01-01T12:00:00Z'),
          },
        ]),
      };

      const result = await fetcher.syncWithDatabase(
        discordMessages,
        'channel123',
        'personality123',
        mockSyncService as never
      );

      expect(result.deleted).toBe(1);
      expect(mockSyncService.softDeleteMessages).toHaveBeenCalledWith(['db-msg-1']);
    });

    it('should skip soft-deleted DB messages when checking for edits', async () => {
      const discordMessages = new Collection<string, Message>();
      discordMessages.set(
        'discord1',
        createMockMessage({
          id: 'discord1',
          content: 'New content',
          createdAt: new Date('2024-01-01T12:00:00Z'),
        })
      );

      const mockSyncService = {
        getMessagesByDiscordIds: vi.fn().mockResolvedValue(
          new Map([
            [
              'discord1',
              {
                id: 'db-msg-1',
                content: 'Old content',
                discordMessageId: ['discord1'],
                deletedAt: new Date(), // Already soft-deleted
                createdAt: new Date('2024-01-01T12:00:00Z'),
              },
            ],
          ])
        ),
        updateMessageContent: vi.fn(),
        softDeleteMessages: vi.fn().mockResolvedValue(0),
        getMessagesInTimeWindow: vi.fn().mockResolvedValue([]),
      };

      const result = await fetcher.syncWithDatabase(
        discordMessages,
        'channel123',
        'personality123',
        mockSyncService as never
      );

      expect(result.updated).toBe(0);
      expect(mockSyncService.updateMessageContent).not.toHaveBeenCalled();
    });

    it('should handle sync errors gracefully', async () => {
      const discordMessages = new Collection<string, Message>();
      discordMessages.set('discord1', createMockMessage({ id: 'discord1', content: 'Hello' }));

      const mockSyncService = {
        getMessagesByDiscordIds: vi.fn().mockRejectedValue(new Error('Database error')),
        updateMessageContent: vi.fn(),
        softDeleteMessages: vi.fn(),
        getMessagesInTimeWindow: vi.fn(),
      };

      const result = await fetcher.syncWithDatabase(
        discordMessages,
        'channel123',
        'personality123',
        mockSyncService as never
      );

      expect(result.updated).toBe(0);
      expect(result.deleted).toBe(0);
    });
  });
});
