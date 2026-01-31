/**
 * @jest-environment node
 * @testType domain
 *
 * Message Entity Test
 * - Pure domain test with no external dependencies
 * - Tests conversation message entity
 * - No mocking needed (testing the actual implementation)
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain model under test - NOT mocked!
const { Message } = require('../../../../src/domain/conversation/Message');

describe('Message', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should create message with all required fields', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello, world!',
        authorId: '123456789012345678',
        personalityId: 'claude-3-opus',
        timestamp: new Date(),
        isFromPersonality: true,
        channelId: 'channel-123',
      });

      expect(message.id).toBe('msg-123');
      expect(message.content).toBe('Hello, world!');
      expect(message.authorId).toBe('123456789012345678');
      expect(message.personalityId).toBe('claude-3-opus');
      expect(message.timestamp).toEqual(new Date());
      expect(message.isFromPersonality).toBe(true);
      expect(message.channelId).toBe('channel-123');
    });

    it('should create user message without personalityId', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
        isFromPersonality: false,
        channelId: 'channel-123',
      });

      expect(message.personalityId).toBeNull();
      expect(message.isFromPersonality).toBe(false);
    });

    it('should default isFromPersonality to false', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
        channelId: 'channel-123',
      });

      expect(message.isFromPersonality).toBe(false);
    });

    it('should default optional properties', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
        channelId: 'channel-123',
      });

      expect(message.guildId).toBeNull();
      expect(message.attachments).toEqual([]);
      expect(message.reference).toBeNull();
      expect(message.mentions).toBeNull();
      expect(message.isForwarded).toBe(false);
      expect(message.forwardedContent).toBeNull();
    });
  });

  describe('validation', () => {
    it('should require id', () => {
      expect(
        () =>
          new Message({
            content: 'Hello!',
            authorId: '123456789012345678',
            timestamp: new Date(),
            channelId: 'channel-123',
          })
      ).toThrow('Message requires valid id');

      expect(
        () =>
          new Message({
            id: '',
            content: 'Hello!',
            authorId: '123456789012345678',
            timestamp: new Date(),
            channelId: 'channel-123',
          })
      ).toThrow('Message requires valid id');

      expect(
        () =>
          new Message({
            id: null,
            content: 'Hello!',
            authorId: '123456789012345678',
            timestamp: new Date(),
            channelId: 'channel-123',
          })
      ).toThrow('Message requires valid id');
    });

    it('should require id to be string', () => {
      expect(
        () =>
          new Message({
            id: 123,
            content: 'Hello!',
            authorId: '123456789012345678',
            timestamp: new Date(),
            channelId: 'channel-123',
          })
      ).toThrow('Message requires valid id');
    });

    it('should require content', () => {
      expect(
        () =>
          new Message({
            id: 'msg-123',
            authorId: '123456789012345678',
            timestamp: new Date(),
            channelId: 'channel-123',
          })
      ).toThrow('Message requires content');

      expect(
        () =>
          new Message({
            id: 'msg-123',
            content: '',
            authorId: '123456789012345678',
            timestamp: new Date(),
            channelId: 'channel-123',
          })
      ).toThrow('Message requires content');

      expect(
        () =>
          new Message({
            id: 'msg-123',
            content: null,
            authorId: '123456789012345678',
            timestamp: new Date(),
            channelId: 'channel-123',
          })
      ).toThrow('Message requires content');
    });

    it('should require content to be string', () => {
      expect(
        () =>
          new Message({
            id: 'msg-123',
            content: 123,
            authorId: '123456789012345678',
            timestamp: new Date(),
            channelId: 'channel-123',
          })
      ).toThrow('Message requires content');
    });

    it('should require authorId', () => {
      expect(
        () =>
          new Message({
            id: 'msg-123',
            content: 'Hello!',
            timestamp: new Date(),
            channelId: 'channel-123',
          })
      ).toThrow('Message requires authorId');

      expect(
        () =>
          new Message({
            id: 'msg-123',
            content: 'Hello!',
            authorId: '',
            timestamp: new Date(),
            channelId: 'channel-123',
          })
      ).toThrow('Message requires authorId');

      expect(
        () =>
          new Message({
            id: 'msg-123',
            content: 'Hello!',
            authorId: null,
            timestamp: new Date(),
            channelId: 'channel-123',
          })
      ).toThrow('Message requires authorId');
    });

    it('should require authorId to be string', () => {
      expect(
        () =>
          new Message({
            id: 'msg-123',
            content: 'Hello!',
            authorId: 123456789012345,
            timestamp: new Date(),
            channelId: 'channel-123',
          })
      ).toThrow('Message requires authorId');
    });

    it('should require timestamp', () => {
      expect(
        () =>
          new Message({
            id: 'msg-123',
            content: 'Hello!',
            authorId: '123456789012345678',
            channelId: 'channel-123',
          })
      ).toThrow('Message requires valid timestamp');

      expect(
        () =>
          new Message({
            id: 'msg-123',
            content: 'Hello!',
            authorId: '123456789012345678',
            timestamp: null,
            channelId: 'channel-123',
          })
      ).toThrow('Message requires valid timestamp');
    });

    it('should require timestamp to be Date', () => {
      expect(
        () =>
          new Message({
            id: 'msg-123',
            content: 'Hello!',
            authorId: '123456789012345678',
            timestamp: '2024-01-01',
            channelId: 'channel-123',
          })
      ).toThrow('Message requires valid timestamp');

      expect(
        () =>
          new Message({
            id: 'msg-123',
            content: 'Hello!',
            authorId: '123456789012345678',
            timestamp: Date.now(),
            channelId: 'channel-123',
          })
      ).toThrow('Message requires valid timestamp');
    });

    it('should require channelId', () => {
      expect(
        () =>
          new Message({
            id: 'msg-123',
            content: 'Hello!',
            authorId: '123456789012345678',
            timestamp: new Date(),
          })
      ).toThrow('Message requires channelId');

      expect(
        () =>
          new Message({
            id: 'msg-123',
            content: 'Hello!',
            authorId: '123456789012345678',
            timestamp: new Date(),
            channelId: '',
          })
      ).toThrow('Message requires channelId');

      expect(
        () =>
          new Message({
            id: 'msg-123',
            content: 'Hello!',
            authorId: '123456789012345678',
            timestamp: new Date(),
            channelId: null,
          })
      ).toThrow('Message requires channelId');
    });

    it('should require channelId to be string', () => {
      expect(
        () =>
          new Message({
            id: 'msg-123',
            content: 'Hello!',
            authorId: '123456789012345678',
            timestamp: new Date(),
            channelId: 123,
          })
      ).toThrow('Message requires channelId');
    });
  });

  describe('isFromUser', () => {
    it('should return true for user messages', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
        isFromPersonality: false,
        channelId: 'channel-123',
      });

      expect(message.isFromUser()).toBe(true);
    });

    it('should return false for personality messages', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: 'claude-3-opus',
        personalityId: 'claude-3-opus',
        timestamp: new Date(),
        isFromPersonality: true,
        channelId: 'channel-123',
      });

      expect(message.isFromUser()).toBe(false);
    });
  });

  describe('isDM', () => {
    it('should return true for DM messages', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
        channelId: 'dm-123',
      });

      expect(message.isDM()).toBe(true);
    });

    it('should return false for guild messages', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
        channelId: 'channel-123',
        guildId: 'guild-123',
      });

      expect(message.isDM()).toBe(false);
    });
  });

  describe('isReply', () => {
    it('should return true for reply messages', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
        channelId: 'channel-123',
        reference: { messageId: 'ref-123', type: 0 },
      });

      expect(message.isReply()).toBe(true);
    });

    it('should return false for forwarded messages', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
        channelId: 'channel-123',
        reference: { messageId: 'ref-123', type: 1 },
        isForwarded: true,
      });

      expect(message.isReply()).toBe(false);
    });

    it('should return false for messages without reference', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
        channelId: 'channel-123',
      });

      expect(message.isReply()).toBe(false);
    });
  });

  describe('hasAttachments', () => {
    it('should return true when message has attachments', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Check this out!',
        authorId: '123456789012345678',
        timestamp: new Date(),
        channelId: 'channel-123',
        attachments: [{ id: 'att-1', url: 'https://example.com/image.png' }],
      });

      expect(message.hasAttachments()).toBe(true);
    });

    it('should return false when message has no attachments', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
        channelId: 'channel-123',
      });

      expect(message.hasAttachments()).toBe(false);
    });
  });

  describe('hasImages', () => {
    it('should return true when message has image attachments', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Check this image!',
        authorId: '123456789012345678',
        timestamp: new Date(),
        channelId: 'channel-123',
        attachments: [
          { id: 'att-1', url: 'https://example.com/image.png', contentType: 'image/png' },
        ],
      });

      expect(message.hasImages()).toBe(true);
    });

    it('should return false when message has non-image attachments', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Check this file!',
        authorId: '123456789012345678',
        timestamp: new Date(),
        channelId: 'channel-123',
        attachments: [
          { id: 'att-1', url: 'https://example.com/doc.pdf', contentType: 'application/pdf' },
        ],
      });

      expect(message.hasImages()).toBe(false);
    });
  });

  describe('hasAudio', () => {
    it('should return true when message has audio attachments', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Listen to this!',
        authorId: '123456789012345678',
        timestamp: new Date(),
        channelId: 'channel-123',
        attachments: [
          { id: 'att-1', url: 'https://example.com/audio.mp3', contentType: 'audio/mpeg' },
        ],
      });

      expect(message.hasAudio()).toBe(true);
    });

    it('should return false when message has non-audio attachments', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Check this!',
        authorId: '123456789012345678',
        timestamp: new Date(),
        channelId: 'channel-123',
        attachments: [
          { id: 'att-1', url: 'https://example.com/image.png', contentType: 'image/png' },
        ],
      });

      expect(message.hasAudio()).toBe(false);
    });
  });

  describe('getMentionedUsers', () => {
    it('should return mentioned user IDs', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello @user1 and @user2!',
        authorId: '123456789012345678',
        timestamp: new Date(),
        channelId: 'channel-123',
        mentions: {
          users: [
            { id: 'user1', username: 'user1' },
            { id: 'user2', username: 'user2' },
          ],
        },
      });

      expect(message.getMentionedUsers()).toEqual(['user1', 'user2']);
    });

    it('should return empty array when no mentions', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
        channelId: 'channel-123',
      });

      expect(message.getMentionedUsers()).toEqual([]);
    });
  });

  describe('getAge', () => {
    it('should return age in milliseconds', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
        channelId: 'channel-123',
      });

      // Advance time by 5 seconds
      jest.advanceTimersByTime(5000);

      expect(message.getAge()).toBe(5000);
    });

    it('should handle old messages', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
        channelId: 'channel-123',
      });

      // Advance time by 1 hour
      jest.advanceTimersByTime(60 * 60 * 1000);

      expect(message.getAge()).toBe(60 * 60 * 1000);
    });
  });

  describe('isExpired', () => {
    it('should return false for fresh messages', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
        channelId: 'channel-123',
      });

      expect(message.isExpired(60000)).toBe(false);
    });

    it('should return true for expired messages', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
        channelId: 'channel-123',
      });

      // Advance time beyond timeout
      jest.advanceTimersByTime(61000);

      expect(message.isExpired(60000)).toBe(true);
    });

    it('should handle exact timeout boundary', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
        channelId: 'channel-123',
      });

      // Advance time to exactly timeout
      jest.advanceTimersByTime(60000);

      expect(message.isExpired(60000)).toBe(false);

      // One millisecond more
      jest.advanceTimersByTime(1);

      expect(message.isExpired(60000)).toBe(true);
    });
  });

  describe('toJSON', () => {
    it('should serialize to JSON', () => {
      const timestamp = new Date();
      const message = new Message({
        id: 'msg-123',
        content: 'Hello, world!',
        authorId: '123456789012345678',
        personalityId: 'claude-3-opus',
        timestamp: timestamp,
        isFromPersonality: false,
        channelId: 'channel-123',
        guildId: 'guild-123',
        attachments: [{ id: 'att-1', url: 'https://example.com/image.png' }],
        reference: { messageId: 'ref-123' },
        mentions: { users: [{ id: 'user1' }] },
        isForwarded: false,
        forwardedContent: null,
      });

      const json = message.toJSON();

      expect(json).toEqual({
        id: 'msg-123',
        content: 'Hello, world!',
        authorId: '123456789012345678',
        personalityId: 'claude-3-opus',
        timestamp: timestamp.toISOString(),
        isFromPersonality: false,
        channelId: 'channel-123',
        guildId: 'guild-123',
        attachments: [{ id: 'att-1', url: 'https://example.com/image.png' }],
        reference: { messageId: 'ref-123' },
        mentions: { users: [{ id: 'user1' }] },
        isForwarded: false,
        forwardedContent: null,
      });
    });

    it('should handle null personalityId', () => {
      const timestamp = new Date();
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: timestamp,
        isFromPersonality: false,
        channelId: 'channel-123',
      });

      const json = message.toJSON();

      expect(json.personalityId).toBeNull();
    });
  });

  describe('fromJSON', () => {
    it('should deserialize from JSON', () => {
      const timestamp = new Date();
      const json = {
        id: 'msg-123',
        content: 'Hello, world!',
        authorId: '123456789012345678',
        personalityId: 'claude-3-opus',
        timestamp: timestamp.toISOString(),
        isFromPersonality: false,
        channelId: 'channel-123',
        guildId: 'guild-123',
        attachments: [{ id: 'att-1' }],
        reference: { messageId: 'ref-123' },
        mentions: { users: [{ id: 'user1' }] },
        isForwarded: false,
        forwardedContent: null,
      };

      const message = Message.fromJSON(json);

      expect(message).toBeInstanceOf(Message);
      expect(message.id).toBe('msg-123');
      expect(message.content).toBe('Hello, world!');
      expect(message.authorId).toBe('123456789012345678');
      expect(message.personalityId).toBe('claude-3-opus');
      expect(message.timestamp).toEqual(timestamp);
      expect(message.isFromPersonality).toBe(false);
      expect(message.channelId).toBe('channel-123');
      expect(message.guildId).toBe('guild-123');
    });

    it('should handle timestamp string conversion', () => {
      const json = {
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: '2024-01-01T00:00:00.000Z',
        isFromPersonality: false,
        channelId: 'channel-123',
      };

      const message = Message.fromJSON(json);

      expect(message.timestamp).toBeInstanceOf(Date);
      expect(message.timestamp.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    });
  });

  describe('immutability', () => {
    it('should not be affected by JSON modifications', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        personalityId: 'claude-3-opus',
        timestamp: new Date(),
        isFromPersonality: false,
        channelId: 'channel-123',
      });

      const json = message.toJSON();

      // Modifying JSON should not affect original
      json.content = 'Modified';
      json.authorId = 'modified-id';
      json.isFromPersonality = true;

      expect(message.content).toBe('Hello!');
      expect(message.authorId).toBe('123456789012345678');
      expect(message.isFromPersonality).toBe(false);
    });
  });
});
