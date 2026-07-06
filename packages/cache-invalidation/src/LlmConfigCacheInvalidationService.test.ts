/**
 * Tests for LlmConfigCacheInvalidationService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LlmConfigCacheInvalidationService } from './LlmConfigCacheInvalidationService.js';
import type { Redis } from 'ioredis';
import { REDIS_CHANNELS } from '@tzurot/common-types/constants/queue';

// Mock logger
vi.mock('@tzurot/common-types/utils/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/utils/logger')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});
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

  describe('subscribe dispatch (wire-contract validation)', () => {
    async function makeSubscribed(): Promise<{
      deliver: (raw: string, channel?: string) => void;
      callback: ReturnType<typeof vi.fn>;
    }> {
      let onMessage: ((channel: string, message: string) => void) | undefined;
      const subscriber = {
        subscribe: vi.fn().mockResolvedValue(undefined),
        unsubscribe: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
        on: vi.fn((event: string, cb: (channel: string, message: string) => void) => {
          if (event === 'message') {
            onMessage = cb;
          }
        }),
      };
      const redisForDispatch = {
        duplicate: vi.fn().mockReturnValue(subscriber),
        publish: vi.fn().mockResolvedValue(1),
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        disconnect: vi.fn(),
        on: vi.fn(),
      } as unknown as Redis;
      const dispatchService = new LlmConfigCacheInvalidationService(redisForDispatch);
      const callback = vi.fn();
      await dispatchService.subscribe(callback);
      return {
        deliver: (
          raw: string,
          channel: string = REDIS_CHANNELS.LLM_CONFIG_CACHE_INVALIDATION
        ): void => {
          onMessage?.(channel, raw);
        },
        callback,
      };
    }

    it.each([
      ['user', { type: 'user', discordId: 'discord-1' }],
      ['config', { type: 'config', configId: 'cfg-1' }],
      ['all', { type: 'all' }],
    ])('delivers a valid %s event to the callback', async (_name, event) => {
      const { deliver, callback } = await makeSubscribed();
      deliver(JSON.stringify(event));
      expect(callback).toHaveBeenCalledWith(event);
    });

    it.each([
      ['a user event missing discordId', JSON.stringify({ type: 'user' })],
      ['a config event with a numeric configId', JSON.stringify({ type: 'config', configId: 7 })],
      ['an unknown event type', JSON.stringify({ type: 'everything' })],
      ['malformed JSON', '{not json'],
    ])('rejects %s without invoking the callback', async (_name, raw) => {
      const { deliver, callback } = await makeSubscribed();
      deliver(raw);
      expect(callback).not.toHaveBeenCalled();
    });

    it('ignores messages arriving on a different channel', async () => {
      const { deliver, callback } = await makeSubscribed();
      deliver(JSON.stringify({ type: 'all' }), 'unrelated:channel');
      expect(callback).not.toHaveBeenCalled();
    });
  });
});
