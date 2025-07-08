// Unmock webhookManager since it's globally mocked in setup.js
jest.unmock('../../src/webhookManager');

// Mock dependencies
jest.mock('../../src/logger');
jest.mock('../../src/utils/media/mediaHandler');
jest.mock('../../src/utils/webhookCache', () => ({
  getWebhook: jest.fn(),
  getActiveWebhooks: jest.fn().mockReturnValue(new Set()),
  getOrCreateWebhook: jest.fn(),
  clearWebhookCache: jest.fn(),
  hasWebhook: jest.fn(),
}));
jest.mock('discord.js', () => ({
  WebhookClient: jest.fn(),
}));

const webhookManager = require('../../src/webhookManager');
const logger = require('../../src/logger');
const webhookCache = require('../../src/utils/webhookCache');

describe('Webhook Manager - Media Handling', () => {
  let mockChannel;
  let mockWebhook;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockWebhook = {
      id: 'webhook-123',
      send: jest.fn().mockResolvedValue({
        id: 'webhook-message-123',
        content: 'webhook response',
      }),
    };

    mockChannel = {
      id: 'channel-123',
      name: 'test-channel',
      isDMBased: jest.fn().mockReturnValue(false),
      isThread: jest.fn().mockReturnValue(false),
      send: jest.fn().mockResolvedValue({
        id: 'fallback-message-123',
      }),
    };

    // Mock dependencies
    webhookCache.getWebhook.mockReturnValue(mockWebhook);
    webhookCache.getOrCreateWebhook.mockResolvedValue(mockWebhook);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('should send message with files through webhook', async () => {
    await webhookManager.sendWebhookMessage(
      mockChannel,
      'Check out this content',
      {
        fullName: 'test-personality',
        profile: {
          displayName: 'Test Personality',
        },
      },
      {
        files: [
          {
            attachment: 'https://example.com/image.png',
            name: 'image.png',
          },
        ],
      }
    );

    expect(mockWebhook.send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Check out this content',
        username: 'Test Personality',
      })
    );
  });

  test('should send message with single file through webhook', async () => {
    const promise = webhookManager.sendWebhookMessage(
      mockChannel,
      'Multiple files',
      {
        fullName: 'test-personality',
        profile: {
          displayName: 'Test Personality',
        },
      },
      {
        files: [{ attachment: 'https://example.com/image1.png', name: 'image1.png' }],
      }
    );

    // Advance timers to resolve any pending timers
    jest.runAllTimers();

    await promise;

    expect(mockWebhook.send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Multiple files',
        username: 'Test Personality',
      })
    );
  });

  test('should handle DM channels without webhooks', async () => {
    mockChannel.isDMBased.mockReturnValue(true);

    await webhookManager.sendWebhookMessage(
      mockChannel,
      'DM with file',
      {
        fullName: 'test-personality',
        profile: {
          displayName: 'Test Personality',
        },
      },
      {
        files: [
          {
            attachment: 'https://example.com/image.png',
            name: 'image.png',
          },
        ],
      }
    );

    // In DMs, it should use channel.send instead of webhook
    expect(mockChannel.send).toHaveBeenCalled();
    expect(mockWebhook.send).not.toHaveBeenCalled();
  });

  test('should handle empty content with files', async () => {
    const promise = webhookManager.sendWebhookMessage(
      mockChannel,
      '',
      {
        fullName: 'test-personality',
        profile: {
          displayName: 'Test Personality',
        },
      },
      {
        files: [
          {
            attachment: 'https://example.com/image.png',
            name: 'image.png',
          },
        ],
      }
    );

    jest.runAllTimers();
    await promise;

    expect(mockWebhook.send).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'Test Personality',
        files: expect.arrayContaining([
          expect.objectContaining({
            attachment: 'https://example.com/image.png',
          }),
        ]),
      })
    );
  });

  test('should send simple message without options', async () => {
    const promise = webhookManager.sendWebhookMessage(mockChannel, 'Message with embed', {
      fullName: 'test-personality',
      profile: {
          displayName: 'Test Personality',
        },
    });

    // Advance timers to resolve any pending timers
    jest.runAllTimers();

    await promise;

    expect(mockWebhook.send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Message with embed',
        username: 'Test Personality',
      })
    );
  });

  test('should handle errors gracefully', async () => {
    mockWebhook.send.mockRejectedValue(new Error('Webhook error'));

    const promise = webhookManager.sendWebhookMessage(mockChannel, 'This will fail', {
      fullName: 'test-personality',
      profile: {
        displayName: 'Test Personality',
      },
    });

    // Advance timers to resolve any pending timers
    jest.runAllTimers();

    await expect(promise).rejects.toThrow();

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Error'));
  });
});
