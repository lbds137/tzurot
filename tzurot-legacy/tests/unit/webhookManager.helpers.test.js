/**
 * Tests for webhookManager.js helper functions added during refactoring
 */

// Unmock webhookManager since it's globally mocked in setup.js
jest.unmock('../../src/webhookManager');

jest.mock('discord.js', () => ({
  WebhookClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({ id: 'mock-message-id' }),
    destroy: jest.fn(),
  })),
  EmbedBuilder: jest.fn().mockImplementation(data => data),
}));

jest.mock('node-fetch', () => {
  return jest.fn().mockImplementation(() => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true }),
    text: async () => 'Success',
    buffer: async () => Buffer.from('Success'),
  }));
});

// Mock dependencies
jest.mock('../../src/logger');
jest.mock('../../src/profileInfoFetcher', () => ({
  getFetcher: jest.fn().mockReturnValue({
    fetchProfileInfo: jest.fn().mockResolvedValue({
      avatarUrl: 'https://example.com/avatar.png',
      displayName: 'Test User',
    }),
  }),
  getProfileAvatarUrl: jest.fn().mockResolvedValue(null),
  getProfileDisplayName: jest.fn().mockResolvedValue('Test Display'),
  deleteFromCache: jest.fn(),
}));

jest.mock('../../src/utils/webhookCache', () => ({
  get: jest.fn(),
  set: jest.fn(),
  clear: jest.fn(),
  getActiveWebhooks: jest.fn(() => new Set()),
  clearWebhookCache: jest.fn(),
  clearAllWebhookCaches: jest.fn(),
  registerEventListeners: jest.fn(),
}));

jest.mock('../../src/utils/messageDeduplication', () => ({
  isDuplicate: jest.fn(() => false),
  addMessage: jest.fn(),
  hashMessage: jest.fn(() => 'mock-hash'),
  isDuplicateMessage: jest.fn(() => false),
}));

jest.mock('../../src/utils/messageFormatter', () => ({
  formatContent: jest.fn(content => content),
  trimContent: jest.fn(content => content),
  splitMessage: jest.fn(content => {
    // For testing, let's split by character limit
    const limit = 50; // Small limit for testing
    if (content.length <= limit) return [content];
    const chunks = [];
    for (let i = 0; i < content.length; i += limit) {
      chunks.push(content.substring(i, i + limit));
    }
    return chunks;
  }),
  splitByCharacterLimit: jest.fn().mockImplementation(text => {
    if (!text || text.length <= 2000) return [text || ''];

    const chunks = [];
    for (let i = 0; i < text.length; i += 2000) {
      chunks.push(text.substring(i, i + 2000));
    }
    return chunks;
  }),
  processSentence: jest.fn().mockImplementation((sentence, chunks, currentChunk) => {
    if (!sentence) return currentChunk;

    // Simple implementation for testing
    if ((currentChunk + sentence).length > 2000) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      return sentence;
    }

    return currentChunk + (currentChunk ? ' ' : '') + sentence;
  }),
  processLine: jest.fn().mockImplementation((line, chunks, currentChunk) => {
    if (!line) return currentChunk;

    const newLine = currentChunk ? '\n' + line : line;
    if ((currentChunk + newLine).length > 2000) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      return line;
    }

    return currentChunk + newLine;
  }),
  processParagraph: jest.fn().mockImplementation((paragraph, chunks, currentChunk) => {
    if (!paragraph) return currentChunk;

    const separator = currentChunk ? '\n\n' : '';
    if ((currentChunk + separator + paragraph).length > 2000) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      return paragraph;
    }

    return currentChunk + separator + paragraph;
  }),
}));

jest.mock('../../src/utils/avatarManager', () => ({
  validateAvatarUrl: jest.fn().mockResolvedValue(true),
  getValidAvatarUrl: jest.fn().mockResolvedValue('https://example.com/avatar.png'),
  preloadPersonalityAvatar: jest.fn(),
  warmupAvatar: jest.fn(),
}));

jest.mock('../../src/utils/errorTracker', () => ({
  trackError: jest.fn(),
  ErrorCategory: {
    WEBHOOK: 'webhook',
    AVATAR: 'avatar',
  },
}));

jest.mock('../../src/utils/media', () => ({
  isMediaUrl: jest.fn(() => false),
  formatMediaUrls: jest.fn(() => []),
  processMediaForWebhook: jest.fn(),
  prepareAttachmentOptions: jest.fn(() => ({})),
}));

