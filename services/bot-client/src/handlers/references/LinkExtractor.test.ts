/**
 * Tests for LinkExtractor
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LinkExtractor } from './LinkExtractor.js';
import { MessageFormatter } from './MessageFormatter.js';
import { SnapshotFormatter } from './SnapshotFormatter.js';
import { MessageLinkParser } from '../../utils/MessageLinkParser.js';
import { ChannelType, MessageReferenceType, Collection } from 'discord.js';
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

// Helper to create mock Discord message.
// Security-check defaults: channel returns a permissive `permissionsFor` result
// and the guild returns a valid member on `members.fetch`, so existing tests
// (which don't exercise the access-check path) continue to pass. Security-
// specific tests in the "access control" describe block override these.
function createMockMessage(overrides: MockMessageInput = {}): Message {
  const permissiveChannelMethods = {
    isDMBased: vi.fn(() => false),
    isThread: vi.fn(() => false),
    permissionsFor: vi.fn(() => ({ has: vi.fn(() => true) })),
  };

  const mockGuild = {
    id: 'guild-123',
    name: 'Test Guild',
    members: {
      fetch: vi.fn().mockResolvedValue({ id: 'user-123' }),
    },
  } as unknown as Guild;

  const mockChannel = {
    id: 'channel-123',
    type: 0, // GUILD_TEXT
    isTextBased: vi.fn(() => true),
    messages: {
      fetch: vi.fn(),
    },
    guild: mockGuild,
    ...permissiveChannelMethods,
  } as unknown as TextChannel;

  // Attach the channel into the guild's channel cache now that both exist
  (mockGuild as any).channels = {
    cache: new Map([[mockChannel.id, mockChannel as Channel]]),
    fetch: vi.fn(),
  };

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
        members: {
          fetch: vi.fn().mockResolvedValue({ id: 'user-123' }),
        },
      } as unknown as Guild;

      const mockChannel = {
        id: 'channel-456',
        isTextBased: vi.fn(() => true),
        isThread: vi.fn(() => false),
        isDMBased: vi.fn(() => false),
        permissionsFor: vi.fn(() => ({ has: vi.fn(() => true) })),
        guild: mockGuild,
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
        isDMBased: vi.fn(() => false),
        permissionsFor: vi.fn(() => ({ has: vi.fn(() => true) })),
        guild: mockGuild,
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

  // ============================================================================
  // SECURITY: invoking-user access check on message-link expansion.
  //
  // The bot has cross-channel credentials that the invoking user may not share.
  // Without the invoker-access check, pasting a link to a private #staff channel
  // in a public channel would let the bot expand the private content into the
  // AI's context, potentially surfacing in the AI reply the victim user reads.
  //
  // These tests cover the access-check decision tree in
  // `LinkExtractor.verifyInvokerCanAccessSource`:
  //   - DM source: only DM participant can expand
  //   - Guild source: invoker must be a guild member AND have ViewChannel +
  //     ReadMessageHistory on the source channel
  //   - Private thread: additionally requires thread membership
  //   - Fail closed: any null/undefined check result denies access
  // ============================================================================
  describe('access control (verifyInvokerCanAccessSource)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      // Default: every link parses to the same test link
      vi.mocked(MessageLinkParser.parseMessageLinks).mockReturnValue([
        {
          fullUrl: 'https://discord.com/channels/guild-123/channel-123/ref-msg-123',
          guildId: 'guild-123',
          channelId: 'channel-123',
          messageId: 'ref-msg-123',
        },
      ]);
    });

    it('allows expansion when invoker has ViewChannel + ReadMessageHistory in same-guild source', async () => {
      const mockMessage = createMockMessage();
      const mockChannel = mockMessage.channel as TextChannel;
      vi.mocked(mockChannel.messages.fetch).mockResolvedValue(
        createMockMessage({ id: 'ref-msg-123' }) as any
      );

      const [references] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [],
        1
      );

      expect(references).toHaveLength(1);
      expect(mockChannel.messages.fetch).toHaveBeenCalledWith('ref-msg-123');
    });

    it('denies expansion when invoker lacks ViewChannel on source channel', async () => {
      const mockMessage = createMockMessage();
      const mockChannel = mockMessage.channel as TextChannel;

      // Override permissionsFor to deny
      (mockChannel as any).permissionsFor = vi.fn(() => ({ has: vi.fn(() => false) }));

      const [references] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [],
        1
      );

      expect(references).toHaveLength(0);
      expect(mockChannel.messages.fetch).not.toHaveBeenCalled();
    });

    it('denies expansion when invoker is not a member of the source guild (cross-guild leak)', async () => {
      // Classic exploit: bot is in private guild Y, attacker in guild X pastes
      // a guild-Y link into a guild-X channel. Invoker isn't in guild Y →
      // members.fetch rejects → deny.
      const mockMessage = createMockMessage();
      const mockGuild = mockMessage.guild!;
      const mockChannel = mockMessage.channel as TextChannel;

      // members.fetch rejects (user not in source guild)
      vi.mocked(mockGuild.members.fetch).mockRejectedValue(new Error('Unknown Member') as never);

      const [references] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [],
        1
      );

      expect(references).toHaveLength(0);
      expect(mockChannel.messages.fetch).not.toHaveBeenCalled();
    });

    it('allows expansion when invoker is a DM participant (self-reference to own DM)', async () => {
      // The legitimate case: you're in a DM with the bot and you paste a link
      // to your own DM message in another conversation. You have access.
      const mockMessage = createMockMessage();
      const mockChannel = mockMessage.channel as TextChannel;

      // Override channel to be a DM where invoker (user-123) is the recipient
      (mockChannel as any).isDMBased = vi.fn(() => true);
      (mockChannel as any).recipientId = 'user-123';
      vi.mocked(mockChannel.messages.fetch).mockResolvedValue(
        createMockMessage({ id: 'ref-msg-123' }) as any
      );

      const [references] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [],
        1
      );

      expect(references).toHaveLength(1);
    });

    it('denies expansion when invoker is NOT a DM participant (third-party DM leak)', async () => {
      // The exploit case: someone else pastes a link to a DM they're not part
      // of, trying to get the bot to expand it. Deny.
      const mockMessage = createMockMessage();
      const mockChannel = mockMessage.channel as TextChannel;

      // DM exists but invoker (user-123) is NOT the recipient
      (mockChannel as any).isDMBased = vi.fn(() => true);
      (mockChannel as any).recipientId = 'some-other-user-999';

      const [references] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [],
        1
      );

      expect(references).toHaveLength(0);
      expect(mockChannel.messages.fetch).not.toHaveBeenCalled();
    });

    it('denies expansion for private thread when invoker is not a thread member', async () => {
      // Private threads (type 12) have an explicit member list. Parent-channel
      // ViewChannel isn't enough — you must be in the thread's member list.
      const mockMessage = createMockMessage();
      const mockChannel = mockMessage.channel as TextChannel;

      (mockChannel as any).isThread = vi.fn(() => true);
      (mockChannel as any).type = ChannelType.PrivateThread;
      (mockChannel as any).members = {
        fetch: vi.fn().mockRejectedValue(new Error('Unknown Member')),
      };

      const [references] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [],
        1
      );

      expect(references).toHaveLength(0);
      expect(mockChannel.messages.fetch).not.toHaveBeenCalled();
    });

    it('allows expansion for private thread when invoker IS a thread member', async () => {
      const mockMessage = createMockMessage();
      const mockChannel = mockMessage.channel as TextChannel;

      (mockChannel as any).isThread = vi.fn(() => true);
      (mockChannel as any).type = ChannelType.PrivateThread;
      (mockChannel as any).members = {
        fetch: vi.fn().mockResolvedValue({ id: 'user-123' }),
      };
      vi.mocked(mockChannel.messages.fetch).mockResolvedValue(
        createMockMessage({ id: 'ref-msg-123' }) as any
      );

      const [references] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [],
        1
      );

      expect(references).toHaveLength(1);
    });

    it('allows expansion for PUBLIC thread (inherits parent permissions, no extra check)', async () => {
      // Public threads don't have a per-thread member list for access control.
      // Parent ViewChannel + ReadMessageHistory is sufficient.
      const mockMessage = createMockMessage();
      const mockChannel = mockMessage.channel as TextChannel;

      (mockChannel as any).isThread = vi.fn(() => true);
      (mockChannel as any).type = ChannelType.PublicThread;
      vi.mocked(mockChannel.messages.fetch).mockResolvedValue(
        createMockMessage({ id: 'ref-msg-123' }) as any
      );

      const [references] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [],
        1
      );

      expect(references).toHaveLength(1);
    });

    it('fails closed when permissionsFor returns null (unexpected Discord.js state)', async () => {
      // Defense in depth: if Discord.js returns null from permissionsFor for
      // any reason (malformed member, edge-case channel type), deny rather
      // than default-allow.
      const mockMessage = createMockMessage();
      const mockChannel = mockMessage.channel as TextChannel;

      (mockChannel as any).permissionsFor = vi.fn(() => null);

      const [references] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [],
        1
      );

      expect(references).toHaveLength(0);
      expect(mockChannel.messages.fetch).not.toHaveBeenCalled();
    });

    it('fails closed when a non-DM channel has no guild reference (malformed state)', async () => {
      // Defensive guard: a text-based, non-DM channel should always have a
      // guild. If Discord.js produces a channel without one (malformed state,
      // edge-case fetch race), we refuse to proceed rather than assuming it's
      // safe to expand.
      const mockMessage = createMockMessage();
      const mockChannel = mockMessage.channel as TextChannel;

      // Non-DM channel, but guild property is missing (`guild` is still in the
      // object shape because TextChannel requires it, but we explicitly null it)
      (mockChannel as any).guild = null;

      const [references] = await linkExtractor.extractLinkReferences(
        mockMessage,
        new Set(),
        new Set(),
        [],
        1
      );

      expect(references).toHaveLength(0);
      expect(mockChannel.messages.fetch).not.toHaveBeenCalled();
    });
  });
});
