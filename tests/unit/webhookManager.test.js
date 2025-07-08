/**
 * Tests for webhookManager.js
 * Focus on message splitting and duplicate detection
 */

// Unmock webhookManager since it's globally mocked in setup.js
jest.unmock('../../src/webhookManager');

// We will require the module fresh in each test suite to ensure proper isolation
let webhookManager;

// Mock node-fetch
jest.mock('node-fetch', () => {
  return jest.fn().mockImplementation(async (url, requestOptions = {}) => {
    // No need to simulate network delay in tests

    // Create a mock Response object
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
      text: async () => 'Success',
      blob: async () => new Blob(['Success']),
      buffer: async () => Buffer.from('Success'),
      headers: new Map([['content-type', 'application/json']]),
    };
  });
});

// Mock discord.js
jest.mock('discord.js', () => {
  return {
    WebhookClient: jest.fn().mockImplementation(() => ({
      id: 'mock-webhook-id',
      name: 'Mock Webhook',
      channelId: 'mock-channel-id',
      send: jest.fn().mockResolvedValue({
        id: `mock-msg-${Date.now()}`,
        webhookId: 'mock-webhook-id',
      }),
      destroy: jest.fn(),
    })),
    EmbedBuilder: jest.fn().mockImplementation(data => ({
      ...data,
      setTitle: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      setColor: jest.fn().mockReturnThis(),
      addFields: jest.fn().mockReturnThis(),
      setThumbnail: jest.fn().mockReturnThis(),
      setFooter: jest.fn().mockReturnThis(),
    })),
  };
});

