/**
 * Tests for ChannelActivationCacheInvalidationService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ChannelActivationCacheInvalidationService,
  isValidChannelActivationInvalidationEvent,
  type ChannelActivationInvalidationEvent,
} from './ChannelActivationCacheInvalidationService.js';
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

  describe('isValidChannelActivationInvalidationEvent', () => {
    it('should validate channel invalidation event', () => {
      expect(
        isValidChannelActivationInvalidationEvent({ type: 'channel', channelId: '123456' })
      ).toBe(true);
    });

    it('should validate all invalidation event', () => {
      expect(isValidChannelActivationInvalidationEvent({ type: 'all' })).toBe(true);
    });

    it('should reject null', () => {
      expect(isValidChannelActivationInvalidationEvent(null)).toBe(false);
    });

    it('should reject undefined', () => {
      expect(isValidChannelActivationInvalidationEvent(undefined)).toBe(false);
    });

    it('should reject non-objects', () => {
      expect(isValidChannelActivationInvalidationEvent('string')).toBe(false);
      expect(isValidChannelActivationInvalidationEvent(123)).toBe(false);
    });

    it('should reject invalid event types', () => {
      expect(isValidChannelActivationInvalidationEvent({ type: 'unknown' })).toBe(false);
    });

    it('should reject channel event without channelId', () => {
      expect(isValidChannelActivationInvalidationEvent({ type: 'channel' })).toBe(false);
    });

    it('should reject channel event with wrong channelId type', () => {
      expect(isValidChannelActivationInvalidationEvent({ type: 'channel', channelId: 123 })).toBe(
        false
      );
    });

    it('should reject all event with extra properties', () => {
      expect(isValidChannelActivationInvalidationEvent({ type: 'all', extra: 'field' })).toBe(
        false
      );
    });

    it('should reject channel event with extra properties', () => {
      expect(
        isValidChannelActivationInvalidationEvent({
          type: 'channel',
          channelId: '123',
          extra: 'field',
        })
      ).toBe(false);
    });
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
});
