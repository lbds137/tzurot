/**
 * @jest-environment node
 * @testType adapter
 *
 * DiscordMessageAdapter Test
 * - Tests adapter for converting Discord messages to domain messages
 * - Mocks external dependencies (logger)
 * - Domain models are NOT mocked
 */

jest.mock('../../../../src/logger');

const { dddPresets } = require('../../../__mocks__/ddd');

const { DiscordMessageAdapter } = require('../../../../src/adapters/discord/DiscordMessageAdapter');
const { Message, ConversationId } = require('../../../../src/domain/conversation');

describe('DiscordMessageAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('toDomainMessage', () => {
    it('should map basic Discord message to domain Message', () => {
      const discordMessage = {
        id: '123456789012345678',
        content: 'Hello world',
        author: { id: '987654321098765432' },
        createdTimestamp: 1234567890,
        channel: { id: 'channel123' },
        guild: { id: 'guild123' },
        webhookId: null,
        embeds: [],
        attachments: { size: 0 },
        mentions: {
          users: { size: 0, values: () => [] },
          roles: { size: 0, values: () => [] },
          everyone: false,
        },
      };

      const personalityId = { value: 'test-personality' };
      const message = DiscordMessageAdapter.toDomainMessage(discordMessage, personalityId, false);

      expect(message).toBeInstanceOf(Message);
      expect(message.id).toBe('123456789012345678');
      expect(message.content).toBe('Hello world');
      expect(message.authorId).toBe('987654321098765432');
      expect(message.personalityId).toBe('test-personality');
      expect(message.isFromPersonality).toBe(false);
      expect(message.timestamp).toBeInstanceOf(Date);
    });

    it('should handle messages without personality', () => {
      const discordMessage = {
        id: '123',
        content: 'Test message',
        author: { id: 'user123' },
        createdTimestamp: Date.now(),
        channel: { id: 'channel123' },
        mentions: {
          users: { size: 0, values: () => [] },
          roles: { size: 0, values: () => [] },
          everyone: false,
        },
      };

      const message = DiscordMessageAdapter.toDomainMessage(discordMessage);

      expect(message).toBeInstanceOf(Message);
      expect(message.personalityId).toBeNull();
      expect(message.isFromPersonality).toBe(false);
    });

    it('should extract embed content', () => {
      const discordMessage = {
        id: '123',
        content: 'Check this out:',
        author: { id: 'user123' },
        createdTimestamp: Date.now(),
        channel: { id: 'channel123' },
        guild: null,
        embeds: [
          {
            title: 'Embed Title',
            description: 'Embed description',
            fields: [
              { name: 'Field 1', value: 'Value 1' },
              { name: 'Field 2', value: 'Value 2' },
            ],
          },
        ],
        attachments: { size: 0 },
        mentions: {
          users: { size: 0, values: () => [] },
          roles: { size: 0, values: () => [] },
          everyone: false,
        },
      };

      const message = DiscordMessageAdapter.toDomainMessage(discordMessage);

      expect(message.content).toContain('Check this out:');
      expect(message.content).toContain('Embed Title');
      expect(message.content).toContain('Embed description');
      expect(message.content).toContain('Field 1: Value 1');
      expect(message.content).toContain('Field 2: Value 2');
    });

    it('should handle embeds without regular content', () => {
      const discordMessage = {
        id: '123',
        content: '',
        author: { id: 'user123' },
        createdTimestamp: Date.now(),
        channel: { id: 'channel123' },
        guild: null,
        embeds: [{ title: 'Just an embed' }],
        attachments: { size: 0 },
        mentions: {
          users: { size: 0, values: () => [] },
          roles: { size: 0, values: () => [] },
          everyone: false,
        },
      };

      const message = DiscordMessageAdapter.toDomainMessage(discordMessage);

      expect(message.content).toBe('Just an embed');
    });

    it('should extract forwarded message content', () => {
      const discordMessage = {
        id: '123',
        content: 'Check out this message',
        author: { id: 'user123' },
        createdTimestamp: Date.now(),
        channel: { id: 'channel123' },
        guild: null,
        embeds: [],
        attachments: { size: 0 },
        messageSnapshots: [
          {
            message: {
              id: 'forward1',
              content: 'This is a forwarded message',
              author: { username: 'OriginalUser' },
            },
          },
        ],
        mentions: {
          users: { size: 0, values: () => [] },
          roles: { size: 0, values: () => [] },
          everyone: false,
        },
      };

      const message = DiscordMessageAdapter.toDomainMessage(discordMessage);

      expect(message.content).toContain('Check out this message');
      expect(message.content).toContain('--- Forwarded Messages ---');
      expect(message.content).toContain('[Forwarded from OriginalUser]');
      expect(message.content).toContain('This is a forwarded message');
    });

    it('should handle multiple forwarded messages', () => {
      const discordMessage = {
        id: '123',
        content: 'Multiple forwards',
        author: { id: 'user123' },
        createdTimestamp: Date.now(),
        channel: { id: 'channel123' },
        guild: null,
        embeds: [],
        attachments: { size: 0 },
        messageSnapshots: [
          {
            message: {
              id: 'forward1',
              content: 'First forwarded message',
              author: { username: 'User1' },
            },
          },
          {
            message: {
              id: 'forward2',
              content: 'Second forwarded message',
              author: { username: 'User2' },
            },
          },
        ],
        mentions: {
          users: { size: 0, values: () => [] },
          roles: { size: 0, values: () => [] },
          everyone: false,
        },
      };

      const message = DiscordMessageAdapter.toDomainMessage(discordMessage);

      expect(message.content).toContain('[Forwarded from User1]');
      expect(message.content).toContain('First forwarded message');
      expect(message.content).toContain('[Forwarded from User2]');
      expect(message.content).toContain('Second forwarded message');
    });
  });

  describe('toConversationId', () => {
    it('should create ConversationId for guild message', () => {
      const discordMessage = {
        channel: { id: 'channel123' },
        guild: { id: 'guild123' },
      };
      const userId = 'user123';

      const conversationId = DiscordMessageAdapter.toConversationId(discordMessage, userId);

      expect(conversationId).toBeInstanceOf(ConversationId);
      expect(conversationId.userId).toBe('user123');
      expect(conversationId.channelId).toBe('channel123');
    });

    it('should create ConversationId for DM', () => {
      const discordMessage = {
        channel: { id: 'dm123' },
        guild: null,
      };
      const userId = 'user123';

      const conversationId = DiscordMessageAdapter.toConversationId(discordMessage, userId);

      expect(conversationId.userId).toBe('user123');
      expect(conversationId.channelId).toBe('dm123');
    });
  });

  describe('extractMetadata', () => {
    it('should extract complete metadata from Discord message', () => {
      const discordMessage = {
        channel: { id: 'channel123', name: 'general' },
        guild: { id: 'guild123', name: 'Test Guild' },
        author: { tag: 'user#1234', username: 'testuser' },
        webhookId: 'webhook123',
        attachments: {
          size: 1,
          forEach: cb =>
            cb({
              id: 'attach1',
              url: 'https://example.com/image.png',
              proxyURL: 'https://proxy.example.com/image.png',
              name: 'image.png',
              size: 1024,
              contentType: 'image/png',
              width: 100,
              height: 100,
              ephemeral: false,
            }),
        },
        reference: {
          messageId: 'ref123',
          channelId: 'channel123',
          guildId: 'guild123',
        },
        stickers: { size: 0 },
        mentions: {
          users: {
            size: 1,
            values: () => [
              {
                id: 'mentioned123',
                username: 'mentioneduser',
                tag: 'mentioned#5678',
              },
            ],
          },
          roles: { size: 0 },
          everyone: false,
        },
      };

      const metadata = DiscordMessageAdapter.extractMetadata(discordMessage);

      expect(metadata).toEqual({
        channelId: 'channel123',
        guildId: 'guild123',
        authorTag: 'user#1234',
        authorUsername: 'testuser',
        channelName: 'general',
        guildName: 'Test Guild',
        attachments: [
          {
            id: 'attach1',
            url: 'https://example.com/image.png',
            proxyUrl: 'https://proxy.example.com/image.png',
            filename: 'image.png',
            size: 1024,
            contentType: 'image/png',
            width: 100,
            height: 100,
            ephemeral: false,
          },
        ],
        references: {
          messageId: 'ref123',
          channelId: 'channel123',
          guildId: 'guild123',
        },
        isFromWebhook: true,
        mentions: {
          users: [
            {
              id: 'mentioned123',
              username: 'mentioneduser',
              tag: 'mentioned#5678',
            },
          ],
        },
      });
    });

    it('should handle DM metadata', () => {
      const discordMessage = {
        channel: { id: 'dm123' },
        guild: null,
        author: { tag: 'user#1234', username: 'testuser' },
        webhookId: null,
        attachments: { size: 0 },
        stickers: { size: 0 },
        mentions: {
          users: { size: 0 },
          roles: { size: 0 },
          everyone: false,
        },
      };

      const metadata = DiscordMessageAdapter.extractMetadata(discordMessage);

      expect(metadata.guildId).toBeNull();
      expect(metadata.channelName).toBe('DM');
      expect(metadata.guildName).toBeNull();
      expect(metadata.isFromWebhook).toBe(false);
    });

    it('should extract forwarded message references', () => {
      const discordMessage = {
        channel: { id: 'channel123', name: 'general' },
        guild: { id: 'guild123', name: 'Test Guild' },
        author: { tag: 'user#1234', username: 'testuser' },
        webhookId: null,
        attachments: { size: 0 },
        reference: {
          messageId: 'ref123',
          channelId: 'channel123',
          guildId: 'guild123',
          type: 1, // Forwarded message type
        },
        messageSnapshots: [
          {
            message: {
              id: 'forward1',
              channel_id: 'channel456',
              guild_id: 'guild456',
              content: 'Forwarded content',
              author: { id: 'user456', username: 'ForwardedUser' },
              timestamp: '2024-01-01T00:00:00.000Z',
              attachments: [],
            },
          },
        ],
        stickers: { size: 0 },
        mentions: {
          users: { size: 0 },
          roles: { size: 0 },
          everyone: false,
        },
      };

      const metadata = DiscordMessageAdapter.extractMetadata(discordMessage);

      expect(metadata.references).toBeDefined();
      expect(metadata.references.isForwarded).toBe(true);
      expect(metadata.references.type).toBe(1);
      expect(metadata.references.forwardedSnapshots).toHaveLength(1);
      expect(metadata.references.forwardedSnapshots[0]).toEqual({
        messageId: 'forward1',
        channelId: 'channel456',
        guildId: 'guild456',
        content: 'Forwarded content',
        authorId: 'user456',
        authorUsername: 'ForwardedUser',
        timestamp: '2024-01-01T00:00:00.000Z',
        attachments: [],
      });
    });
  });

  describe('isForwardedMessage', () => {
    it('should detect forwarded messages by reference type', () => {
      const forwardedMessage = {
        reference: { type: 1 },
      };

      expect(DiscordMessageAdapter.isForwardedMessage(forwardedMessage)).toBe(true);
    });

    it('should detect forwarded messages by message snapshots', () => {
      const forwardedMessage = {
        messageSnapshots: [{ message: { id: '123' } }],
      };

      expect(DiscordMessageAdapter.isForwardedMessage(forwardedMessage)).toBe(true);
    });

    it('should return false for regular replies', () => {
      const replyMessage = {
        reference: { type: 0 },
      };

      expect(DiscordMessageAdapter.isForwardedMessage(replyMessage)).toBe(false);
    });

    it('should return false for messages without references', () => {
      const regularMessage = {};

      expect(DiscordMessageAdapter.isForwardedMessage(regularMessage)).toBe(false);
    });
  });

  describe('extractAIContext', () => {
    it('should extract AI processing context', () => {
      const discordMessage = {
        guild: { id: 'guild123' },
        reference: { messageId: 'ref123' },
        attachments: { size: 2 },
        mentions: {
          everyone: true,
          users: {
            size: 1,
            keys: () => ['user123'],
          },
          roles: {
            size: 1,
            keys: () => ['role123'],
          },
        },
        channel: { type: 0 },
        type: 0,
        pinned: false,
        system: false,
      };

      const context = DiscordMessageAdapter.extractAIContext(discordMessage);

      expect(context).toEqual({
        isDM: false,
        isReply: true,
        isForwarded: false,
        hasAttachments: true,
        mentionsEveryone: true,
        mentionedUsers: ['user123'],
        mentionedRoles: ['role123'],
        channelType: 0,
        messageType: 0,
        isPinned: false,
        isSystemMessage: false,
        forwardedMessageCount: 0,
      });
    });

    it('should handle DM context', () => {
      const discordMessage = {
        guild: null,
        reference: null,
        attachments: { size: 0 },
        mentions: {
          everyone: false,
          users: { keys: () => [] },
          roles: { keys: () => [] },
        },
        channel: { type: 1 },
        type: 0,
        pinned: false,
        system: false,
      };

      const context = DiscordMessageAdapter.extractAIContext(discordMessage);

      expect(context.isDM).toBe(true);
      expect(context.isReply).toBe(false);
      expect(context.mentionedRoles).toEqual([]);
    });

    it('should detect forwarded messages in AI context', () => {
      const forwardedMessage = {
        guild: { id: 'guild123' },
        reference: { messageId: 'ref123', type: 1 }, // type 1 = forwarded
        attachments: { size: 0 },
        messageSnapshots: [{ message: { id: 'forward1' } }, { message: { id: 'forward2' } }],
        mentions: {
          everyone: false,
          users: { keys: () => [] },
          roles: { keys: () => [] },
        },
        channel: { type: 0 },
        type: 0,
        pinned: false,
        system: false,
      };

      const context = DiscordMessageAdapter.extractAIContext(forwardedMessage);

      expect(context.isForwarded).toBe(true);
      expect(context.isReply).toBe(false); // Forwarded messages are not replies
      expect(context.forwardedMessageCount).toBe(2);
    });

    it('should distinguish between replies and forwards', () => {
      const replyMessage = {
        guild: { id: 'guild123' },
        reference: { messageId: 'ref123', type: 0 }, // type 0 = reply
        attachments: { size: 0 },
        mentions: {
          everyone: false,
          users: { keys: () => [] },
          roles: { keys: () => [] },
        },
        channel: { type: 0 },
        type: 0,
        pinned: false,
        system: false,
      };

      const context = DiscordMessageAdapter.extractAIContext(replyMessage);

      expect(context.isReply).toBe(true);
      expect(context.isForwarded).toBe(false);
      expect(context.forwardedMessageCount).toBe(0);
    });
  });

  describe('shouldProcess', () => {
    it('should skip bot messages by default', () => {
      const discordMessage = {
        author: { bot: true },
        system: false,
        content: 'Bot message',
        attachments: { size: 0 },
      };

      expect(DiscordMessageAdapter.shouldProcess(discordMessage)).toBe(false);
    });

    it('should allow webhook messages when configured', () => {
      const discordMessage = {
        author: { bot: true },
        system: false,
        content: 'Webhook message',
        attachments: { size: 0 },
      };

      expect(DiscordMessageAdapter.shouldProcess(discordMessage, { allowWebhooks: true })).toBe(
        true
      );
    });

    it('should skip system messages', () => {
      const discordMessage = {
        author: { bot: false },
        system: true,
        content: 'System message',
        attachments: { size: 0 },
      };

      expect(DiscordMessageAdapter.shouldProcess(discordMessage)).toBe(false);
    });

    it('should skip empty messages without attachments', () => {
      const discordMessage = {
        author: { bot: false },
        system: false,
        content: '',
        attachments: { size: 0 },
      };

      expect(DiscordMessageAdapter.shouldProcess(discordMessage)).toBe(false);
    });

    it('should process messages with attachments even if empty', () => {
      const discordMessage = {
        author: { bot: false },
        system: false,
        content: '',
        attachments: { size: 1 },
      };

      expect(DiscordMessageAdapter.shouldProcess(discordMessage)).toBe(true);
    });

    it('should apply custom filters', () => {
      const discordMessage = {
        author: { bot: false },
        system: false,
        content: 'Test message',
        attachments: { size: 0 },
      };

      const filter = jest.fn().mockReturnValue(false);

      expect(DiscordMessageAdapter.shouldProcess(discordMessage, { filter })).toBe(false);
      expect(filter).toHaveBeenCalledWith(discordMessage);
    });
  });
});
