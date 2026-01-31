// Mock dependencies before imports
jest.mock('../../../src/logger');
jest.mock('../../../src/utils/avatarStorage');

const logger = require('../../../src/logger');
const avatarStorage = require('../../../src/utils/avatarStorage');
const {
  getStandardizedUsername,
  generateMessageTrackingId,
  prepareMessageData,
  createVirtualResult,
  sendMessageChunk,
  minimizeConsoleOutput,
  restoreConsoleOutput,
} = require('../../../src/webhook/messageUtils');

// Mock global tzurotClient
global.tzurotClient = null;

describe('messageUtils', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    // Reset global client
    global.tzurotClient = null;
  });

  describe('getStandardizedUsername', () => {
    it('should return Bot for null personality', () => {
      expect(getStandardizedUsername(null)).toBe('Bot');
    });

    it('should return Bot for undefined personality', () => {
      expect(getStandardizedUsername(undefined)).toBe('Bot');
    });

    it('should prioritize displayName when available', () => {
      const personality = {
        fullName: 'test-personality',
        profile: {
          displayName: 'Test Display',
        },
      };
      expect(getStandardizedUsername(personality)).toBe('Test Display');
    });

    it('should trim whitespace from displayName', () => {
      const personality = {
        profile: {
          displayName: '  Test Display  ',
        },
      };
      expect(getStandardizedUsername(personality)).toBe('Test Display');
    });

    it('should handle empty displayName', () => {
      const personality = {
        fullName: 'test-personality',
        profile: {
          displayName: '',
        },
      };
      expect(getStandardizedUsername(personality)).toBe('Test');
    });

    it('should add bot suffix when available', () => {
      global.tzurotClient = {
        user: {
          tag: 'Tzurot | Dev#1234',
        },
      };

      const personality = {
        profile: {
          displayName: 'Test',
        },
      };

      expect(getStandardizedUsername(personality)).toBe('Test | Dev');
    });

    it('should handle bot tag without suffix', () => {
      global.tzurotClient = {
        user: {
          tag: 'Tzurot#1234',
        },
      };

      const personality = {
        profile: {
          displayName: 'Test',
        },
      };

      expect(getStandardizedUsername(personality)).toBe('Test');
    });

    it('should remove discriminator from suffix', () => {
      global.tzurotClient = {
        user: {
          tag: 'Tzurot | Production #9876',
        },
      };

      const personality = {
        profile: {
          displayName: 'Test',
        },
      };

      expect(getStandardizedUsername(personality)).toBe('Test | Production');
    });

    it('should truncate long names to fit 32 character limit', () => {
      const personality = {
        profile: {
          displayName: 'This Is A Very Long Display Name That Exceeds Limit',
        },
      };

      const result = getStandardizedUsername(personality);
      expect(result.length).toBeLessThanOrEqual(32);
      expect(result).toContain('...');
    });

    it('should truncate long names with suffix properly', () => {
      global.tzurotClient = {
        user: {
          tag: 'Tzurot | Development#1234',
        },
      };

      const personality = {
        profile: {
          displayName: 'This Is A Very Long Display Name',
        },
      };

      const result = getStandardizedUsername(personality);
      expect(result.length).toBeLessThanOrEqual(32);
      expect(result).toContain('...');
      expect(result).toContain(' | Development');
    });

    it('should handle very long suffix gracefully', () => {
      global.tzurotClient = {
        user: {
          tag: 'Tzurot | This Is An Extremely Long Environment Name#1234',
        },
      };

      const personality = {
        profile: {
          displayName: 'Test',
        },
      };

      const result = getStandardizedUsername(personality);
      expect(result.length).toBeLessThanOrEqual(32);
    });

    it('should extract name from fullName when displayName missing', () => {
      const personality = {
        fullName: 'test-personality-name',
      };

      expect(getStandardizedUsername(personality)).toBe('Test');
    });

    it('should capitalize extracted name', () => {
      const personality = {
        fullName: 'lowercase-name',
      };

      expect(getStandardizedUsername(personality)).toBe('Lowercase');
    });

    it('should use fullName without hyphens when short enough', () => {
      const personality = {
        fullName: 'shortname',
      };

      expect(getStandardizedUsername(personality)).toBe('Shortname');
    });

    it('should handle fullName without hyphens that needs truncation', () => {
      global.tzurotClient = {
        user: {
          tag: 'Tzurot | VeryLongEnvironmentName#1234',
        },
      };

      const personality = {
        fullName: 'verylongpersonalitynamethatneedstruncation',
      };

      const result = getStandardizedUsername(personality);
      expect(result.length).toBeLessThanOrEqual(32);
      expect(result).toContain('...');
    });

    it('should handle missing global client', () => {
      global.tzurotClient = undefined;

      const personality = {
        profile: {
          displayName: 'Test',
        },
      };

      expect(getStandardizedUsername(personality)).toBe('Test');
    });

    it('should handle missing user in client', () => {
      global.tzurotClient = {
        user: null,
      };

      const personality = {
        profile: {
          displayName: 'Test',
        },
      };

      expect(getStandardizedUsername(personality)).toBe('Test');
    });

    it('should handle missing tag in user', () => {
      global.tzurotClient = {
        user: {
          tag: null,
        },
      };

      const personality = {
        profile: {
          displayName: 'Test',
        },
      };

      expect(getStandardizedUsername(personality)).toBe('Test');
    });

    it('should handle errors gracefully', () => {
      // The function actually doesn't throw errors - it returns fallback values
      // Let's test the actual behavior
      const personality = {
        displayName: null,
        fullName: null,
      };

      expect(getStandardizedUsername(personality)).toBe('Bot');
    });

    it('should return Bot with suffix when personality is empty', () => {
      global.tzurotClient = {
        user: {
          tag: 'Tzurot | Dev#1234',
        },
      };

      const result = getStandardizedUsername({});
      expect(result).toBe('Bot | Dev');
    });

    it('should handle personality with only empty strings', () => {
      const personality = {
        fullName: '',
        displayName: '',
      };

      expect(getStandardizedUsername(personality)).toBe('Bot');
    });

    it('should properly format bot suffix spacing', () => {
      global.tzurotClient = {
        user: {
          tag: 'Tzurot |  Dev#1234', // Extra space
        },
      };

      const personality = {
        profile: {
          displayName: 'Test',
        },
      };

      expect(getStandardizedUsername(personality)).toBe('Test | Dev');
    });
  });

  describe('generateMessageTrackingId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateMessageTrackingId({ fullName: 'test' }, 'channel-123');
      const id2 = generateMessageTrackingId({ fullName: 'test' }, 'channel-123');

      expect(id1).not.toBe(id2);
    });

    it('should include personality name in ID', () => {
      const id = generateMessageTrackingId({ fullName: 'test-personality' }, 'channel-123');
      expect(id).toContain('test-personality');
    });

    it('should include channel ID in ID', () => {
      const id = generateMessageTrackingId({ fullName: 'test' }, 'channel-456');
      expect(id).toContain('channel-456');
    });

    it('should handle null personality', () => {
      const id = generateMessageTrackingId(null, 'channel-123');
      expect(id).toContain('unknown');
      expect(id).toContain('channel-123');
    });

    it('should handle missing fullName', () => {
      const id = generateMessageTrackingId({}, 'channel-123');
      expect(id).toContain('unknown');
    });

    it('should include timestamp', () => {
      const before = Date.now();
      const id = generateMessageTrackingId({ fullName: 'test' }, 'channel-123');
      const after = Date.now();

      // ID format: personalityName-channelId-timestamp-random
      // Example: test-channel-123-1234567890123-abc123
      expect(id).toMatch(/^test-channel-123-\d+-[a-z0-9]+$/);

      // Extract and verify timestamp
      const match = id.match(/^test-channel-123-(\d+)-[a-z0-9]+$/);
      expect(match).toBeTruthy();
      const timestamp = parseInt(match[1]);
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('prepareMessageData', () => {
    it('should create basic message data', () => {
      const personality = { fullName: 'test-bot', avatarUrl: 'https://avatar.url' };
      const data = prepareMessageData('Hello', 'TestUser', personality, false, 'channel-123');

      expect(data).toEqual({
        content: 'Hello',
        username: 'TestUser',
        _personality: personality,
      });
    });

    it('should add threadId for thread messages', () => {
      const personality = { fullName: 'test-bot', avatarUrl: 'https://avatar.url' };
      const data = prepareMessageData('Hello', 'TestUser', personality, true, 'thread-123');

      expect(data).toEqual({
        content: 'Hello',
        username: 'TestUser',
        _personality: personality,
        threadId: 'thread-123',
      });
    });

    it('should handle legacy embed format', () => {
      const embed = { title: 'Test Embed' };
      const personality = { fullName: 'test-bot', avatarUrl: 'https://avatar.url' };
      const data = prepareMessageData('Hello', 'TestUser', personality, false, 'channel-123', {
        embed: embed,
      });

      expect(data).toEqual({
        content: 'Hello',
        username: 'TestUser',
        _personality: personality,
        embeds: [embed],
      });
    });

    it('should pass through other options', () => {
      const personality = { fullName: 'test-bot', avatarUrl: 'https://avatar.url' };
      const data = prepareMessageData('Hello', 'TestUser', personality, false, 'channel-123', {
        files: ['file1'],
        allowedMentions: { parse: [] },
      });

      expect(data).toEqual({
        content: 'Hello',
        username: 'TestUser',
        _personality: personality,
        files: ['file1'],
        allowedMentions: { parse: [] },
      });
    });

    it('should not include embed property in final data', () => {
      const personality = { fullName: 'test-bot', avatarUrl: 'https://avatar.url' };
      const data = prepareMessageData('Hello', 'TestUser', personality, false, 'channel-123', {
        embed: { title: 'Test' },
        otherOption: 'value',
      });

      expect(data).not.toHaveProperty('embed');
      expect(data).toHaveProperty('embeds');
      expect(data).toHaveProperty('otherOption');
    });

    it('should handle null avatar URL', () => {
      const personality = null;
      const data = prepareMessageData('Hello', 'TestUser', personality, false, 'channel-123');

      // Test the behavior, not the internal property
      expect(data.username).toBe('TestUser');
      expect(data.content).toBe('Hello');
      expect(data.thread_id).toBeUndefined();
    });

    it('should handle empty additional options', () => {
      const personality = { fullName: 'test-bot', avatarUrl: 'https://avatar.url' };
      const data = prepareMessageData('Hello', 'TestUser', personality, false, 'channel-123', {});

      expect(data).toEqual({
        content: 'Hello',
        username: 'TestUser',
        _personality: personality,
      });
    });
  });

  describe('createVirtualResult', () => {
    it('should create virtual result with personality', () => {
      const personality = {
        fullName: 'test-personality',
        profile: {
          displayName: 'Test',
        },
      };

      const result = createVirtualResult(personality, 'channel-123');

      expect(result).toMatchObject({
        message: {
          id: expect.stringContaining('virtual-'),
          channelId: 'channel-123',
          author: {
            id: 'webhook',
            username: 'Test',
            bot: true,
          },
          content: '[Message filtered as duplicate]',
          createdTimestamp: expect.any(Number),
        },
        messageIds: expect.arrayContaining([expect.stringContaining('virtual-')]),
        isVirtual: true,
        isDuplicate: true,
        personalityName: 'test-personality',
      });
    });

    it('should handle null personality', () => {
      const result = createVirtualResult(null, 'channel-123');

      expect(result.personalityName).toBe('unknown');
      expect(result.message.author.username).toBe('Bot');
    });

    it('should generate unique virtual IDs', () => {
      const result1 = createVirtualResult({ fullName: 'test' }, 'channel-123');
      const result2 = createVirtualResult({ fullName: 'test' }, 'channel-123');

      expect(result1.message.id).not.toBe(result2.message.id);
    });

    it('should use getStandardizedUsername for author name', () => {
      global.tzurotClient = {
        user: {
          tag: 'Tzurot | Dev#1234',
        },
      };

      const personality = {
        fullName: 'test-personality',
        profile: {
          displayName: 'Test Display',
        },
      };

      const result = createVirtualResult(personality, 'channel-123');

      expect(result.message.author.username).toBe('Test Display | Dev');
    });
  });

  describe('sendMessageChunk', () => {
    let mockWebhook;

    beforeEach(() => {
      mockWebhook = {
        send: jest.fn(),
      };
      // Reset avatar storage mocks
      jest.clearAllMocks();
    });

    it('should send message via webhook', async () => {
      const messageData = {
        content: 'Test message',
        username: 'TestUser',
      };

      mockWebhook.send.mockResolvedValue({ id: 'message-123' });

      const result = await sendMessageChunk(mockWebhook, messageData, 0, 1);

      expect(mockWebhook.send).toHaveBeenCalledWith({
        content: 'Test message',
        username: 'TestUser',
        avatarURL: null,
      });
      expect(result).toEqual({ id: 'message-123' });
    });

    it('should resolve avatar URL from personality', async () => {
      const messageData = {
        content: 'Test message',
        username: 'TestUser',
        _personality: {
          fullName: 'test-bot',
          profile: {
            avatarUrl: 'https://example.com/avatar.png',
          },
        },
      };

      avatarStorage.getLocalAvatarUrl = jest
        .fn()
        .mockResolvedValue('http://localhost:3000/avatars/test-bot-123.png');
      mockWebhook.send.mockResolvedValue({ id: 'message-123' });

      const result = await sendMessageChunk(mockWebhook, messageData, 0, 1);

      expect(avatarStorage.getLocalAvatarUrl).toHaveBeenCalledWith(
        'test-bot',
        'https://example.com/avatar.png'
      );
      expect(mockWebhook.send).toHaveBeenCalledWith({
        content: 'Test message',
        username: 'TestUser',
        avatarURL: 'http://localhost:3000/avatars/test-bot-123.png',
      });
      expect(result).toEqual({ id: 'message-123' });
    });

    it('should log chunk information', async () => {
      mockWebhook.send.mockResolvedValue({ id: 'message-123' });

      await sendMessageChunk(mockWebhook, { content: 'Test' }, 2, 5);

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Sending chunk 3/5'));
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Successfully sent chunk 3/5')
      );
    });

    it('should retry without thread_id if thread error occurs', async () => {
      const messageData = {
        content: 'Test',
        thread_id: 'thread-123',
        threadId: 'thread-123',
        otherData: 'value',
      };

      mockWebhook.send
        .mockRejectedValueOnce(new Error('Invalid thread_id parameter'))
        .mockResolvedValueOnce({ id: 'message-123' });

      const result = await sendMessageChunk(mockWebhook, messageData, 0, 1);

      expect(mockWebhook.send).toHaveBeenCalledTimes(2);
      expect(mockWebhook.send).toHaveBeenLastCalledWith({
        content: 'Test',
        otherData: 'value',
      });
      expect(result).toEqual({ id: 'message-123' });
    });

    it('should not send error message for invalid form body', async () => {
      const messageData = {
        content: 'Very long content',
        username: 'TestUser',
      };

      const error = new Error('Invalid form body');
      error.code = 50035;

      mockWebhook.send.mockRejectedValueOnce(error);

      await expect(sendMessageChunk(mockWebhook, messageData, 0, 1)).rejects.toThrow(error);

      // Should only call once - no error message retry
      expect(mockWebhook.send).toHaveBeenCalledTimes(1);
    });

    it('should throw original error if error message also fails', async () => {
      const error = new Error('Invalid form body');
      error.code = 50035;

      mockWebhook.send.mockRejectedValue(error);

      await expect(sendMessageChunk(mockWebhook, { content: 'Test' }, 0, 1)).rejects.toThrow(error);
    });

    it('should throw error for non-form body errors', async () => {
      const error = new Error('Network error');
      mockWebhook.send.mockRejectedValue(error);

      await expect(sendMessageChunk(mockWebhook, { content: 'Test' }, 0, 1)).rejects.toThrow(error);
    });

    it('should handle missing username gracefully', async () => {
      const error = new Error('Invalid form body');
      error.code = 50035;

      mockWebhook.send.mockRejectedValueOnce(error);

      await expect(sendMessageChunk(mockWebhook, { content: 'Test' }, 0, 1)).rejects.toThrow(error);

      // Should only call once - no error message retry
      expect(mockWebhook.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('Console output utilities', () => {
    it('minimizeConsoleOutput should return empty object', () => {
      const result = minimizeConsoleOutput();
      expect(result).toEqual({});
    });

    it('restoreConsoleOutput should be a no-op', () => {
      expect(() => restoreConsoleOutput()).not.toThrow();
      expect(() => restoreConsoleOutput({})).not.toThrow();
      expect(() => restoreConsoleOutput({ log: console.log })).not.toThrow();
    });
  });
});
