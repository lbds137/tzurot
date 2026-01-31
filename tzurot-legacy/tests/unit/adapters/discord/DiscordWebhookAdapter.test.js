/**
 * @jest-environment node
 * @testType adapter
 *
 * DiscordWebhookAdapter Test
 * - Tests adapter for Discord webhook operations
 * - Mocks external dependencies (logger)
 * - Domain models are NOT mocked
 */

jest.mock('../../../../src/logger');

const { dddPresets } = require('../../../__mocks__/ddd');

const { DiscordWebhookAdapter } = require('../../../../src/adapters/discord/DiscordWebhookAdapter');
const { PersonalityId } = require('../../../../src/domain/personality');

describe('DiscordWebhookAdapter', () => {
  let adapter;
  let mockWebhookCache;
  let mockDiscord;
  let mockWebhook;
  let mockChannel;

  // Helper to create a mock Discord Collection
  const createMockCollection = (items = []) => ({
    find: jest.fn(predicate => items.find(predicate)),
    size: items.length,
    first: jest.fn(() => items[0]),
    has: jest.fn(id => items.some(item => item.id === id)),
    get: jest.fn(id => items.find(item => item.id === id)),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    // Mock webhook
    mockWebhook = {
      id: 'webhook-123',
      send: jest.fn().mockResolvedValue({
        id: 'message-123',
        channel_id: 'channel-123',
        timestamp: '2024-01-01T00:00:00.000Z',
      }),
      editMessage: jest.fn().mockResolvedValue({}),
      deleteMessage: jest.fn().mockResolvedValue({}),
      name: 'Tzurot',
      owner: { id: 'bot-123' },
    };

    // Mock channel
    mockChannel = {
      id: 'channel-123',
      type: 0, // GUILD_TEXT
      fetchWebhooks: jest.fn().mockResolvedValue(createMockCollection([mockWebhook])),
      createWebhook: jest.fn().mockResolvedValue(mockWebhook),
    };

    // Mock Discord client
    mockDiscord = {
      user: {
        id: 'bot-123',
        displayAvatarURL: jest.fn().mockReturnValue('https://example.com/avatar.png'),
      },
      channels: {
        fetch: jest.fn().mockResolvedValue(mockChannel),
      },
    };

    // Mock webhook cache
    mockWebhookCache = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      clear: jest.fn(),
    };

    adapter = new DiscordWebhookAdapter({
      webhookCache: mockWebhookCache,
      discord: mockDiscord,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('sendMessage', () => {
    const defaultParams = {
      channelId: 'channel-123',
      personalityId: new PersonalityId('test-personality'),
      personalityProfile: {
        displayName: 'Test Personality',
        avatarUrl: 'https://example.com/personality.png',
      },
      content: 'Hello, world!',
    };

    it('should send message through webhook', async () => {
      const result = await adapter.sendMessage(defaultParams);

      expect(mockWebhook.send).toHaveBeenCalledWith({
        content: 'Hello, world!',
        username: 'Test Personality',
        avatarURL: 'https://example.com/personality.png',
      });

      expect(result).toEqual({
        id: 'message-123',
        channelId: 'channel-123',
        webhookId: 'webhook-123',
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
      });
    });

    it('should use cached webhook if available', async () => {
      mockWebhookCache.get.mockReturnValue(mockWebhook);

      await adapter.sendMessage(defaultParams);

      expect(mockWebhookCache.get).toHaveBeenCalledWith('channel-123');
      expect(mockDiscord.channels.fetch).not.toHaveBeenCalled();
      expect(mockWebhook.send).toHaveBeenCalled();
    });

    it('should create webhook if none exists', async () => {
      mockChannel.fetchWebhooks.mockResolvedValue(createMockCollection([]));

      await adapter.sendMessage(defaultParams);

      expect(mockChannel.createWebhook).toHaveBeenCalledWith({
        name: 'Tzurot',
        avatar: 'https://example.com/avatar.png',
        reason: 'Tzurot personality system webhook',
      });
      expect(mockWebhookCache.set).toHaveBeenCalledWith('channel-123', mockWebhook);
    });

    it('should handle attachments', async () => {
      const params = {
        ...defaultParams,
        attachments: [
          { url: 'https://example.com/image.png', filename: 'image.png' },
          { url: 'https://example.com/file.pdf', filename: 'file.pdf' },
        ],
      };

      await adapter.sendMessage(params);

      expect(mockWebhook.send).toHaveBeenCalledWith({
        content: 'Hello, world!',
        username: 'Test Personality',
        avatarURL: 'https://example.com/personality.png',
        files: [
          { attachment: 'https://example.com/image.png', name: 'image.png' },
          { attachment: 'https://example.com/file.pdf', name: 'file.pdf' },
        ],
      });
    });

    it('should handle replies with reference', async () => {
      const params = {
        ...defaultParams,
        reference: { messageId: 'ref-123' },
      };

      await adapter.sendMessage(params);

      expect(mockWebhook.send).toHaveBeenCalledWith({
        content: '> Reply to message\nHello, world!',
        username: 'Test Personality',
        avatarURL: 'https://example.com/personality.png',
        allowedMentions: { repliedUser: true },
      });
    });

    it('should truncate long content', async () => {
      const params = {
        ...defaultParams,
        content: 'A'.repeat(2001),
      };

      await adapter.sendMessage(params);

      expect(mockWebhook.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'A'.repeat(1997) + '...',
        })
      );
    });

    it('should format username correctly', async () => {
      const params = {
        ...defaultParams,
        personalityProfile: {
          ...defaultParams.personalityProfile,
          displayName: '@Test #Personality with "quotes" and `backticks`',
        },
      };

      await adapter.sendMessage(params);

      // The string after removing special chars is "Test Personality with quotes and backticks" (43 chars)
      // Which gets truncated to 29 chars + "..."
      expect(mockWebhook.send).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'Test Personality with quotes ...',
        })
      );
    });

    it('should truncate long usernames', async () => {
      const params = {
        ...defaultParams,
        personalityProfile: {
          ...defaultParams.personalityProfile,
          displayName: 'A'.repeat(35),
        },
      };

      await adapter.sendMessage(params);

      expect(mockWebhook.send).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'A'.repeat(29) + '...',
        })
      );
    });

    it('should handle send errors', async () => {
      mockWebhook.send.mockRejectedValue(new Error('Discord API error'));

      await expect(adapter.sendMessage(defaultParams)).rejects.toThrow(
        'Failed to send webhook message: Discord API error'
      );
    });
  });

  describe('editMessage', () => {
    it('should edit message through webhook', async () => {
      mockWebhookCache.get.mockReturnValue(mockWebhook);

      await adapter.editMessage({
        messageId: 'message-123',
        channelId: 'channel-123',
        content: 'Updated content',
      });

      expect(mockWebhook.editMessage).toHaveBeenCalledWith('message-123', {
        content: 'Updated content',
      });
    });

    it('should fetch webhook if not cached', async () => {
      await adapter.editMessage({
        messageId: 'message-123',
        channelId: 'channel-123',
        content: 'Updated content',
      });

      expect(mockDiscord.channels.fetch).toHaveBeenCalledWith('channel-123');
      expect(mockWebhook.editMessage).toHaveBeenCalled();
    });

    it('should throw error if no webhook found', async () => {
      mockChannel.fetchWebhooks.mockResolvedValue(createMockCollection([]));

      await expect(
        adapter.editMessage({
          messageId: 'message-123',
          channelId: 'channel-123',
          content: 'Updated',
        })
      ).rejects.toThrow('No webhook found for channel');
    });

    it('should handle edit errors', async () => {
      mockWebhookCache.get.mockReturnValue(mockWebhook);
      mockWebhook.editMessage.mockRejectedValue(new Error('Cannot edit'));

      await expect(
        adapter.editMessage({
          messageId: 'message-123',
          channelId: 'channel-123',
          content: 'Updated',
        })
      ).rejects.toThrow('Failed to edit webhook message: Cannot edit');
    });
  });

  describe('deleteMessage', () => {
    it('should delete message through webhook', async () => {
      mockWebhookCache.get.mockReturnValue(mockWebhook);

      await adapter.deleteMessage({
        messageId: 'message-123',
        channelId: 'channel-123',
      });

      expect(mockWebhook.deleteMessage).toHaveBeenCalledWith('message-123');
    });

    it('should fetch webhook if not cached', async () => {
      await adapter.deleteMessage({
        messageId: 'message-123',
        channelId: 'channel-123',
      });

      expect(mockDiscord.channels.fetch).toHaveBeenCalledWith('channel-123');
      expect(mockWebhook.deleteMessage).toHaveBeenCalled();
    });

    it('should throw error if no webhook found', async () => {
      mockChannel.fetchWebhooks.mockResolvedValue(createMockCollection([]));

      await expect(
        adapter.deleteMessage({
          messageId: 'message-123',
          channelId: 'channel-123',
        })
      ).rejects.toThrow('No webhook found for channel');
    });

    it('should handle delete errors', async () => {
      mockWebhookCache.get.mockReturnValue(mockWebhook);
      mockWebhook.deleteMessage.mockRejectedValue(new Error('Cannot delete'));

      await expect(
        adapter.deleteMessage({
          messageId: 'message-123',
          channelId: 'channel-123',
        })
      ).rejects.toThrow('Failed to delete webhook message: Cannot delete');
    });
  });

  describe('supportsWebhooks', () => {
    it('should return true for guild text channel', async () => {
      mockChannel.type = 0; // GUILD_TEXT

      const result = await adapter.supportsWebhooks('channel-123');

      expect(result).toBe(true);
    });

    it('should return true for guild voice channel', async () => {
      mockChannel.type = 2; // GUILD_VOICE

      const result = await adapter.supportsWebhooks('channel-123');

      expect(result).toBe(true);
    });

    it('should return true for guild news channel', async () => {
      mockChannel.type = 5; // GUILD_NEWS

      const result = await adapter.supportsWebhooks('channel-123');

      expect(result).toBe(true);
    });

    it('should return true for guild stage voice channel', async () => {
      mockChannel.type = 13; // GUILD_STAGE_VOICE

      const result = await adapter.supportsWebhooks('channel-123');

      expect(result).toBe(true);
    });

    it('should return false for DM channel', async () => {
      mockChannel.type = 1; // DM

      const result = await adapter.supportsWebhooks('channel-123');

      expect(result).toBe(false);
    });

    it('should return false for thread channel', async () => {
      mockChannel.type = 11; // PUBLIC_THREAD

      const result = await adapter.supportsWebhooks('channel-123');

      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      mockDiscord.channels.fetch.mockRejectedValue(new Error('Channel not found'));

      const result = await adapter.supportsWebhooks('channel-123');

      expect(result).toBe(false);
    });
  });

  describe('cache management', () => {
    it('should clear cache for specific channel', () => {
      adapter.clearCache('channel-123');

      expect(mockWebhookCache.delete).toHaveBeenCalledWith('channel-123');
    });

    it('should clear entire cache', () => {
      adapter.clearAllCache();

      expect(mockWebhookCache.clear).toHaveBeenCalled();
    });
  });

  describe('_getOrCreateWebhook', () => {
    it('should find existing webhook by name and owner', async () => {
      const otherWebhook = { ...mockWebhook, name: 'Other', id: 'webhook-456' };
      const wrongOwner = { ...mockWebhook, owner: { id: 'other-bot' }, id: 'webhook-789' };

      mockChannel.fetchWebhooks.mockResolvedValue(
        createMockCollection([otherWebhook, wrongOwner, mockWebhook])
      );

      const webhook = await adapter._getOrCreateWebhook('channel-123');

      expect(webhook).toBe(mockWebhook);
      expect(mockChannel.createWebhook).not.toHaveBeenCalled();
    });

    it('should handle channel not found', async () => {
      mockDiscord.channels.fetch.mockRejectedValue(new Error('Unknown Channel'));

      await expect(adapter._getOrCreateWebhook('invalid-channel')).rejects.toThrow(
        'Unknown Channel'
      );
    });
  });
});
