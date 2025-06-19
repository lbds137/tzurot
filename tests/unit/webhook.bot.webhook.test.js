/**
 * Test file to verify that proxy system webhooks (like PluralKit)
 * are correctly identified and handled
 */

const { jest: jestGlobal } = require('@jest/globals');

// Mock dependencies before requiring the module
jest.mock('../../src/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const webhookUserTracker = require('../../src/utils/webhookUserTracker');
const mockLogger = require('../../src/logger');

describe('Proxy System Webhook Identification', () => {
  // Clear mocks and reset module state before each test
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear the webhook cache to prevent test interference
    webhookUserTracker.clearAllCachedWebhooks();
  });

  // Clean up timers after tests
  afterAll(() => {
    jest.clearAllTimers();
  });

  test('should identify PluralKit webhook by application ID', () => {
    // Create a mock message from PluralKit
    const mockMessage = {
      webhookId: '987654321',
      applicationId: '466378653216014359', // PluralKit bot ID
      author: {
        username: 'Alice | System Name',
      },
    };

    // Check if the webhook is properly identified as a proxy system
    const result = webhookUserTracker.isProxySystemWebhook(mockMessage);

    // Should identify this as a proxy system webhook
    expect(result).toBe(true);
    expect(mockLogger.info).toHaveBeenCalledWith(
      '[WebhookUserTracker] Identified proxy system by application ID: 466378653216014359'
    );
  });

  test('should identify Tupperbox webhook by application ID', () => {
    // Create a mock message from Tupperbox
    const mockMessage = {
      webhookId: '987654321',
      applicationId: '510016054391734273', // Tupperbox bot ID
      author: {
        username: 'Character Name',
      },
    };

    // Check if the webhook is properly identified as a proxy system
    const result = webhookUserTracker.isProxySystemWebhook(mockMessage);

    // Should identify this as a proxy system webhook
    expect(result).toBe(true);
  });

  test('should NOT identify bot webhooks as proxy systems', () => {
    // Create a mock message from our bot's webhook
    // Note: Bot webhooks are identified by applicationId matching bot's user ID
    // which is handled in messageHandler.js, not webhookUserTracker
    const mockMessage = {
      webhookId: 'different-webhook-456', // Use a different webhook ID
      applicationId: '123456789012345678', // Some other bot's ID
      author: {
        username: 'Some Bot',
      },
    };

    // Check if the webhook is identified as a proxy system
    const result = webhookUserTracker.isProxySystemWebhook(mockMessage);

    // Should NOT identify this as a proxy system (it's not PluralKit or Tupperbox)
    expect(result).toBe(false);
  });

  test('should bypass NSFW verification for proxy system webhooks', () => {
    // Create a mock message from PluralKit
    const mockMessage = {
      webhookId: '987654321',
      applicationId: '466378653216014359', // PluralKit bot ID
      author: {
        username: 'Alice | System Name',
      },
    };

    // Check if NSFW verification is bypassed
    const result = webhookUserTracker.shouldBypassNsfwVerification(mockMessage);

    // Should bypass verification for proxy systems
    expect(result).toBe(true);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Bypassing NSFW verification for proxy system')
    );
  });

  test('should not allow authentication for proxy system webhooks', () => {
    // Create a mock message from PluralKit
    const mockMessage = {
      webhookId: '987654321',
      applicationId: '466378653216014359', // PluralKit bot ID
      author: {
        username: 'Alice | System Name',
      },
    };

    // Check if authentication is allowed
    const result = webhookUserTracker.isAuthenticationAllowed(mockMessage);

    // Should NOT allow authentication for proxy systems
    expect(result).toBe(false);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Authentication not allowed for proxy system')
    );
  });

  test('should handle errors gracefully when checking webhooks', () => {
    // Create a mock message with minimal data
    const mockMessage = {
      webhookId: '999999999',
      author: {
        username: 'Test User',
      },
      // Missing applicationId and other fields
    };

    // This should not throw an error
    let errorThrown = false;
    try {
      webhookUserTracker.isProxySystemWebhook(mockMessage);
    } catch (error) {
      errorThrown = true;
    }

    // Verify no error was thrown
    expect(errorThrown).toBe(false);
  });

  test('should return special user ID for proxy systems', () => {
    // Create a mock message from PluralKit
    const mockMessage = {
      webhookId: '987654321',
      applicationId: '466378653216014359', // PluralKit bot ID
      content: 'Test message',
      channel: {
        id: 'test-channel-id',
      },
      author: {
        username: 'Alice | System Name',
        id: 'webhook-user-id',
      },
    };

    // Get the real user ID
    const result = webhookUserTracker.getRealUserId(mockMessage);

    // Should return special proxy-system-user ID
    expect(result).toBe('proxy-system-user');
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Detected proxy system webhook')
    );
  });
});
