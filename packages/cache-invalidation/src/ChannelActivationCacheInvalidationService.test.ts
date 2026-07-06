/**
 * Tests for ChannelActivationCacheInvalidationService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Redis } from 'ioredis';
import {
  ChannelActivationCacheInvalidationService,
  type ChannelActivationInvalidationEvent,
} from './ChannelActivationCacheInvalidationService.js';
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
describe('ChannelActivationCacheInvalidationService', () => {
  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockSubscriber: ReturnType<typeof createMockRedis>;
  let service: ChannelActivationCacheInvalidationService;

  function createMockRedis() {
    return {
      duplicate: vi.fn(),
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn().mockResolvedValue(1),
      disconnect: vi.fn(),
      on: vi.fn(),
    };
  }

  beforeEach(() => {
    mockSubscriber = createMockRedis();
    mockRedis = createMockRedis();
    mockRedis.duplicate.mockReturnValue(mockSubscriber);
    service = new ChannelActivationCacheInvalidationService(mockRedis as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('subscribe', () => {
    it('should create a duplicate connection for subscribing', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);

      expect(mockRedis.duplicate).toHaveBeenCalled();
      expect(mockSubscriber.subscribe).toHaveBeenCalledWith(
        REDIS_CHANNELS.CHANNEL_ACTIVATION_CACHE_INVALIDATION
      );
    });

    it('should register message handler', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);

      expect(mockSubscriber.on).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should call callback when valid channel event is received', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);

      // Get the message handler that was registered
      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      const event: ChannelActivationInvalidationEvent = { type: 'channel', channelId: '123456789' };
      messageHandler(REDIS_CHANNELS.CHANNEL_ACTIVATION_CACHE_INVALIDATION, JSON.stringify(event));

      expect(callback).toHaveBeenCalledWith(event);
    });

    it('should call callback when valid all event is received', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      const event: ChannelActivationInvalidationEvent = { type: 'all' };
      messageHandler(REDIS_CHANNELS.CHANNEL_ACTIVATION_CACHE_INVALIDATION, JSON.stringify(event));

      expect(callback).toHaveBeenCalledWith(event);
    });

    it('should not call callback for messages on other channels', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      messageHandler('other-channel', JSON.stringify({ type: 'all' }));

      expect(callback).not.toHaveBeenCalled();
    });

    it('should not call callback for invalid JSON', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      messageHandler(REDIS_CHANNELS.CHANNEL_ACTIVATION_CACHE_INVALIDATION, 'not valid json');

      expect(callback).not.toHaveBeenCalled();
    });

    it('should not call callback for invalid event structure', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      messageHandler(
        REDIS_CHANNELS.CHANNEL_ACTIVATION_CACHE_INVALIDATION,
        JSON.stringify({ type: 'invalid' })
      );

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('invalidateChannel', () => {
    it('should publish channel invalidation event', async () => {
      await service.invalidateChannel('123456789');

      expect(mockRedis.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.CHANNEL_ACTIVATION_CACHE_INVALIDATION,
        JSON.stringify({ type: 'channel', channelId: '123456789' })
      );
    });
  });

  describe('invalidateAll', () => {
    it('should publish all invalidation event', async () => {
      await service.invalidateAll();

      expect(mockRedis.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.CHANNEL_ACTIVATION_CACHE_INVALIDATION,
        JSON.stringify({ type: 'all' })
      );
    });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe and disconnect when subscribed', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);
      await service.unsubscribe();

      expect(mockSubscriber.unsubscribe).toHaveBeenCalledWith(
        REDIS_CHANNELS.CHANNEL_ACTIVATION_CACHE_INVALIDATION
      );
      expect(mockSubscriber.disconnect).toHaveBeenCalled();
    });

    it('should do nothing when not subscribed', async () => {
      await service.unsubscribe();

      expect(mockSubscriber.unsubscribe).not.toHaveBeenCalled();
      expect(mockSubscriber.disconnect).not.toHaveBeenCalled();
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
      const dispatchService = new ChannelActivationCacheInvalidationService(redisForDispatch);
      const callback = vi.fn();
      await dispatchService.subscribe(callback);
      return {
        deliver: (
          raw: string,
          channel: string = REDIS_CHANNELS.CHANNEL_ACTIVATION_CACHE_INVALIDATION
        ): void => {
          onMessage?.(channel, raw);
        },
        callback,
      };
    }

    it.each([
      ['channel', { type: 'channel', channelId: 'chan-1' }],
      ['all', { type: 'all' }],
    ])('delivers a valid %s event to the callback', async (_name, event) => {
      const { deliver, callback } = await makeSubscribed();
      deliver(JSON.stringify(event));
      expect(callback).toHaveBeenCalledWith(event);
    });

    it.each([
      ['a channel event missing channelId', JSON.stringify({ type: 'channel' })],
      ['an unknown event type', JSON.stringify({ type: 'guild' })],
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
