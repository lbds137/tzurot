/**
 * Tests for webhookManager.js exported functions
 */

// Unmock webhookManager since it's globally mocked in setup.js
jest.unmock('../../src/webhookManager');

// Import mocks
jest.mock('node-fetch', () => {
  return jest.fn().mockImplementation(() => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true }),
    text: async () => 'Success',
    buffer: async () => Buffer.from('Success'),
    headers: new Map([['content-type', 'application/json']]),
  }));
});

// Mock discord.js
jest.mock('discord.js', () => {
  return {
    WebhookClient: jest.fn().mockImplementation(() => ({
      id: 'mock-webhook-id',
      send: jest.fn().mockResolvedValue({
        id: 'mock-message-id',
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
    })),
  };
});

// Mock profileInfoFetcher to prevent interval creation
jest.mock('../../src/profileInfoFetcher', () => ({
  getFetcher: jest.fn().mockReturnValue({
    fetchProfileInfo: jest.fn().mockResolvedValue({
      avatarUrl: 'https://example.com/avatar.png',
      displayName: 'Test User',
    }),
  }),
  getProfileAvatarUrl: jest.fn().mockResolvedValue('https://example.com/avatar.png'),
  deleteFromCache: jest.fn(),
}));

// Mock logger
jest.mock('../../src/logger');

// Import module after mocking dependencies
let webhookManager;

describe('WebhookManager - Exported Functions', () => {
  // Original console methods
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;

  beforeEach(() => {
    // Mock console methods
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();

    // Ensure module is freshly loaded
    jest.resetModules();
    webhookManager = require('../../src/webhookManager');

    // Mock some of the module's internal values
    if (webhookManager._resetInternalState) {
      webhookManager._resetInternalState();
    }
  });

  afterEach(() => {
    // Restore console methods
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;

    // Clean up
    jest.clearAllMocks();
  });

  describe('getStandardizedUsername', () => {
    it('should prioritize displayName if available', () => {
      const personality = {
        fullName: 'test-personality',
        profile: {
          displayName: 'Test Display Name',
        },
      };

      const result = webhookManager.getStandardizedUsername(personality);
      expect(result).toBe('Test Display Name');
    });

    it('should truncate display names longer than 32 characters', () => {
      const personality = {
        profile: {
          displayName:
            "This is a very long display name that exceeds Discord's limit of 32 characters",
        },
      };

      const result = webhookManager.getStandardizedUsername(personality);
      expect(result.length).toBeLessThanOrEqual(32);
      expect(result).toContain('...');
    });

    it('should extract name from fullName if displayName is not available', () => {
      const personality = {
        fullName: 'test-personality-with-hyphens',
      };

      const result = webhookManager.getStandardizedUsername(personality);
      // Should capitalize the first part of the hyphenated name
      expect(result).toBe('Test');
    });

    it('should use fullName if it has no hyphens and is short enough', () => {
      const personality = {
        fullName: 'shortname',
      };

      const result = webhookManager.getStandardizedUsername(personality);
      // Should capitalize the first letter
      expect(result).toBe('Shortname');
    });

    it('should return "Bot" for null or undefined personality', () => {
      expect(webhookManager.getStandardizedUsername(null)).toBe('Bot');
      expect(webhookManager.getStandardizedUsername(undefined)).toBe('Bot');
    });
  });

  describe('hashMessage and isDuplicateMessage', () => {
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

    it('should detect duplicate messages', () => {
      const content = 'Test message content';
      const username = 'TestUser';
      const channelId = 'channel-123';

      // First message should not be a duplicate
      expect(webhookManager.isDuplicateMessage(content, username, channelId)).toBe(false);

      // Second identical message should be detected as a duplicate
      expect(webhookManager.isDuplicateMessage(content, username, channelId)).toBe(true);
    });

    it('should not detect different messages as duplicates', () => {
      const username = 'TestUser';
      const channelId = 'channel-123';

      // First message
      expect(webhookManager.isDuplicateMessage('First message', username, channelId)).toBe(false);

      // Different content
      expect(webhookManager.isDuplicateMessage('Second message', username, channelId)).toBe(false);

      // Different username
      expect(webhookManager.isDuplicateMessage('First message', 'DifferentUser', channelId)).toBe(
        false
      );

      // Different channel
      expect(
        webhookManager.isDuplicateMessage('First message', username, 'different-channel')
      ).toBe(false);
    });

    it('should not flag empty content as duplicate', () => {
      const username = 'TestUser';
      const channelId = 'channel-123';

      expect(webhookManager.isDuplicateMessage('', username, channelId)).toBe(false);
      expect(webhookManager.isDuplicateMessage(null, username, channelId)).toBe(false);
      expect(webhookManager.isDuplicateMessage(undefined, username, channelId)).toBe(false);
    });
  });

  describe('Pending message functions', () => {
    afterEach(() => {
      // Clear any pending timeouts to prevent open handles
      jest.clearAllTimers();
    });

    it('should create a consistent key format for personality-channel combinations', () => {
      const personalityName = 'test-personality';
      const channelId = 'channel-123';

      const key = webhookManager.createPersonalityChannelKey(personalityName, channelId);
      expect(key).toBe('test-personality_channel-123');
    });

    it('should register and detect pending messages', () => {
      const personalityName = 'test-personality';
      const channelId = 'channel-123';
      const content = 'Test message content';

      // Initially no pending message
      expect(webhookManager.hasPersonalityPendingMessage(personalityName, channelId)).toBe(false);

      // Register a pending message
      webhookManager.registerPendingMessage(personalityName, channelId, content, false);

      // Now it should have a pending message
      expect(webhookManager.hasPersonalityPendingMessage(personalityName, channelId)).toBe(true);

      // Clear the pending message
      webhookManager.clearPendingMessage(personalityName, channelId);

      // No longer has a pending message
      expect(webhookManager.hasPersonalityPendingMessage(personalityName, channelId)).toBe(false);
    });

    it('should timeout pending messages after the error wait time', () => {
      // Backup original Date.now
      const originalDateNow = Date.now;

      try {
        // Set a fixed current time
        const currentTime = 1600000000000;
        Date.now = jest.fn().mockReturnValue(currentTime);

        const personalityName = 'test-personality';
        const channelId = 'channel-123';
        const content = 'Test message content';

        // Register a pending message
        webhookManager.registerPendingMessage(personalityName, channelId, content, false);

        // Should have a pending message
        expect(webhookManager.hasPersonalityPendingMessage(personalityName, channelId)).toBe(true);

        // Advance time beyond the error wait timeout
        // (15 seconds in webhookManager.js - MAX_ERROR_WAIT_TIME)
        Date.now = jest.fn().mockReturnValue(currentTime + 16000);

        // Should no longer be considered pending
        expect(webhookManager.hasPersonalityPendingMessage(personalityName, channelId)).toBe(false);
      } finally {
        // Restore original Date.now
        Date.now = originalDateNow;
      }
    });
  });

  describe('Message timing functions', () => {
    it('should calculate delay needed for proper message ordering', () => {
      // Backup original Date.now
      const originalDateNow = Date.now;

      try {
        // Set a fixed current time
        const currentTime = 1600000000000;
        Date.now = jest.fn().mockReturnValue(currentTime);

        const channelId = 'channel-123';

        // Initially should not need a delay
        expect(webhookManager.calculateMessageDelay(channelId)).toBe(0);

        // Update last message time for the channel
        webhookManager.updateChannelLastMessageTime(channelId);

        // No delay needed if enough time has passed
        Date.now = jest.fn().mockReturnValue(currentTime + 4000); // 4 seconds later
        expect(webhookManager.calculateMessageDelay(channelId)).toBe(0);

        // Reset time to just after the message was sent
        Date.now = jest.fn().mockReturnValue(currentTime + 1000); // 1 second later

        // Should need a delay because MIN_MESSAGE_DELAY is 3 seconds
        // (As defined in webhookManager.js)
        const delay = webhookManager.calculateMessageDelay(channelId);
        expect(delay).toBeGreaterThan(0);
        expect(delay).toBeLessThanOrEqual(2000); // Should need 2 more seconds (3 - 1)
      } finally {
        // Restore original Date.now
        Date.now = originalDateNow;
      }
    });
  });

  describe('Webhook cache functions', () => {
    // These functions interact directly with the webhook cache, which is an internal
    // implementation detail, so we'll test a simplified version of them

    it('should have clearWebhookCache and clearAllWebhookCaches functions exported', () => {
      expect(typeof webhookManager.clearWebhookCache).toBe('function');
      expect(typeof webhookManager.clearAllWebhookCaches).toBe('function');
    });

    // We can't effectively test these without setting up complex mocks of the
    // internal state, which would be brittle, so we'll just verify they exist
  });

  describe('preloadPersonalityAvatar', () => {
    it('should be an exported function that handles avatars', () => {
      // Verify the function exists
      expect(typeof webhookManager.preloadPersonalityAvatar).toBe('function');

      // Create a personality with no avatar to avoid actual fetch calls
      const personality = {
        fullName: 'test-personality',
        displayName: 'Test Personality',
      };

      // Should not throw
      expect(() => webhookManager.preloadPersonalityAvatar(personality)).not.toThrow();
    });
  });
});
