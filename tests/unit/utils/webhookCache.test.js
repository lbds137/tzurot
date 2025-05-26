/**
 * Tests for webhookCache.js
 */

// Mock discord.js
jest.mock('discord.js', () => ({
  WebhookClient: jest.fn().mockImplementation((options) => ({
    id: options.id || 'mock-webhook-id',
    token: options.token || 'mock-webhook-token',
    send: jest.fn().mockResolvedValue({
      id: 'mock-message-id',
      webhookId: options.id || 'mock-webhook-id'
    }),
    destroy: jest.fn()
  }))
}));

// Mock logger
jest.mock('../../../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

const { WebhookClient } = require('discord.js');
const logger = require('../../../src/logger');
const webhookCache = require('../../../src/utils/webhookCache');

describe('webhookCache', () => {
  // Create mock objects
  const createMockWebhook = (id = 'webhook-123', name = 'Tzurot') => ({
    id,
    token: `token-${id}`,
    name
  });

  const createMockChannel = (id = 'channel-123', name = 'test-channel', isThread = false) => ({
    id,
    name,
    isThread: jest.fn().mockReturnValue(isThread),
    fetchWebhooks: jest.fn(),
    createWebhook: jest.fn(),
    parent: isThread ? { 
      id: 'parent-channel-123', 
      name: 'parent-channel',
      fetchWebhooks: jest.fn(),
      createWebhook: jest.fn()
    } : null
  });

  // Helper to create a Map-like webhooks collection
  const createWebhooksCollection = (webhooks = []) => {
    const map = new Map();
    webhooks.forEach(wh => map.set(wh.id, wh));
    
    return {
      size: webhooks.length,
      find: (predicate) => webhooks.find(predicate)
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Clear internal caches
    webhookCache._webhookCache.clear();
    webhookCache._activeWebhooks.clear();
  });

  describe('getOrCreateWebhook', () => {
    it('should create a new webhook if none exists', async () => {
      const mockChannel = createMockChannel();
      const mockWebhook = createMockWebhook();
      
      mockChannel.fetchWebhooks.mockResolvedValue(createWebhooksCollection());
      mockChannel.createWebhook.mockResolvedValue(mockWebhook);

      const result = await webhookCache.getOrCreateWebhook(mockChannel);

      expect(mockChannel.fetchWebhooks).toHaveBeenCalledTimes(1);
      expect(mockChannel.createWebhook).toHaveBeenCalledWith({
        name: 'Tzurot',
        avatar: null,
        reason: 'Bot webhook for personality messages'
      });
      expect(WebhookClient).toHaveBeenCalledWith({
        id: mockWebhook.id,
        token: mockWebhook.token
      });
      expect(result).toBeDefined();
      expect(result.id).toBe(mockWebhook.id);
    });

    it('should use existing webhook if one exists', async () => {
      const mockChannel = createMockChannel();
      const mockWebhook = createMockWebhook();
      
      mockChannel.fetchWebhooks.mockResolvedValue(createWebhooksCollection([mockWebhook]));

      const result = await webhookCache.getOrCreateWebhook(mockChannel);

      expect(mockChannel.fetchWebhooks).toHaveBeenCalledTimes(1);
      expect(mockChannel.createWebhook).not.toHaveBeenCalled();
      expect(WebhookClient).toHaveBeenCalledWith({
        id: mockWebhook.id,
        token: mockWebhook.token
      });
      expect(result).toBeDefined();
    });

    it('should return cached webhook on subsequent calls', async () => {
      const mockChannel = createMockChannel();
      const mockWebhook = createMockWebhook();
      
      mockChannel.fetchWebhooks.mockResolvedValue(createWebhooksCollection());
      mockChannel.createWebhook.mockResolvedValue(mockWebhook);

      // First call - creates webhook
      const result1 = await webhookCache.getOrCreateWebhook(mockChannel);
      
      // Second call - should use cache
      const result2 = await webhookCache.getOrCreateWebhook(mockChannel);

      expect(mockChannel.fetchWebhooks).toHaveBeenCalledTimes(1); // Only called once
      expect(mockChannel.createWebhook).toHaveBeenCalledTimes(1); // Only called once
      expect(result1).toBe(result2); // Same instance returned
    });

    describe('thread handling', () => {
      it('should handle threads by using parent channel webhook', async () => {
        const mockThread = createMockChannel('thread-123', 'test-thread', true);
        const mockParentWebhook = createMockWebhook('parent-webhook-123');
        
        mockThread.parent.fetchWebhooks.mockResolvedValue(createWebhooksCollection([mockParentWebhook]));

        const result = await webhookCache.getOrCreateWebhook(mockThread);

        expect(mockThread.parent.fetchWebhooks).toHaveBeenCalledTimes(1);
        expect(WebhookClient).toHaveBeenCalledWith({
          id: mockParentWebhook.id,
          token: mockParentWebhook.token
        });
        expect(result).toBeDefined();
        
        // Should cache with thread-specific key
        expect(webhookCache.hasWebhook('thread-123')).toBe(true);
      });

      it('should throw error if thread has no parent channel', async () => {
        const mockThread = createMockChannel('thread-123', 'test-thread', true);
        mockThread.parent = null;

        await expect(webhookCache.getOrCreateWebhook(mockThread)).rejects.toThrow(
          'Cannot find parent channel for thread thread-123'
        );
      });

      it('should use cached thread webhook on subsequent calls', async () => {
        const mockThread = createMockChannel('thread-123', 'test-thread', true);
        const mockParentWebhook = createMockWebhook('parent-webhook-123');
        
        mockThread.parent.fetchWebhooks.mockResolvedValue(createWebhooksCollection());
        mockThread.parent.createWebhook.mockResolvedValue(mockParentWebhook);

        // First call
        const result1 = await webhookCache.getOrCreateWebhook(mockThread);
        
        // Second call - should use thread-specific cache
        const result2 = await webhookCache.getOrCreateWebhook(mockThread);

        expect(mockThread.parent.fetchWebhooks).toHaveBeenCalledTimes(1); // Only called once
        expect(result1.id).toBe(result2.id);
      });
    });
  });

  describe('clearWebhookCache', () => {
    it('should clear webhook for specific channel', async () => {
      const mockChannel = createMockChannel();
      const mockWebhook = createMockWebhook();
      
      mockChannel.fetchWebhooks.mockResolvedValue(createWebhooksCollection());
      mockChannel.createWebhook.mockResolvedValue(mockWebhook);

      // Create and cache a webhook
      const webhook = await webhookCache.getOrCreateWebhook(mockChannel);
      expect(webhookCache.hasWebhook(mockChannel.id)).toBe(true);

      // Clear the cache
      webhookCache.clearWebhookCache(mockChannel.id);

      expect(webhook.destroy).toHaveBeenCalled();
      expect(webhookCache.hasWebhook(mockChannel.id)).toBe(false);
    });

    it('should clear thread webhook cache', async () => {
      const mockThread = createMockChannel('thread-123', 'test-thread', true);
      const mockParentWebhook = createMockWebhook('parent-webhook-123');
      
      mockThread.parent.fetchWebhooks.mockResolvedValue(createWebhooksCollection());
      mockThread.parent.createWebhook.mockResolvedValue(mockParentWebhook);

      // Create and cache a thread webhook
      const webhook = await webhookCache.getOrCreateWebhook(mockThread);
      expect(webhookCache.hasWebhook('thread-123')).toBe(true);

      // Clear the cache
      webhookCache.clearWebhookCache('thread-123');

      expect(webhook.destroy).toHaveBeenCalled();
      expect(webhookCache.hasWebhook('thread-123')).toBe(false);
    });

    it('should handle clearing non-existent webhook gracefully', () => {
      expect(() => webhookCache.clearWebhookCache('non-existent')).not.toThrow();
      expect(logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('Cleared webhook cache')
      );
    });
  });

  describe('clearAllWebhookCaches', () => {
    it('should clear all cached webhooks', async () => {
      // Create multiple webhooks
      const channels = [
        createMockChannel('channel-1', 'channel-1'),
        createMockChannel('channel-2', 'channel-2'),
        createMockChannel('thread-1', 'thread-1', true)
      ];

      const webhooks = [];
      
      for (const channel of channels) {
        const mockWebhook = createMockWebhook(`webhook-${channel.id}`);
        
        if (channel.isThread()) {
          channel.parent.fetchWebhooks.mockResolvedValue(createWebhooksCollection());
          channel.parent.createWebhook.mockResolvedValue(mockWebhook);
        } else {
          channel.fetchWebhooks.mockResolvedValue(createWebhooksCollection());
          channel.createWebhook.mockResolvedValue(mockWebhook);
        }
        
        const webhook = await webhookCache.getOrCreateWebhook(channel);
        webhooks.push(webhook);
      }

      expect(webhookCache.getCacheSize()).toBe(4); // 2 channels + 1 thread + 1 parent

      // Clear all caches
      webhookCache.clearAllWebhookCaches();

      // Verify all webhooks were destroyed
      webhooks.forEach(webhook => {
        expect(webhook.destroy).toHaveBeenCalled();
      });

      expect(webhookCache.getCacheSize()).toBe(0);
      expect(webhookCache.getActiveWebhooks().size).toBe(0);
    });
  });

  describe('utility functions', () => {
    it('getCacheSize should return correct size', async () => {
      expect(webhookCache.getCacheSize()).toBe(0);

      const mockChannel = createMockChannel();
      mockChannel.fetchWebhooks.mockResolvedValue(createWebhooksCollection());
      mockChannel.createWebhook.mockResolvedValue(createMockWebhook());

      await webhookCache.getOrCreateWebhook(mockChannel);
      expect(webhookCache.getCacheSize()).toBe(1);
    });

    it('hasWebhook should correctly identify cached webhooks', async () => {
      const mockChannel = createMockChannel();
      mockChannel.fetchWebhooks.mockResolvedValue(createWebhooksCollection());
      mockChannel.createWebhook.mockResolvedValue(createMockWebhook());

      expect(webhookCache.hasWebhook(mockChannel.id)).toBe(false);
      
      await webhookCache.getOrCreateWebhook(mockChannel);
      
      expect(webhookCache.hasWebhook(mockChannel.id)).toBe(true);
    });

    it('getActiveWebhooks should return the active webhooks set', () => {
      const activeWebhooks = webhookCache.getActiveWebhooks();
      expect(activeWebhooks).toBeInstanceOf(Set);
      expect(activeWebhooks.size).toBe(0);
    });
  });
});