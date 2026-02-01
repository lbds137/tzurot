/**
 * Tests for BaseCacheInvalidationService
 *
 * Tests the base class functionality and helper functions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BaseCacheInvalidationService,
  createStandardEventValidator,
  type StandardInvalidationEvent,
  type EventValidator,
} from './BaseCacheInvalidationService.js';

// Mock logger
vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('createStandardEventValidator', () => {
  const validator = createStandardEventValidator<StandardInvalidationEvent>();

  describe('valid events', () => {
    it('should validate "all" event type', () => {
      expect(validator({ type: 'all' })).toBe(true);
    });

    it('should validate "user" event type with discordId', () => {
      expect(validator({ type: 'user', discordId: '123456789' })).toBe(true);
    });

    it('should validate "user" event with empty discordId', () => {
      // Empty string is a valid string type
      expect(validator({ type: 'user', discordId: '' })).toBe(true);
    });
  });

  describe('invalid events', () => {
    it('should reject null', () => {
      expect(validator(null)).toBe(false);
    });

    it('should reject undefined', () => {
      expect(validator(undefined)).toBe(false);
    });

    it('should reject non-objects', () => {
      expect(validator('string')).toBe(false);
      expect(validator(123)).toBe(false);
      expect(validator(true)).toBe(false);
      expect(validator([])).toBe(false);
    });

    it('should reject unknown event types', () => {
      expect(validator({ type: 'unknown' })).toBe(false);
      expect(validator({ type: 'config' })).toBe(false);
      expect(validator({ type: 'guild' })).toBe(false);
    });

    it('should reject "user" event without discordId', () => {
      expect(validator({ type: 'user' })).toBe(false);
    });

    it('should reject "user" event with wrong discordId type', () => {
      expect(validator({ type: 'user', discordId: 123 })).toBe(false);
      expect(validator({ type: 'user', discordId: null })).toBe(false);
      expect(validator({ type: 'user', discordId: undefined })).toBe(false);
      expect(validator({ type: 'user', discordId: {} })).toBe(false);
    });

    it('should reject "all" event with extra properties', () => {
      expect(validator({ type: 'all', extra: 'field' })).toBe(false);
      expect(validator({ type: 'all', discordId: '123' })).toBe(false);
    });

    it('should reject "user" event with extra properties', () => {
      expect(validator({ type: 'user', discordId: '123', extra: 'field' })).toBe(false);
    });

    it('should reject objects without type property', () => {
      expect(validator({})).toBe(false);
      expect(validator({ discordId: '123' })).toBe(false);
    });
  });
});

describe('BaseCacheInvalidationService', () => {
  // Create a concrete implementation for testing
  class TestCacheInvalidationService extends BaseCacheInvalidationService<StandardInvalidationEvent> {
    constructor(
      redis: ReturnType<typeof createMockRedis>,
      logOptions?: {
        getLogContext?: (event: StandardInvalidationEvent) => Record<string, unknown>;
        getEventDescription?: (event: StandardInvalidationEvent) => string;
      }
    ) {
      super(
        redis as never,
        'test:channel',
        'TestCacheInvalidationService',
        createStandardEventValidator<StandardInvalidationEvent>(),
        logOptions
      );
    }
  }

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

  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockSubscriber: ReturnType<typeof createMockRedis>;
  let service: TestCacheInvalidationService;

  beforeEach(() => {
    mockSubscriber = createMockRedis();
    mockRedis = createMockRedis();
    mockRedis.duplicate.mockReturnValue(mockSubscriber);
    service = new TestCacheInvalidationService(mockRedis);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('subscribe', () => {
    it('should create a duplicate Redis connection', async () => {
      await service.subscribe(vi.fn());

      expect(mockRedis.duplicate).toHaveBeenCalledTimes(1);
    });

    it('should subscribe to the configured channel', async () => {
      await service.subscribe(vi.fn());

      expect(mockSubscriber.subscribe).toHaveBeenCalledWith('test:channel');
    });

    it('should register a message handler', async () => {
      await service.subscribe(vi.fn());

      expect(mockSubscriber.on).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should not create multiple subscribers', async () => {
      await service.subscribe(vi.fn());
      await service.subscribe(vi.fn());
      await service.subscribe(vi.fn());

      expect(mockRedis.duplicate).toHaveBeenCalledTimes(1);
    });

    it('should register multiple callbacks', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      await service.subscribe(callback1);
      await service.subscribe(callback2);
      await service.subscribe(callback3);

      // Get message handler and trigger it
      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      messageHandler('test:channel', JSON.stringify({ type: 'all' }));

      expect(callback1).toHaveBeenCalledWith({ type: 'all' });
      expect(callback2).toHaveBeenCalledWith({ type: 'all' });
      expect(callback3).toHaveBeenCalledWith({ type: 'all' });
    });

    it('should clean up on subscribe error', async () => {
      mockSubscriber.subscribe.mockRejectedValue(new Error('Connection failed'));

      await expect(service.subscribe(vi.fn())).rejects.toThrow('Connection failed');
      expect(mockSubscriber.disconnect).toHaveBeenCalled();
    });

    it('should allow subscribing after failed subscribe', async () => {
      mockSubscriber.subscribe.mockRejectedValueOnce(new Error('Temporary error'));
      mockSubscriber.subscribe.mockResolvedValueOnce(undefined);

      await expect(service.subscribe(vi.fn())).rejects.toThrow('Temporary error');

      // Reset the mock subscriber for retry
      mockRedis.duplicate.mockReturnValue(mockSubscriber);

      await service.subscribe(vi.fn());
      expect(service.isSubscribed()).toBe(true);
    });
  });

  describe('publish', () => {
    it('should publish event as JSON to the channel', async () => {
      await service.publish({ type: 'user', discordId: '123' });

      expect(mockRedis.publish).toHaveBeenCalledWith(
        'test:channel',
        JSON.stringify({ type: 'user', discordId: '123' })
      );
    });

    it('should throw on publish error', async () => {
      mockRedis.publish.mockRejectedValue(new Error('Publish failed'));

      await expect(service.publish({ type: 'all' })).rejects.toThrow('Publish failed');
    });
  });

  describe('message handling', () => {
    it('should parse and validate incoming messages', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      messageHandler('test:channel', JSON.stringify({ type: 'user', discordId: '456' }));

      expect(callback).toHaveBeenCalledWith({ type: 'user', discordId: '456' });
    });

    it('should ignore messages from other channels', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      messageHandler('other:channel', JSON.stringify({ type: 'all' }));

      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle invalid JSON gracefully', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      // Should not throw
      messageHandler('test:channel', 'not json');
      expect(callback).not.toHaveBeenCalled();
    });

    it('should reject invalid event structures', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      messageHandler('test:channel', JSON.stringify({ type: 'invalid' }));
      expect(callback).not.toHaveBeenCalled();

      messageHandler('test:channel', JSON.stringify({ foo: 'bar' }));
      expect(callback).not.toHaveBeenCalled();
    });

    it('should continue calling callbacks after one throws', async () => {
      const errorCallback = vi.fn().mockImplementation(() => {
        throw new Error('Callback error');
      });
      const normalCallback = vi.fn();

      await service.subscribe(errorCallback);
      await service.subscribe(normalCallback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      messageHandler('test:channel', JSON.stringify({ type: 'all' }));

      expect(errorCallback).toHaveBeenCalled();
      expect(normalCallback).toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe from channel', async () => {
      await service.subscribe(vi.fn());
      await service.unsubscribe();

      expect(mockSubscriber.unsubscribe).toHaveBeenCalledWith('test:channel');
    });

    it('should disconnect subscriber', async () => {
      await service.subscribe(vi.fn());
      await service.unsubscribe();

      expect(mockSubscriber.disconnect).toHaveBeenCalled();
    });

    it('should clear callbacks', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);
      await service.unsubscribe();

      // Resubscribe and trigger event
      mockRedis.duplicate.mockReturnValue(mockSubscriber);
      await service.subscribe(vi.fn());

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      messageHandler('test:channel', JSON.stringify({ type: 'all' }));

      // Original callback should not be called
      expect(callback).not.toHaveBeenCalled();
    });

    it('should do nothing if not subscribed', async () => {
      await service.unsubscribe();

      expect(mockSubscriber.unsubscribe).not.toHaveBeenCalled();
      expect(mockSubscriber.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('isSubscribed', () => {
    it('should return false initially', () => {
      expect(service.isSubscribed()).toBe(false);
    });

    it('should return true after subscribe', async () => {
      await service.subscribe(vi.fn());
      expect(service.isSubscribed()).toBe(true);
    });

    it('should return false after unsubscribe', async () => {
      await service.subscribe(vi.fn());
      await service.unsubscribe();
      expect(service.isSubscribed()).toBe(false);
    });
  });

  describe('logging options', () => {
    it('should use custom log context and description', async () => {
      const serviceWithOptions = new TestCacheInvalidationService(mockRedis, {
        getLogContext: event => (event.type === 'user' ? { userId: event.discordId } : {}),
        getEventDescription: event => (event.type === 'all' ? 'ALL' : `user ${event.discordId}`),
      });

      // Just verify it doesn't throw - actual logging is mocked
      await serviceWithOptions.publish({ type: 'user', discordId: '123' });
      expect(mockRedis.publish).toHaveBeenCalled();
    });
  });

  describe('custom event types', () => {
    // Test with a custom event type beyond standard user/all
    type CustomEvent =
      | { type: 'user'; discordId: string }
      | { type: 'guild'; guildId: string }
      | { type: 'all' };

    const customValidator: EventValidator<CustomEvent> = (obj): obj is CustomEvent => {
      if (typeof obj !== 'object' || obj === null) return false;
      const event = obj as Record<string, unknown>;
      if (event.type === 'all') return Object.keys(event).length === 1;
      if (event.type === 'user') {
        return typeof event.discordId === 'string' && Object.keys(event).length === 2;
      }
      if (event.type === 'guild') {
        return typeof event.guildId === 'string' && Object.keys(event).length === 2;
      }
      return false;
    };

    class CustomCacheInvalidationService extends BaseCacheInvalidationService<CustomEvent> {
      constructor(redis: ReturnType<typeof createMockRedis>) {
        super(redis as never, 'custom:channel', 'CustomCacheInvalidationService', customValidator);
      }
    }

    it('should support custom event types', async () => {
      const customService = new CustomCacheInvalidationService(mockRedis);
      const callback = vi.fn();
      await customService.subscribe(callback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      // Test guild event type
      messageHandler('custom:channel', JSON.stringify({ type: 'guild', guildId: 'guild-123' }));
      expect(callback).toHaveBeenCalledWith({ type: 'guild', guildId: 'guild-123' });
    });

    it('should reject invalid custom events', async () => {
      const customService = new CustomCacheInvalidationService(mockRedis);
      const callback = vi.fn();
      await customService.subscribe(callback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      // Invalid event type
      messageHandler('custom:channel', JSON.stringify({ type: 'channel', channelId: '123' }));
      expect(callback).not.toHaveBeenCalled();
    });
  });
});
