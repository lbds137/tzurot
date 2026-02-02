/**
 * Tests for LinkExtractor
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LinkExtractor } from './LinkExtractor.js';
import { MessageFormatter } from './MessageFormatter.js';
import { SnapshotFormatter } from './SnapshotFormatter.js';
import { MessageLinkParser } from '../../utils/MessageLinkParser.js';
import { MessageReferenceType, Collection } from 'discord.js';
import { INTERVALS } from '@tzurot/common-types';
import type { Message, Guild, Channel, TextChannel, Client, MessageSnapshot } from 'discord.js';
import type { ReferencedMessage } from '@tzurot/common-types';

// Mock MessageLinkParser
vi.mock('../../utils/MessageLinkParser.js', () => ({
  MessageLinkParser: {
    parseMessageLinks: vi.fn(),
  },
}));

// Type for mock input - allows any properties to be overridden
type MockMessageInput = Record<string, unknown>;

// Helper to create mock Discord message
function createMockMessage(overrides: MockMessageInput = {}): Message {
  const mockChannel = {
    id: 'channel-123',
    type: 0, // GUILD_TEXT
    isTextBased: vi.fn(() => true),
    messages: {
      fetch: vi.fn(),
    },
  } as unknown as TextChannel;

  const mockGuild = {
    id: 'guild-123',
    name: 'Test Guild',
    channels: {
      cache: new Map([[mockChannel.id, mockChannel as Channel]]),
      fetch: vi.fn(),
    },
  } as unknown as Guild;

  const mockClient: Partial<Client> = {
    guilds: {
      cache: new Map([[mockGuild.id!, mockGuild as Guild]]),
      fetch: vi.fn(),
    } as any,
    channels: {
      fetch: vi.fn().mockResolvedValue(mockChannel),
    } as any,
  };

  return {
    id: 'msg-123',
    content: 'Test message',
    author: {
      id: 'user-123',
      username: 'TestUser',
      bot: false,
    } as any,
    guild: mockGuild as Guild,
    channel: mockChannel as TextChannel,
    client: mockClient as Client,
    createdAt: new Date(),
    webhookId: null,
    reference: null,
    messageSnapshots: undefined,
    ...overrides,
  } as unknown as Message;
}

// Helper to create referenced message matching ReferencedMessage schema
function createReferencedMessage(): ReferencedMessage {
  return {
    referenceNumber: 1,
    discordMessageId: 'ref-msg-123',
    discordUserId: 'user-123',
    authorUsername: 'TestAuthor',
    authorDisplayName: 'Test Author',
    content: 'Referenced content',
    embeds: '',
    timestamp: new Date().toISOString(),
    locationContext: 'Test Guild / #general',
  };
}

describe('LinkExtractor', () => {
  let linkExtractor: LinkExtractor;
  let mockMessageFormatter: MessageFormatter;
  let mockSnapshotFormatter: SnapshotFormatter;

  beforeEach(() => {
    mockMessageFormatter = {
      formatMessage: vi.fn().mockResolvedValue(createReferencedMessage()),
    } as any;

    mockSnapshotFormatter = {
      formatSnapshot: vi.fn().mockReturnValue(createReferencedMessage()),
    } as any;

    linkExtractor = new LinkExtractor(mockMessageFormatter, mockSnapshotFormatter);

    vi.clearAllMocks();
  });

  describe('extractLinkReferences', () => {
    it('should return empty arrays when no links found', async () => {
      const mockMessage = createMockMessage({ content: 'No links here' });
      vi.mocked(MessageLinkParser.parseMessageLinks).mockReturnValue([]);

      const [references, linkMap] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [],
        1
      );

      expect(references).toEqual([]);
      expect(linkMap.size).toBe(0);
    });

    it('should extract single message link reference', async () => {
      const mockMessage = createMockMessage();
      const mockReferencedMessage = createMockMessage({ id: 'ref-msg-123' });
      const mockChannel = mockMessage.channel as TextChannel;

      vi.mocked(MessageLinkParser.parseMessageLinks).mockReturnValue([
        {
          fullUrl: 'https://discord.com/channels/guild-123/channel-123/ref-msg-123',
          guildId: 'guild-123',
          channelId: 'channel-123',
          messageId: 'ref-msg-123',
        },
      ]);

      vi.mocked(mockChannel.messages.fetch).mockResolvedValue(mockReferencedMessage as any);

      const [references, linkMap] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [],
        1
      );

      expect(references).toHaveLength(1);
      expect(linkMap.size).toBe(1);
      expect(linkMap.get('https://discord.com/channels/guild-123/channel-123/ref-msg-123')).toBe(1);
      expect(mockMessageFormatter.formatMessage).toHaveBeenCalledWith(mockReferencedMessage, 1);
    });

    it('should skip duplicate link references already extracted from reply', async () => {
      const mockMessage = createMockMessage();
      const mockReferencedMessage = createMockMessage({ id: 'ref-msg-123' });
      const mockChannel = mockMessage.channel as TextChannel;

      vi.mocked(MessageLinkParser.parseMessageLinks).mockReturnValue([
        {
          fullUrl: 'https://discord.com/channels/guild-123/channel-123/ref-msg-123',
          guildId: 'guild-123',
          channelId: 'channel-123',
          messageId: 'ref-msg-123',
        },
      ]);

      vi.mocked(mockChannel.messages.fetch).mockResolvedValue(mockReferencedMessage as any);

      // Mark as already extracted
      const extractedMessageIds = new Set(['ref-msg-123']);

      const [references, linkMap] = await linkExtractor.extractLinkReferences(
        mockMessage,
        extractedMessageIds,
        new Set(),
        [],
        1
      );

      expect(references).toHaveLength(0);
      expect(linkMap.size).toBe(0);
      expect(mockMessageFormatter.formatMessage).not.toHaveBeenCalled();
    });

    it('should skip references already in conversation history', async () => {
      const mockMessage = createMockMessage();
      const mockReferencedMessage = createMockMessage({ id: 'ref-msg-123' });
      const mockChannel = mockMessage.channel as TextChannel;

      vi.mocked(MessageLinkParser.parseMessageLinks).mockReturnValue([
        {
          fullUrl: 'https://discord.com/channels/guild-123/channel-123/ref-msg-123',
          guildId: 'guild-123',
          channelId: 'channel-123',
          messageId: 'ref-msg-123',
        },
      ]);

      vi.mocked(mockChannel.messages.fetch).mockResolvedValue(mockReferencedMessage as any);

      // Mark as in conversation history
      const conversationHistoryMessageIds = new Set(['ref-msg-123']);

      const [references, linkMap] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        conversationHistoryMessageIds,
        [],
        1
      );

      expect(references).toHaveLength(0);
      expect(linkMap.size).toBe(0);
      expect(mockMessageFormatter.formatMessage).not.toHaveBeenCalled();
    });

    it('should handle forwarded messages with snapshots', async () => {
      const mockMessage = createMockMessage();
      const mockSnapshot = {
        message: {
          content: 'Forwarded content',
          embeds: [],
          attachments: new Collection(),
        },
      } as unknown as MessageSnapshot;

      const snapshotsCollection = new Collection<string, MessageSnapshot>();
      snapshotsCollection.set('snapshot-1', mockSnapshot);

      const mockReferencedMessage = createMockMessage({
        id: 'ref-msg-123',
        reference: {
          type: MessageReferenceType.Forward,
        },
        messageSnapshots: snapshotsCollection,
      });

      const mockChannel = mockMessage.channel as TextChannel;

      vi.mocked(MessageLinkParser.parseMessageLinks).mockReturnValue([
        {
          fullUrl: 'https://discord.com/channels/guild-123/channel-123/ref-msg-123',
          guildId: 'guild-123',
          channelId: 'channel-123',
          messageId: 'ref-msg-123',
        },
      ]);

      vi.mocked(mockChannel.messages.fetch).mockResolvedValue(mockReferencedMessage as any);

      const [references, linkMap] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [],
        1
      );

      expect(references).toHaveLength(1);
      expect(linkMap.size).toBe(1);
      expect(mockSnapshotFormatter.formatSnapshot).toHaveBeenCalledWith(
        mockSnapshot,
        1,
        mockReferencedMessage
      );
      expect(mockMessageFormatter.formatMessage).not.toHaveBeenCalled();
    });

    it('should handle multiple links with incrementing reference numbers', async () => {
      const mockMessage = createMockMessage();
      const mockRefMsg1 = createMockMessage({ id: 'ref-msg-1' });
      const mockRefMsg2 = createMockMessage({ id: 'ref-msg-2' });
      const mockChannel = mockMessage.channel as TextChannel;

      vi.mocked(MessageLinkParser.parseMessageLinks).mockReturnValue([
        {
          fullUrl: 'https://discord.com/channels/guild-123/channel-123/ref-msg-1',
          guildId: 'guild-123',
          channelId: 'channel-123',
          messageId: 'ref-msg-1',
        },
        {
          fullUrl: 'https://discord.com/channels/guild-123/channel-123/ref-msg-2',
          guildId: 'guild-123',
          channelId: 'channel-123',
          messageId: 'ref-msg-2',
        },
      ]);

      vi.mocked(mockChannel.messages.fetch)
        .mockResolvedValueOnce(mockRefMsg1 as any)
        .mockResolvedValueOnce(mockRefMsg2 as any);

      const [references, linkMap] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [],
        5
      );

      expect(references).toHaveLength(2);
      expect(linkMap.size).toBe(2);
      expect(mockMessageFormatter.formatMessage).toHaveBeenCalledWith(mockRefMsg1, 5);
      expect(mockMessageFormatter.formatMessage).toHaveBeenCalledWith(mockRefMsg2, 6);
    });

    it('should skip null messages (failed fetches)', async () => {
      const mockMessage = createMockMessage();
      const mockChannel = mockMessage.channel as TextChannel;

      vi.mocked(MessageLinkParser.parseMessageLinks).mockReturnValue([
        {
          fullUrl: 'https://discord.com/channels/guild-123/channel-123/deleted-msg',
          guildId: 'guild-123',
          channelId: 'channel-123',
          messageId: 'deleted-msg',
        },
      ]);

      // Simulate message not found (404)
      vi.mocked(mockChannel.messages.fetch).mockRejectedValue({
        code: 10008,
        message: 'Unknown Message',
      });

      const [references, linkMap] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [],
        1
      );

      expect(references).toHaveLength(0);
      expect(linkMap.size).toBe(0);
    });

    it('should handle guild not in cache (fetch required)', async () => {
      const mockMessage = createMockMessage();
      const mockClient = mockMessage.client;
      const mockGuild = {
        id: 'other-guild-123',
        name: 'Other Guild',
        channels: {
          cache: new Map(),
        },
      } as unknown as Guild;

      const mockChannel = {
        id: 'channel-456',
        isTextBased: vi.fn(() => true),
        messages: {
          fetch: vi.fn().mockResolvedValue(createMockMessage({ id: 'ref-msg-456' })),
        },
      } as unknown as TextChannel;

      // Guild not in cache
      mockClient.guilds.cache.clear();

      // Mock guild fetch - returns Guild for single ID fetch
      vi.mocked(mockClient.guilds.fetch).mockResolvedValue(mockGuild as any);
      vi.mocked(mockClient.channels.fetch).mockResolvedValue(mockChannel as Channel);

      // Mock channel to have this channel
      (mockGuild as any).channels = {
        cache: new Map(),
      };

      vi.mocked(MessageLinkParser.parseMessageLinks).mockReturnValue([
        {
          fullUrl: 'https://discord.com/channels/other-guild-123/channel-456/ref-msg-456',
          guildId: 'other-guild-123',
          channelId: 'channel-456',
          messageId: 'ref-msg-456',
        },
      ]);

      const [references, _linkMap] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [],
        1
      );

      expect(mockClient.guilds.fetch).toHaveBeenCalledWith('other-guild-123');
      expect(references).toHaveLength(1);
    });

    it('should handle guild fetch failure', async () => {
      const mockMessage = createMockMessage();
      const mockClient = mockMessage.client;

      // Guild not in cache
      mockClient.guilds.cache.clear();

      // Mock guild fetch failure
      vi.mocked(mockClient.guilds.fetch).mockRejectedValue({
        code: 50001,
        message: 'Missing Access',
      });

      vi.mocked(MessageLinkParser.parseMessageLinks).mockReturnValue([
        {
          fullUrl: 'https://discord.com/channels/forbidden-guild/channel-123/msg-123',
          guildId: 'forbidden-guild',
          channelId: 'channel-123',
          messageId: 'msg-123',
        },
      ]);

      const [references, linkMap] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [],
        1
      );

      expect(references).toHaveLength(0);
      expect(linkMap.size).toBe(0);
    });

    it('should handle channel not in cache (thread fetch required)', async () => {
      const mockMessage = createMockMessage();
      const mockClient = mockMessage.client;
      const mockGuild = mockMessage.guild!;

      const mockThreadChannel = {
        id: 'thread-789',
        type: 11, // PUBLIC_THREAD
        isTextBased: vi.fn(() => true),
        isThread: vi.fn(() => true),
        messages: {
          fetch: vi.fn().mockResolvedValue(createMockMessage({ id: 'thread-msg-789' })),
        },
      } as unknown as TextChannel;

      // Channel not in guild cache
      (mockGuild.channels.cache as Map<string, Channel>).clear();

      // Mock channel fetch
      vi.mocked(mockClient.channels.fetch).mockResolvedValue(mockThreadChannel as Channel);

      vi.mocked(MessageLinkParser.parseMessageLinks).mockReturnValue([
        {
          fullUrl: 'https://discord.com/channels/guild-123/thread-789/thread-msg-789',
          guildId: 'guild-123',
          channelId: 'thread-789',
          messageId: 'thread-msg-789',
        },
      ]);

      const [references, _linkMap] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [],
        1
      );

      expect(mockClient.channels.fetch).toHaveBeenCalledWith('thread-789');
      expect(references).toHaveLength(1);
    });

    it('should handle channel fetch failure', async () => {
      const mockMessage = createMockMessage();
      const mockClient = mockMessage.client;
      const mockGuild = mockMessage.guild!;

      // Channel not in guild cache
      (mockGuild.channels.cache as Map<string, Channel>).clear();

      // Mock channel fetch failure
      vi.mocked(mockClient.channels.fetch).mockRejectedValue({
        code: 10003,
        message: 'Unknown Channel',
      });

      vi.mocked(MessageLinkParser.parseMessageLinks).mockReturnValue([
        {
          fullUrl: 'https://discord.com/channels/guild-123/deleted-channel/msg-123',
          guildId: 'guild-123',
          channelId: 'deleted-channel',
          messageId: 'msg-123',
        },
      ]);

      const [references, linkMap] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [],
        1
      );

      expect(references).toHaveLength(0);
      expect(linkMap.size).toBe(0);
    });

    it('should handle non-text-based channels', async () => {
      const mockMessage = createMockMessage();
      const mockGuild = mockMessage.guild!;

      const mockVoiceChannel = {
        id: 'voice-123',
        type: 2, // GUILD_VOICE
        isTextBased: vi.fn(() => false),
      } as unknown as Channel;

      (mockGuild.channels.cache as Map<string, Channel>).set(
        'voice-123',
        mockVoiceChannel as Channel
      );

      vi.mocked(MessageLinkParser.parseMessageLinks).mockReturnValue([
        {
          fullUrl: 'https://discord.com/channels/guild-123/voice-123/msg-123',
          guildId: 'guild-123',
          channelId: 'voice-123',
          messageId: 'msg-123',
        },
      ]);

      const [references, linkMap] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [],
        1
      );

      expect(references).toHaveLength(0);
      expect(linkMap.size).toBe(0);
    });

    it('should handle message fetch with permission error (50013)', async () => {
      const mockMessage = createMockMessage();
      const mockChannel = mockMessage.channel as TextChannel;

      vi.mocked(MessageLinkParser.parseMessageLinks).mockReturnValue([
        {
          fullUrl: 'https://discord.com/channels/guild-123/channel-123/private-msg',
          guildId: 'guild-123',
          channelId: 'channel-123',
          messageId: 'private-msg',
        },
      ]);

      vi.mocked(mockChannel.messages.fetch).mockRejectedValue({
        code: 50013,
        message: 'Missing Permissions',
      });

      const [references, linkMap] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [],
        1
      );

      expect(references).toHaveLength(0);
      expect(linkMap.size).toBe(0);
    });

    it('should handle message fetch with missing access error (50001)', async () => {
      const mockMessage = createMockMessage();
      const mockChannel = mockMessage.channel as TextChannel;

      vi.mocked(MessageLinkParser.parseMessageLinks).mockReturnValue([
        {
          fullUrl: 'https://discord.com/channels/guild-123/channel-123/no-access-msg',
          guildId: 'guild-123',
          channelId: 'channel-123',
          messageId: 'no-access-msg',
        },
      ]);

      vi.mocked(mockChannel.messages.fetch).mockRejectedValue({
        code: 50001,
        message: 'Missing Access',
      });

      const [references, linkMap] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [],
        1
      );

      expect(references).toHaveLength(0);
      expect(linkMap.size).toBe(0);
    });

    it('should handle unexpected fetch errors', async () => {
      const mockMessage = createMockMessage();
      const mockChannel = mockMessage.channel as TextChannel;

      vi.mocked(MessageLinkParser.parseMessageLinks).mockReturnValue([
        {
          fullUrl: 'https://discord.com/channels/guild-123/channel-123/error-msg',
          guildId: 'guild-123',
          channelId: 'channel-123',
          messageId: 'error-msg',
        },
      ]);

      vi.mocked(mockChannel.messages.fetch).mockRejectedValue({
        code: 99999,
        message: 'Unexpected error',
      });

      const [references, linkMap] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [],
        1
      );

      expect(references).toHaveLength(0);
      expect(linkMap.size).toBe(0);
    });

    it('should deduplicate webhook messages by timestamp', async () => {
      const mockMessage = createMockMessage();
      const messageTime = new Date();
      const mockReferencedMessage = createMockMessage({
        id: 'webhook-msg-123',
        webhookId: 'webhook-123',
        createdAt: messageTime,
        author: { bot: false } as any,
      });

      const mockChannel = mockMessage.channel as TextChannel;

      vi.mocked(MessageLinkParser.parseMessageLinks).mockReturnValue([
        {
          fullUrl: 'https://discord.com/channels/guild-123/channel-123/webhook-msg-123',
          guildId: 'guild-123',
          channelId: 'channel-123',
          messageId: 'webhook-msg-123',
        },
      ]);

      vi.mocked(mockChannel.messages.fetch).mockResolvedValue(mockReferencedMessage as any);

      // Timestamp within tolerance (5 seconds difference)
      const historyTimestamp = new Date(messageTime.getTime() + 5000);

      const [references, linkMap] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [historyTimestamp],
        1
      );

      // Should be deduplicated
      expect(references).toHaveLength(0);
      expect(linkMap.size).toBe(0);
    });

    it('should deduplicate bot messages by timestamp', async () => {
      const mockMessage = createMockMessage();
      const messageTime = new Date();
      const mockReferencedMessage = createMockMessage({
        id: 'bot-msg-123',
        webhookId: null,
        createdAt: messageTime,
        author: { bot: true, id: 'bot-123', username: 'BotUser' } as any,
      });

      const mockChannel = mockMessage.channel as TextChannel;

      vi.mocked(MessageLinkParser.parseMessageLinks).mockReturnValue([
        {
          fullUrl: 'https://discord.com/channels/guild-123/channel-123/bot-msg-123',
          guildId: 'guild-123',
          channelId: 'channel-123',
          messageId: 'bot-msg-123',
        },
      ]);

      vi.mocked(mockChannel.messages.fetch).mockResolvedValue(mockReferencedMessage as any);

      // Timestamp within tolerance (3 seconds difference)
      const historyTimestamp = new Date(messageTime.getTime() + 3000);

      const [references, linkMap] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [historyTimestamp],
        1
      );

      // Should be deduplicated
      expect(references).toHaveLength(0);
      expect(linkMap.size).toBe(0);
    });

    it('should not deduplicate webhook messages outside time window', async () => {
      const mockMessage = createMockMessage();
      // Message from 2 minutes ago (outside 60s window)
      const messageTime = new Date(Date.now() - INTERVALS.MESSAGE_AGE_DEDUP_WINDOW - 10000);
      const mockReferencedMessage = createMockMessage({
        id: 'old-webhook-msg',
        webhookId: 'webhook-123',
        createdAt: messageTime,
        author: { bot: false } as any,
      });

      const mockChannel = mockMessage.channel as TextChannel;

      vi.mocked(MessageLinkParser.parseMessageLinks).mockReturnValue([
        {
          fullUrl: 'https://discord.com/channels/guild-123/channel-123/old-webhook-msg',
          guildId: 'guild-123',
          channelId: 'channel-123',
          messageId: 'old-webhook-msg',
        },
      ]);

      vi.mocked(mockChannel.messages.fetch).mockResolvedValue(mockReferencedMessage as any);

      const historyTimestamp = new Date(messageTime.getTime() + 5000);

      const [references, linkMap] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [historyTimestamp],
        1
      );

      // Should NOT be deduplicated (too old)
      expect(references).toHaveLength(1);
      expect(linkMap.size).toBe(1);
    });

    it('should not deduplicate webhook messages with timestamp outside tolerance', async () => {
      const mockMessage = createMockMessage();
      const messageTime = new Date();
      const mockReferencedMessage = createMockMessage({
        id: 'webhook-msg-456',
        webhookId: 'webhook-456',
        createdAt: messageTime,
        author: { bot: false } as any,
      });

      const mockChannel = mockMessage.channel as TextChannel;

      vi.mocked(MessageLinkParser.parseMessageLinks).mockReturnValue([
        {
          fullUrl: 'https://discord.com/channels/guild-123/channel-123/webhook-msg-456',
          guildId: 'guild-123',
          channelId: 'channel-123',
          messageId: 'webhook-msg-456',
        },
      ]);

      vi.mocked(mockChannel.messages.fetch).mockResolvedValue(mockReferencedMessage as any);

      // Timestamp difference > 15s (outside tolerance)
      const historyTimestamp = new Date(
        messageTime.getTime() + INTERVALS.MESSAGE_TIMESTAMP_TOLERANCE + 5000
      );

      const [references, linkMap] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [historyTimestamp],
        1
      );

      // Should NOT be deduplicated (timestamp too different)
      expect(references).toHaveLength(1);
      expect(linkMap.size).toBe(1);
    });

    it('should not apply time-based deduplication to user messages', async () => {
      const mockMessage = createMockMessage();
      const messageTime = new Date();
      const mockReferencedMessage = createMockMessage({
        id: 'user-msg-123',
        webhookId: null,
        createdAt: messageTime,
        author: { bot: false, id: 'user-789', username: 'RealUser' } as any,
      });

      const mockChannel = mockMessage.channel as TextChannel;

      vi.mocked(MessageLinkParser.parseMessageLinks).mockReturnValue([
        {
          fullUrl: 'https://discord.com/channels/guild-123/channel-123/user-msg-123',
          guildId: 'guild-123',
          channelId: 'channel-123',
          messageId: 'user-msg-123',
        },
      ]);

      vi.mocked(mockChannel.messages.fetch).mockResolvedValue(mockReferencedMessage as any);

      // Matching timestamp, but message is from real user (not bot/webhook)
      const historyTimestamp = new Date(messageTime.getTime() + 2000);

      const [references, linkMap] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [historyTimestamp],
        1
      );

      // Should NOT be deduplicated (user message, not bot/webhook)
      expect(references).toHaveLength(1);
      expect(linkMap.size).toBe(1);
    });
  });
});