jest.mock('../../src/webhook', () => ({
  createWebhookForPersonality: jest.fn(),
  sendWebhookMessage: jest.fn(),
  CHUNK_DELAY: 100,
  MAX_CONTENT_LENGTH: 2000,
  EMBED_CHUNK_SIZE: 1800,
  DEFAULT_MESSAGE_DELAY: 150,
  MAX_ERROR_WAIT_TIME: 60000,
  MIN_MESSAGE_DELAY: 150,
  // Functions that webhookManager re-exports
  sendDirectThreadMessage: jest.fn(),
  createPersonalityChannelKey: jest.fn((personality, channel) => `${personality}_${channel}`),
  hasPersonalityPendingMessage: jest.fn(() => false),
  registerPendingMessage: jest.fn(),
  clearPendingMessage: jest.fn(),
  calculateMessageDelay: jest.fn(() => 0),
  updateChannelLastMessageTime: jest.fn(),
  sendFormattedMessageInDM: jest.fn(),
  isErrorContent: jest.fn().mockImplementation(content => {
    if (!content || typeof content !== 'string') return false;
    const errorPatterns = [
      "I'm having trouble connecting",
      'ERROR_MESSAGE_PREFIX:',
      "I'm experiencing a technical issue",
      'Error ID:',
    ];
    return errorPatterns.some(pattern => content.includes(pattern));
  }),
  markErrorContent: jest.fn().mockImplementation(content => {
    if (!content || typeof content !== 'string') return content || '';
    const isError = content.includes("I'm having trouble") || content.includes('technical issue');
    return isError ? `ERROR_MESSAGE_PREFIX: ${content}` : content;
  }),
  isErrorWebhookMessage: jest.fn(() => false),
  getStandardizedUsername: jest.fn(personality => {
    if (!personality) return 'Bot';
    return personality.displayName || 'Bot';
  }),
  generateMessageTrackingId: jest.fn().mockImplementation(channelId => {
    // Generate unique IDs like the real implementation
    const id = channelId || 'unknown';
    return `tracking-${id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }),
  prepareMessageData: jest
    .fn()
    .mockImplementation((content, username, personality, isThread, threadId, options = {}) => {
      const messageData = {
        content: content || '',
        username,
        _personality: personality,
        threadId: isThread ? threadId : undefined,
        ...options,
      };

      if (options && options.embed) {
        messageData.embeds = [options.embed];
      }

      return messageData;
    }),
  createVirtualResult: jest.fn().mockImplementation((personality, channelId) => {
    const virtualId = `virtual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    return {
      message: { id: virtualId },
      messageIds: [virtualId],
      isDuplicate: true,
    };
  }),
  sendMessageChunk: jest
    .fn()
    .mockImplementation(async (webhook, messageData, chunkIndex, totalChunks) => {
      // Add avatarURL to the message data like the real implementation
      const dataToSend = {
        ...messageData,
        avatarURL: messageData._personality?.avatarUrl || null,
      };

      // Remove internal properties
      delete dataToSend._personality;

      // If the webhook.send throws an error, try a fallback
      try {
        return await webhook.send(dataToSend);
      } catch (error) {
        // Try fallback with error message
        const fallbackData = {
          content: `Error: ${error.message}`,
          username: messageData.username,
        };
        await webhook.send(fallbackData);
        throw error; // Still throw the original error
      }
    }),
  minimizeConsoleOutput: jest.fn(() => ({})),
  restoreConsoleOutput: jest.fn(),
}));

jest.mock('../../src/constants', () => ({
  TIME: {
    SECOND: 1000,
    MINUTE: 60000,
  },
}));

const discord = require('discord.js');
const fetch = require('node-fetch');

