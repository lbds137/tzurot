/**
 * Tests for webhook message duplication fix
 */

const { jest: jestGlobal } = require('@jest/globals');

// Important: mock all dependencies before requiring the modules under test
jest.mock('../../src/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// Legacy personality manager removed - using DDD system now

// Mock the conversationManager module
jest.mock('../../src/core/conversation', () => ({
  getActivePersonality: jest.fn(),
  getActivatedPersonality: jest.fn(),
}));


// Mock messageTracker
jest.mock('../../src/messageTracker', () => ({
  messageTracker: {
    track: jest.fn().mockReturnValue(true),
  },
}));

// Mock reference and personality handlers
jest.mock('../../src/handlers/referenceHandler', () => ({
  handleMessageReference: jest.fn().mockResolvedValue(false),
}));

// Mock personality handler
jest.mock('../../src/handlers/personalityHandler', () => ({
  handlePersonalityInteraction: jest.fn().mockResolvedValue(true),
  activeRequests: new Map(),
}));

// Mock messageTrackerHandler
jest.mock('../../src/handlers/messageTrackerHandler', () => ({
  trackMessageInChannel: jest.fn(),
  markMessageAsHandled: jest.fn(),
  delayedProcessing: jest.fn().mockResolvedValue(true),
  ensureInitialized: jest.fn(), // Mock the ensureInitialized function
}));

// Mock other handlers
jest.mock('../../src/handlers/dmHandler', () => ({
  handleDmReply: jest.fn().mockResolvedValue(false),
  handleDirectMessage: jest.fn().mockResolvedValue(false),
}));

// Mock webhookUserTracker directly to control its behavior in tests
jest.mock('../../src/utils/webhookUserTracker', () => ({
  isProxySystemWebhook: jest.fn(),
  getRealUserId: jest.fn(),
  shouldBypassNsfwVerification: jest.fn(),
  isAuthenticationAllowed: jest.fn(),
}));

// Mock channel utils
jest.mock('../../src/utils/channelUtils', () => ({
  isChannelNSFW: jest.fn().mockReturnValue(true),
}));

// After all mocks are set up, import the modules under test
const webhookUserTracker = require('../../src/utils/webhookUserTracker');
const messageHandler = require('../../src/handlers/messageHandler');
const mockLogger = require('../../src/logger');

describe('Webhook Message Duplication Fix', () => {
  // Mock the global tzurotClient
  beforeAll(() => {
    global.tzurotClient = {
      user: {
        id: '123456789012345678',
      },
    };
  });

  // Restore original modules
  afterAll(() => {
    // Restore modules
    jest.resetModules();
    delete global.tzurotClient;
  });

  // Clear mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Webhook identification and handling', () => {
    test('should correctly identify and ignore our own webhook messages', async () => {
      // Create a mock webhook message that should be identified as our own
      // Our own webhooks have applicationId matching the bot's user ID
      const mockMessage = {
        id: '987654321',
        webhookId: '111222333444',
        applicationId: '123456789012345678', // Same as client.user.id
        author: {
          username: 'Albert Einstein',
          bot: true,
          id: '555666777', // Different from client.user.id
        },
        content: 'This is a message from the Einstein personality webhook',
        channel: {
          id: '123456789',
          isDMBased: () => false,
        },
        reference: null,
      };

      // Mock the isProxySystemWebhook function to return false (not a proxy system)
      webhookUserTracker.isProxySystemWebhook.mockReturnValue(false);

      // Call the message handler
      await messageHandler.handleMessage(mockMessage, { user: { id: '123456789012345678' } });

      // Verify that a log message was generated indicating we're ignoring our own webhook
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/Ignoring message from our own webhook/)
      );
    });

    test('handles webhook messages by personality name', async () => {
      // Create a mock message from our bot's webhook
      // Our own webhooks have applicationId matching the bot's user ID
      const mockMessage = {
        id: '222333444',
        webhookId: '888999000',
        applicationId: '123456789012345678', // Same as client.user.id
        author: {
          username: 'Nikola Tesla',
          bot: true,
          id: '999888777', // Different from client.user.id
        },
        content: 'This is a message from the Tesla personality',
        channel: {
          id: '123456789',
          isDMBased: () => false,
        },
      };

      // Mock that this is not a proxy system webhook
      webhookUserTracker.isProxySystemWebhook.mockReturnValue(false);

      // Call the message handler with our mock
      await messageHandler.handleMessage(mockMessage, { user: { id: '123456789012345678' } });

      // Verify proper logging - this should be the log from messageHandler
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/Ignoring message from our own webhook/)
      );
    });
  });
});