describe('WebhookManager', () => {
  // Original console methods
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;

  // Test data
  const testChannelId = 'test-channel-123';
  const testUserId = 'test-user-456';
  const testPersonalityName = 'test-personality';
  const testMessageContent = 'This is a test message';

  beforeEach(() => {
    // CRITICAL: Use fake timers to prevent real timeouts
    jest.useFakeTimers();

    // Mock console methods
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();

    // Clear any module state by resetting modules
    jest.resetModules();

    // Require the module fresh for each test
    webhookManager = require('../../src/webhookManager');
  });

  afterEach(() => {
    // CRITICAL: Use real timers to prevent open handles
    jest.useRealTimers();

    // Clear all pending messages to prevent memory leaks
    if (webhookManager && webhookManager.clearAllPendingMessages) {
      webhookManager.clearAllPendingMessages();
    }

    // Restore console methods
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;

    // Clear all mock function calls
    jest.clearAllMocks();
  });

  // splitMessage tests are now in webhookManager.splitting.test.js

  describe('isDuplicateMessage and hashMessage', () => {
    it('should create a consistent hash for a message', () => {
      const content = 'Test message content';
      const username = 'TestUser';
      const channelId = 'channel-123';

      const hash1 = webhookManager.hashMessage(content, username, channelId);
      const hash2 = webhookManager.hashMessage(content, username, channelId);

      // Same inputs should produce the same hash
      expect(hash1).toBe(hash2);

      // Different inputs should produce different hashes
      const differentHash = webhookManager.hashMessage('Different content', username, channelId);
      expect(hash1).not.toBe(differentHash);
    });

    it('should detect a duplicate message', () => {
      const content = 'Test message content';
      const username = 'TestUser';
      const channelId = 'channel-123';

      // First time is not a duplicate
      expect(webhookManager.isDuplicateMessage(content, username, channelId)).toBe(false);

      // Second time should be detected as duplicate
      expect(webhookManager.isDuplicateMessage(content, username, channelId)).toBe(true);
    });

    it('should not consider different messages as duplicates', () => {
      const username = 'TestUser';
      const channelId = 'channel-123';

      // First message
      expect(webhookManager.isDuplicateMessage('First message', username, channelId)).toBe(false);

      // Different content should not be a duplicate
      expect(webhookManager.isDuplicateMessage('Second message', username, channelId)).toBe(false);

      // Different username should not be a duplicate
      expect(webhookManager.isDuplicateMessage('First message', 'DifferentUser', channelId)).toBe(
        false
      );

      // Different channel should not be a duplicate
      expect(
        webhookManager.isDuplicateMessage('First message', username, 'different-channel')
      ).toBe(false);
    });

    it('should not consider empty content as a duplicate', () => {
      const username = 'TestUser';
      const channelId = 'channel-123';

      expect(webhookManager.isDuplicateMessage('', username, channelId)).toBe(false);
      expect(webhookManager.isDuplicateMessage(null, username, channelId)).toBe(false);
      expect(webhookManager.isDuplicateMessage(undefined, username, channelId)).toBe(false);
    });
  });

  describe('getStandardizedUsername', () => {
    it('should prioritize displayName if available', () => {
      const personality = {
        fullName: 'full-name-personality',
        profile: {
          displayName: 'Display Name',
        },
      };

      expect(webhookManager.getStandardizedUsername(personality)).toBe('Display Name');
    });

    it('should fall back to first part of fullName if no displayName', () => {
      const personality = {
        fullName: 'first-second-third',
      };

      expect(webhookManager.getStandardizedUsername(personality)).toBe('First');
    });

    it('should use fullName if no hyphens and under limit', () => {
      const personality = {
        fullName: 'shortname',
      };

      // Use a case-insensitive match because the implementation capitalizes the first letter
      const result = webhookManager.getStandardizedUsername(personality);
      expect(result.toLowerCase()).toBe('shortname'.toLowerCase());
    });

    it('should truncate names longer than 32 characters', () => {
      const personality = {
        profile: {
          displayName: 'This is a very long display name that exceeds discord limits',
        },
      };

      const result = webhookManager.getStandardizedUsername(personality);
      expect(result.length).toBeLessThanOrEqual(32);
      expect(result).toContain('...');
    });

    it('should return "Bot" for null or undefined personality', () => {
      expect(webhookManager.getStandardizedUsername(null)).toBe('Bot');
      expect(webhookManager.getStandardizedUsername(undefined)).toBe('Bot');
      expect(webhookManager.getStandardizedUsername({})).toBe('Bot');
    });
  });

  describe('Pending Message Tracking', () => {
    afterEach(() => {
      // Clear any pending timeouts to prevent open handles
      jest.clearAllTimers();
    });

    it('should create a consistent key for personality-channel combinations', () => {
      const personalityName = 'test-personality';
      const channelId = 'channel-123';

      const key = webhookManager.createPersonalityChannelKey(personalityName, channelId);
      expect(key).toBe('test-personality_channel-123');
    });

    it('should register and detect pending messages', () => {
      const personalityName = 'test-personality';
      const channelId = 'channel-123';
      const content = 'Test message content';

      // Initially should have no pending message
      expect(webhookManager.hasPersonalityPendingMessage(personalityName, channelId)).toBe(false);

      // Register a pending message
      webhookManager.registerPendingMessage(personalityName, channelId, content, false);

      // Should now detect a pending message
      expect(webhookManager.hasPersonalityPendingMessage(personalityName, channelId)).toBe(true);

      // Clear the pending message
      webhookManager.clearPendingMessage(personalityName, channelId);

      // Should no longer have a pending message
      expect(webhookManager.hasPersonalityPendingMessage(personalityName, channelId)).toBe(false);
    });

    it('should expire pending messages after timeout', () => {
      const personalityName = 'test-personality';
      const channelId = 'channel-123';
      const content = 'Test message content';

      // Register a pending message
      webhookManager.registerPendingMessage(personalityName, channelId, content, false);

      // Should detect a pending message
      expect(webhookManager.hasPersonalityPendingMessage(personalityName, channelId)).toBe(true);

      // Advance fake timers beyond the timeout (MAX_ERROR_WAIT_TIME = 15000)
      jest.advanceTimersByTime(20000);

      // Pending message should have expired
      expect(webhookManager.hasPersonalityPendingMessage(personalityName, channelId)).toBe(false);
    });
  });
});
