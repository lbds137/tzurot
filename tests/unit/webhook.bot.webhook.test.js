/**
 * Test file to verify that the bot's own webhooks are correctly identified
 * and don't receive age verification prompts
 */

const { jest: jestGlobal } = require('@jest/globals');
const webhookUserTracker = require('../../src/utils/webhookUserTracker');

describe('Bot Webhook Identification', () => {
  // Mock the global.tzurotClient for the tests
  beforeAll(() => {
    global.tzurotClient = {
      user: {
        id: '123456789012345678'
      }
    };
  });

  afterAll(() => {
    delete global.tzurotClient;
  });

  // Clear mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should identify bot webhook by owner ID', () => {
    // Create a mock message from a bot webhook
    const mockMessage = {
      webhookId: '987654321',
      author: {
        username: 'Albert Einstein'
      },
      webhook: {
        owner: {
          id: '123456789012345678' // Same as bot's ID
        }
      }
    };

    // Check if the webhook is properly identified
    const result = webhookUserTracker.isProxySystemWebhook(mockMessage);
    
    // Should identify this as a bot webhook and return true
    expect(result).toBe(true);
  });

  test('should identify bot webhook by application ID', () => {
    // Create a mock message from a bot webhook with application ID
    const mockMessage = {
      webhookId: '987654321',
      applicationId: '123456789012345678', // Same as bot's ID
      author: {
        username: 'Albert Einstein'
      },
      // No webhook object in this case
    };

    // Check if the webhook is properly identified
    const result = webhookUserTracker.isProxySystemWebhook(mockMessage);
    
    // Should identify this as a bot webhook and return true
    expect(result).toBe(true);
  });

  test('should bypass NSFW verification for bot webhooks', () => {
    // Create a mock message from a bot webhook
    const mockMessage = {
      webhookId: '987654321',
      author: {
        username: 'Albert Einstein'
      },
      webhook: {
        owner: {
          id: '123456789012345678' // Same as bot's ID
        }
      }
    };

    // Check if NSFW verification is bypassed
    const result = webhookUserTracker.shouldBypassNsfwVerification(mockMessage);
    
    // Should bypass verification
    expect(result).toBe(true);
  });

  test('should handle errors gracefully when checking webhook owner', () => {
    // This test just verifies that no exception is thrown when owner is missing
    // Create a mock message with malformed webhook data
    const mockMessage = {
      webhookId: '999999999', // Using a different ID to avoid cache issues
      author: {
        username: 'Albert Einstein'
      },
      webhook: {
        // Missing owner property which should be handled gracefully
      }
    };

    // This should not throw an error due to the try/catch in the implementation
    let errorThrown = false;
    try {
      webhookUserTracker.isProxySystemWebhook(mockMessage);
    } catch (error) {
      errorThrown = true;
    }
    
    // Verify no error was thrown
    expect(errorThrown).toBe(false);
  });
});