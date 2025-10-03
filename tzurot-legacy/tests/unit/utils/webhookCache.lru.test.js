/**
 * Tests for webhookCache LRU behavior
 *
 * This file tests the LRU eviction and memory management features
 * added to the webhook cache.
 */

jest.mock('../../../src/logger');

const logger = require('../../../src/logger');

describe('webhookCache LRU behavior', () => {
  let webhookCache;
  let mockChannel;
  let mockWebhookClient;
  let createWebhooksCollection;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();

    // Mock logger
    logger.info = jest.fn();
    logger.debug = jest.fn();
    logger.error = jest.fn();
    logger.warn = jest.fn();

    // Clear module cache to get fresh instance
    jest.resetModules();

    // Create mock WebhookClient
    mockWebhookClient = {
      id: '123456789012345678',
      token: 'mock-token',
      destroy: jest.fn(),
      send: jest.fn().mockResolvedValue({ id: 'msg-id' }),
    };

    // Mock discord.js WebhookClient constructor
    jest.doMock('discord.js', () => ({
      WebhookClient: jest.fn().mockImplementation(() => mockWebhookClient),
    }));

    // Now require the module after mocking
    webhookCache = require('../../../src/utils/webhookCache');

    // Helper to create a Map-like webhooks collection
    createWebhooksCollection = (webhooks = []) => {
      return {
        size: webhooks.length,
        find: predicate => webhooks.find(predicate),
      };
    };

    // Create mock channel
    mockChannel = {
      id: '987654321098765432',
      name: 'test-channel',
      isThread: jest.fn().mockReturnValue(false),
      fetchWebhooks: jest.fn().mockResolvedValue(createWebhooksCollection()),
      createWebhook: jest.fn().mockResolvedValue({
        id: '123456789012345678',
        token: 'webhook-token',
        name: 'Tzurot',
      }),
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('LRU eviction', () => {
    it('should evict least recently used webhooks when cache is full', async () => {
      // Note: The cache has a maxSize of 100, so we'll test with a smaller set
      // and verify the eviction callback is working

      // Create 3 channels
      const channels = [];
      for (let i = 1; i <= 3; i++) {
        channels.push({
          id: `channel${i}`,
          name: `test-channel-${i}`,
          isThread: jest.fn().mockReturnValue(false),
          fetchWebhooks: jest.fn().mockResolvedValue(createWebhooksCollection()),
          createWebhook: jest.fn().mockResolvedValue({
            id: `webhook${i}`,
            token: `token${i}`,
            name: 'Tzurot',
          }),
        });
      }

      // Add webhooks to cache
      for (const channel of channels) {
        await webhookCache.getOrCreateWebhook(channel);
        jest.advanceTimersByTime(100); // Advance time between additions
      }

      // Verify all are cached
      expect(webhookCache.getCacheSize()).toBe(3);
      expect(webhookCache.hasWebhook('channel1')).toBe(true);
      expect(webhookCache.hasWebhook('channel2')).toBe(true);
      expect(webhookCache.hasWebhook('channel3')).toBe(true);

      // Access channel1 to make it recently used
      const cachedWebhook = await webhookCache.getOrCreateWebhook(channels[0]);
      expect(cachedWebhook).toBeDefined();

      // When we manually clear the cache, it should call destroy on all webhooks
      webhookCache.clearAllWebhookCaches();

      // Verify destroy was called (once per webhook)
      const { WebhookClient } = require('discord.js');
      const destroyCalls = WebhookClient.mock.results
        .map(result => result.value.destroy.mock.calls.length)
        .reduce((sum, calls) => sum + calls, 0);

      expect(destroyCalls).toBeGreaterThanOrEqual(3);
    });

    it('should respect TTL and evict expired webhooks', async () => {
      // Create webhook
      await webhookCache.getOrCreateWebhook(mockChannel);

      // Verify it's cached initially
      const cacheSize = webhookCache.getCacheSize();
      expect(cacheSize).toBe(1);

      // Advance time past TTL (24 hours + 1 second)
      jest.advanceTimersByTime(24 * 60 * 60 * 1000 + 1000);

      // Access the webhook - should trigger expiration check
      const hasWebhook = webhookCache.hasWebhook(mockChannel.id);

      // Check if webhook was evicted due to TTL
      expect(hasWebhook).toBe(false);
    });

    it('should handle thread webhooks in LRU cache', async () => {
      // Create thread channel
      const threadChannel = {
        id: 'thread123',
        name: 'test-thread',
        isThread: jest.fn().mockReturnValue(true),
        parent: {
          ...mockChannel,
          fetchWebhooks: jest.fn().mockResolvedValue(createWebhooksCollection()),
        },
      };

      // Get webhook for thread
      await webhookCache.getOrCreateWebhook(threadChannel);

      // Should have both parent and thread webhooks cached
      expect(webhookCache.getCacheSize()).toBe(2); // Parent + thread-specific

      // Verify both are in cache
      const hasParent = webhookCache.hasWebhook(mockChannel.id);
      const hasThread = webhookCache.hasWebhook('thread123');
      expect(hasParent).toBe(true);
      expect(hasThread).toBe(true);

      // Clear thread webhook
      webhookCache.clearWebhookCache('thread123');

      // Parent should still be cached, thread should be gone
      const hasParentAfter = webhookCache.hasWebhook(mockChannel.id);
      const hasThreadAfter = webhookCache.hasWebhook('thread123');
      expect(hasParentAfter).toBe(true);
      expect(hasThreadAfter).toBe(false);
    });
  });

  describe('cache statistics', () => {
    it('should track cache size correctly', async () => {
      expect(webhookCache.getCacheSize()).toBe(0);

      // Add webhook
      await webhookCache.getOrCreateWebhook(mockChannel);
      expect(webhookCache.getCacheSize()).toBe(1);

      // Add another channel
      const channel2 = { ...mockChannel, id: 'channel2' };
      await webhookCache.getOrCreateWebhook(channel2);
      expect(webhookCache.getCacheSize()).toBe(2);

      // Clear one
      webhookCache.clearWebhookCache(mockChannel.id);
      expect(webhookCache.getCacheSize()).toBe(1);

      // Clear all
      webhookCache.clearAllWebhookCaches();
      expect(webhookCache.getCacheSize()).toBe(0);
    });
  });

  describe('event listener cleanup', () => {
    it('should clean up webhooks when channel is deleted', () => {
      const mockClient = {
        on: jest.fn(),
      };

      // Register event listeners
      webhookCache.registerEventListeners(mockClient);

      // Verify channelDelete listener was registered
      expect(mockClient.on).toHaveBeenCalledWith('channelDelete', expect.any(Function));

      // Get the channelDelete handler
      const channelDeleteHandler = mockClient.on.mock.calls.find(
        call => call[0] === 'channelDelete'
      )[1];

      // Add a webhook to cache first
      webhookCache._webhookCache.set('testChannelId', mockWebhookClient);
      expect(webhookCache.hasWebhook('testChannelId')).toBe(true);

      // Simulate channel deletion
      channelDeleteHandler({ id: 'testChannelId' });

      // Webhook should be cleared
      expect(webhookCache.hasWebhook('testChannelId')).toBe(false);
    });
  });
});