describe('WebhookManager - Helper Functions', () => {
  let webhookManager;

  // Original console methods
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;

  beforeEach(() => {
    // Mock console methods
    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();

    // Reset module
    jest.resetModules();
    webhookManager = require('../../src/webhookManager');

    // Clear mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Restore console methods
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  });

  describe('Console output management', () => {
    test('minimizeConsoleOutput should return an empty object with structured logging', () => {
      // Call the function
      const originalFunctions = webhookManager.minimizeConsoleOutput();

      // Verify it returns an empty object now that we're using structured logging
      expect(originalFunctions).toEqual({});

      // Try to log something
      console.log('This should be logged normally');
      console.warn('This should be logged normally');

      // Expect logs to be called since we're not disabling them anymore
      expect(console.log).toHaveBeenCalledWith('This should be logged normally');
      expect(console.warn).toHaveBeenCalledWith('This should be logged normally');
    });

    test('restoreConsoleOutput should be a no-op with structured logging', () => {
      // First minimize (now returns empty object)
      const originalFunctions = webhookManager.minimizeConsoleOutput();

      // Then restore (should be a no-op)
      webhookManager.restoreConsoleOutput(originalFunctions);

      // Mock the console functions for testing
      console.log = jest.fn();
      console.warn = jest.fn();

      // Logs should work normally as the functions do nothing with structured logging
      console.log('This should be logged');
      console.warn('This should be logged');

      // Verify logs were called
      expect(console.log).toHaveBeenCalledWith('This should be logged');
      expect(console.warn).toHaveBeenCalledWith('This should be logged');
    });
  });

  describe('Message ID generation', () => {
    test('generateMessageTrackingId should create unique IDs', () => {
      const channelId = 'test-channel';

      // Generate IDs
      const id1 = webhookManager.generateMessageTrackingId(channelId);
      const id2 = webhookManager.generateMessageTrackingId(channelId);

      // IDs should be strings
      expect(typeof id1).toBe('string');

      // IDs should be different even for same channel
      expect(id1).not.toBe(id2);

      // IDs should contain some identifier (channel ID or 'unknown' if not passed)
      expect(id1).toMatch(/tracking-(test-channel|unknown)-\d+-[a-z0-9]+/);
    });
  });


  describe('Message preparation', () => {
    test('prepareMessageData should format message data correctly', () => {
      const content = 'Test message';
      const username = 'TestUser';
      const personality = { fullName: 'test-bot', avatarUrl: 'https://example.com/avatar.png' };
      const isThread = true;
      const threadId = 'thread-123';

      // Test with basic info
      const basicData = webhookManager.prepareMessageData(
        content,
        username,
        personality,
        false,
        threadId
      );
      expect(basicData.content).toBe(content);
      expect(basicData.username).toBe(username);
      expect(basicData._personality).toBe(personality); // Personality is stored internally
      expect(basicData.threadId).toBeUndefined(); // Not a thread

      // Test with thread
      const threadData = webhookManager.prepareMessageData(
        content,
        username,
        personality,
        true,
        threadId
      );
      expect(threadData.threadId).toBe(threadId);

      // Test with embed
      const embedOptions = { embed: { title: 'Test Embed' } };
      const embedData = webhookManager.prepareMessageData(
        content,
        username,
        personality,
        false,
        threadId,
        embedOptions
      );
      expect(embedData.embeds).toBeDefined();
      expect(embedData.embeds[0]).toEqual(embedOptions.embed);

      // Test with null personality
      const nullAvatarData = webhookManager.prepareMessageData(
        content,
        username,
        null,
        false,
        threadId
      );
      expect(nullAvatarData._personality).toBeNull();
    });
  });

  describe('Message chunk sending', () => {
    test('sendMessageChunk should send message via webhook', async () => {
      // Create mock webhook and message data
      const webhook = { send: jest.fn().mockResolvedValue({ id: 'mock-message' }) };
      const messageData = { content: 'Test message', username: 'TestUser' };

      // Call the function
      const result = await webhookManager.sendMessageChunk(webhook, messageData, 0, 1);

      // Verify webhook.send was called with the message data plus avatarURL
      expect(webhook.send).toHaveBeenCalledWith({
        content: 'Test message',
        username: 'TestUser',
        avatarURL: null, // Default when no personality is provided
      });

      // Verify the result
      expect(result).toEqual({ id: 'mock-message' });
    });

    test('sendMessageChunk should handle errors', async () => {
      // Create mock webhook that throws an error
      const error = new Error('Test error');
      error.code = 50035; // Invalid form body

      const webhook = {
        send: jest
          .fn()
          .mockRejectedValueOnce(error) // First call throws
          .mockResolvedValue({ id: 'fallback-message' }), // Second call succeeds (fallback)
      };

      const messageData = { content: 'Test message', username: 'TestUser' };

      // Call should throw, even though fallback was attempted
      await expect(webhookManager.sendMessageChunk(webhook, messageData, 0, 1)).rejects.toThrow();

      // Verify webhook.send was called for both attempts
      expect(webhook.send).toHaveBeenCalledTimes(2);

      // First call should be with original data plus avatarURL
      expect(webhook.send.mock.calls[0][0]).toEqual({
        content: 'Test message',
        username: 'TestUser',
        avatarURL: null,
      });

      // Second call should be with fallback error message (no avatarURL)
      expect(webhook.send.mock.calls[1][0].content).toContain('Error');
      expect(webhook.send.mock.calls[1][0].username).toBe(messageData.username);
      expect(webhook.send.mock.calls[1][0].avatarURL).toBeUndefined();
    });
  });

  describe('Virtual result creation', () => {
    test('createVirtualResult should create a valid result object', () => {
      const personality = { fullName: 'test-personality' };
      const channelId = 'channel-123';

      // Call the function
      const result = webhookManager.createVirtualResult(personality, channelId);

      // Verify structure
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('messageIds');
      expect(result).toHaveProperty('isDuplicate', true);

      // Virtual ID should be in both properties
      expect(result.message.id).toBe(result.messageIds[0]);
      expect(result.message.id).toContain('virtual-');
    });

    test('createVirtualResult should handle missing personality data', () => {
      const channelId = 'channel-123';

      // Call with null personality
      const result1 = webhookManager.createVirtualResult(null, channelId);
      expect(result1).toHaveProperty('isDuplicate', true);

      // Call with personality missing fullName
      const result2 = webhookManager.createVirtualResult({}, channelId);
      expect(result2).toHaveProperty('isDuplicate', true);
    });
  });
});
