/**
 * Tests for LlmConfigCacheInvalidationService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  LlmConfigCacheInvalidationService,
  isValidLlmConfigInvalidationEvent,
} from './LlmConfigCacheInvalidationService.js';
import { REDIS_CHANNELS } from '../constants/queue.js';

// Mock logger
vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('LlmConfigCacheInvalidationService', () => {
  let mockRedis: {
    duplicate: ReturnType<typeof vi.fn>;
    publish: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    unsubscribe: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  };

  let mockSubscriber: {
    subscribe: ReturnType<typeof vi.fn>;
    unsubscribe: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSubscriber = {
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      on: vi.fn(),
    };

    mockRedis = {
      duplicate: vi.fn().mockReturnValue(mockSubscriber),
      publish: vi.fn().mockResolvedValue(1),
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      on: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('isValidLlmConfigInvalidationEvent', () => {
    it('should validate "all" event type', () => {
      expect(isValidLlmConfigInvalidationEvent({ type: 'all' })).toBe(true);
    });

    it('should validate "user" event type with discordId', () => {
      expect(isValidLlmConfigInvalidationEvent({ type: 'user', discordId: '123' })).toBe(true);
    });

    it('should validate "config" event type with configId', () => {
      expect(isValidLlmConfigInvalidationEvent({ type: 'config', configId: 'cfg-123' })).toBe(true);
    });

    it('should reject null', () => {
      expect(isValidLlmConfigInvalidationEvent(null)).toBe(false);
    });

    it('should reject non-objects', () => {
      expect(isValidLlmConfigInvalidationEvent('string')).toBe(false);
      expect(isValidLlmConfigInvalidationEvent(123)).toBe(false);
    });

    it('should reject invalid event types', () => {
      expect(isValidLlmConfigInvalidationEvent({ type: 'invalid' })).toBe(false);
    });

    it('should reject "user" event without discordId', () => {
      expect(isValidLlmConfigInvalidationEvent({ type: 'user' })).toBe(false);
    });

    it('should reject "config" event without configId', () => {
      expect(isValidLlmConfigInvalidationEvent({ type: 'config' })).toBe(false);
    });

    it('should reject "all" event with extra properties', () => {
      expect(isValidLlmConfigInvalidationEvent({ type: 'all', extra: 'data' })).toBe(false);
    });

    it('should reject "user" event with wrong discordId type', () => {
      expect(isValidLlmConfigInvalidationEvent({ type: 'user', discordId: 123 })).toBe(false);
    });
  });

  describe('publish', () => {
    it('should publish "all" event', async () => {
      const service = new LlmConfigCacheInvalidationService(mockRedis as any);

      await service.publish({ type: 'all' });

      expect(mockRedis.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.LLM_CONFIG_CACHE_INVALIDATION,
        JSON.stringify({ type: 'all' })
      );
    });

    it('should publish "user" event', async () => {
      const service = new LlmConfigCacheInvalidationService(mockRedis as any);

      await service.publish({ type: 'user', discordId: 'user-123' });

      expect(mockRedis.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.LLM_CONFIG_CACHE_INVALIDATION,
        JSON.stringify({ type: 'user', discordId: 'user-123' })
      );
    });

    it('should publish "config" event', async () => {
      const service = new LlmConfigCacheInvalidationService(mockRedis as any);

      await service.publish({ type: 'config', configId: 'cfg-123' });

      expect(mockRedis.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.LLM_CONFIG_CACHE_INVALIDATION,
        JSON.stringify({ type: 'config', configId: 'cfg-123' })
      );
    });

    it('should throw on publish error', async () => {
      mockRedis.publish.mockRejectedValue(new Error('Redis error'));
      const service = new LlmConfigCacheInvalidationService(mockRedis as any);

      await expect(service.publish({ type: 'all' })).rejects.toThrow('Redis error');
    });
  });

  describe('subscribe', () => {
    it('should create subscriber and subscribe to channel', async () => {
      const service = new LlmConfigCacheInvalidationService(mockRedis as any);
      const callback = vi.fn();

      await service.subscribe(callback);

      expect(mockRedis.duplicate).toHaveBeenCalled();
      expect(mockSubscriber.subscribe).toHaveBeenCalledWith(
        REDIS_CHANNELS.LLM_CONFIG_CACHE_INVALIDATION
      );
      expect(mockSubscriber.on).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should not create multiple subscribers', async () => {
      const service = new LlmConfigCacheInvalidationService(mockRedis as any);

      await service.subscribe(vi.fn());
      await service.subscribe(vi.fn());

      expect(mockRedis.duplicate).toHaveBeenCalledTimes(1);
    });

    it('should call callback when message received', async () => {
      const service = new LlmConfigCacheInvalidationService(mockRedis as any);
      const callback = vi.fn();

      await service.subscribe(callback);

      // Get the message handler that was registered
      const messageHandler = mockSubscriber.on.mock.calls.find(
        call => call[0] === 'message'
      )?.[1] as ((channel: string, message: string) => void) | undefined;

      expect(messageHandler).toBeDefined();

      // Simulate receiving a message
      messageHandler!(
        REDIS_CHANNELS.LLM_CONFIG_CACHE_INVALIDATION,
        JSON.stringify({ type: 'all' })
      );

      expect(callback).toHaveBeenCalledWith({ type: 'all' });
    });

    it('should ignore messages from other channels', async () => {
      const service = new LlmConfigCacheInvalidationService(mockRedis as any);
      const callback = vi.fn();

      await service.subscribe(callback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        call => call[0] === 'message'
      )?.[1] as ((channel: string, message: string) => void) | undefined;

      // Simulate receiving a message from another channel
      messageHandler!('other-channel', JSON.stringify({ type: 'all' }));

      expect(callback).not.toHaveBeenCalled();
    });

    it('should clean up on subscribe error', async () => {
      mockSubscriber.subscribe.mockRejectedValue(new Error('Subscribe error'));
      const service = new LlmConfigCacheInvalidationService(mockRedis as any);

      await expect(service.subscribe(vi.fn())).rejects.toThrow('Subscribe error');
      expect(mockSubscriber.disconnect).toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe and disconnect', async () => {
      const service = new LlmConfigCacheInvalidationService(mockRedis as any);
      await service.subscribe(vi.fn());

      await service.unsubscribe();

      expect(mockSubscriber.unsubscribe).toHaveBeenCalledWith(
        REDIS_CHANNELS.LLM_CONFIG_CACHE_INVALIDATION
      );
      expect(mockSubscriber.disconnect).toHaveBeenCalled();
    });

    it('should do nothing if not subscribed', async () => {
      const service = new LlmConfigCacheInvalidationService(mockRedis as any);

      await service.unsubscribe();

      expect(mockSubscriber.unsubscribe).not.toHaveBeenCalled();
    });
  });

  describe('helper methods', () => {
    it('invalidateUserLlmConfig should publish user event', async () => {
      const service = new LlmConfigCacheInvalidationService(mockRedis as any);

      await service.invalidateUserLlmConfig('user-123');

      expect(mockRedis.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.LLM_CONFIG_CACHE_INVALIDATION,
        JSON.stringify({ type: 'user', discordId: 'user-123' })
      );
    });

    it('invalidateConfigUsers should publish config event', async () => {
      const service = new LlmConfigCacheInvalidationService(mockRedis as any);

      await service.invalidateConfigUsers('cfg-123');

      expect(mockRedis.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.LLM_CONFIG_CACHE_INVALIDATION,
        JSON.stringify({ type: 'config', configId: 'cfg-123' })
      );
    });

    it('invalidateAll should publish all event', async () => {
      const service = new LlmConfigCacheInvalidationService(mockRedis as any);

      await service.invalidateAll();

      expect(mockRedis.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.LLM_CONFIG_CACHE_INVALIDATION,
        JSON.stringify({ type: 'all' })
      );
    });
  });
});
