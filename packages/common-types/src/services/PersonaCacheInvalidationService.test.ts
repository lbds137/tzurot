/**
 * Tests for PersonaCacheInvalidationService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PersonaCacheInvalidationService,
  isValidPersonaInvalidationEvent,
  type PersonaInvalidationEvent,
} from './PersonaCacheInvalidationService.js';
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

describe('PersonaCacheInvalidationService', () => {
  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockSubscriber: ReturnType<typeof createMockRedis>;
  let service: PersonaCacheInvalidationService;

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
    service = new PersonaCacheInvalidationService(mockRedis as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('isValidPersonaInvalidationEvent', () => {
    it('should validate user invalidation event', () => {
      expect(isValidPersonaInvalidationEvent({ type: 'user', discordId: '123456' })).toBe(true);
    });

    it('should validate all invalidation event', () => {
      expect(isValidPersonaInvalidationEvent({ type: 'all' })).toBe(true);
    });

    it('should reject null', () => {
      expect(isValidPersonaInvalidationEvent(null)).toBe(false);
    });

    it('should reject undefined', () => {
      expect(isValidPersonaInvalidationEvent(undefined)).toBe(false);
    });

    it('should reject non-objects', () => {
      expect(isValidPersonaInvalidationEvent('string')).toBe(false);
      expect(isValidPersonaInvalidationEvent(123)).toBe(false);
    });

    it('should reject invalid event types', () => {
      expect(isValidPersonaInvalidationEvent({ type: 'unknown' })).toBe(false);
    });

    it('should reject user event without discordId', () => {
      expect(isValidPersonaInvalidationEvent({ type: 'user' })).toBe(false);
    });

    it('should reject user event with wrong discordId type', () => {
      expect(isValidPersonaInvalidationEvent({ type: 'user', discordId: 123 })).toBe(false);
    });

    it('should reject all event with extra properties', () => {
      expect(isValidPersonaInvalidationEvent({ type: 'all', extra: 'field' })).toBe(false);
    });

    it('should reject user event with extra properties', () => {
      expect(
        isValidPersonaInvalidationEvent({ type: 'user', discordId: '123', extra: 'field' })
      ).toBe(false);
    });
  });

  describe('subscribe', () => {
    it('should create a duplicate connection for subscribing', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);

      expect(mockRedis.duplicate).toHaveBeenCalled();
      expect(mockSubscriber.subscribe).toHaveBeenCalledWith(
        REDIS_CHANNELS.PERSONA_CACHE_INVALIDATION
      );
    });

    it('should register message handler', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);

      expect(mockSubscriber.on).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should not create duplicate subscriber on multiple calls', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      await service.subscribe(callback1);
      await service.subscribe(callback2);

      expect(mockRedis.duplicate).toHaveBeenCalledTimes(1);
    });

    it('should clean up on subscribe failure', async () => {
      mockSubscriber.subscribe.mockRejectedValue(new Error('Subscribe failed'));

      const callback = vi.fn();
      await expect(service.subscribe(callback)).rejects.toThrow('Subscribe failed');
      expect(mockSubscriber.disconnect).toHaveBeenCalled();
    });
  });

  describe('publish', () => {
    it('should publish user invalidation event', async () => {
      const event: PersonaInvalidationEvent = { type: 'user', discordId: '123456' };
      await service.publish(event);

      expect(mockRedis.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.PERSONA_CACHE_INVALIDATION,
        JSON.stringify(event)
      );
    });

    it('should publish all invalidation event', async () => {
      const event: PersonaInvalidationEvent = { type: 'all' };
      await service.publish(event);

      expect(mockRedis.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.PERSONA_CACHE_INVALIDATION,
        JSON.stringify(event)
      );
    });

    it('should throw on publish failure', async () => {
      mockRedis.publish.mockRejectedValue(new Error('Publish failed'));

      await expect(service.publish({ type: 'all' })).rejects.toThrow('Publish failed');
    });
  });

  describe('message handling', () => {
    it('should call callbacks on valid user event', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);

      // Get the message handler
      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      // Simulate receiving a message
      const event: PersonaInvalidationEvent = { type: 'user', discordId: '123456' };
      messageHandler(REDIS_CHANNELS.PERSONA_CACHE_INVALIDATION, JSON.stringify(event));

      expect(callback).toHaveBeenCalledWith(event);
    });

    it('should call callbacks on valid all event', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      const event: PersonaInvalidationEvent = { type: 'all' };
      messageHandler(REDIS_CHANNELS.PERSONA_CACHE_INVALIDATION, JSON.stringify(event));

      expect(callback).toHaveBeenCalledWith(event);
    });

    it('should ignore messages from other channels', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      messageHandler('other-channel', JSON.stringify({ type: 'all' }));

      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle invalid JSON gracefully', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      // Should not throw
      messageHandler(REDIS_CHANNELS.PERSONA_CACHE_INVALIDATION, 'not valid json');
      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle invalid event structure gracefully', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      // Should not throw
      messageHandler(
        REDIS_CHANNELS.PERSONA_CACHE_INVALIDATION,
        JSON.stringify({ type: 'invalid' })
      );
      expect(callback).not.toHaveBeenCalled();
    });

    it('should catch callback errors and continue calling other callbacks', async () => {
      const errorCallback = vi.fn().mockImplementation(() => {
        throw new Error('Callback error');
      });
      const goodCallback = vi.fn();

      await service.subscribe(errorCallback);
      await service.subscribe(goodCallback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      const event: PersonaInvalidationEvent = { type: 'all' };

      // Should not throw, and second callback should still be called
      messageHandler(REDIS_CHANNELS.PERSONA_CACHE_INVALIDATION, JSON.stringify(event));

      expect(errorCallback).toHaveBeenCalled();
      expect(goodCallback).toHaveBeenCalledWith(event);
    });
  });

  describe('unsubscribe', () => {
    it('should clean up subscriber connection', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);
      await service.unsubscribe();

      expect(mockSubscriber.unsubscribe).toHaveBeenCalledWith(
        REDIS_CHANNELS.PERSONA_CACHE_INVALIDATION
      );
      expect(mockSubscriber.disconnect).toHaveBeenCalled();
    });

    it('should handle unsubscribe when not subscribed', async () => {
      // Should not throw
      await service.unsubscribe();
      expect(mockSubscriber.unsubscribe).not.toHaveBeenCalled();
    });
  });

  describe('isSubscribed', () => {
    it('should return false when not subscribed', () => {
      expect(service.isSubscribed()).toBe(false);
    });

    it('should return true when subscribed', async () => {
      await service.subscribe(vi.fn());
      expect(service.isSubscribed()).toBe(true);
    });

    it('should return false after unsubscribe', async () => {
      await service.subscribe(vi.fn());
      await service.unsubscribe();
      expect(service.isSubscribed()).toBe(false);
    });
  });

  describe('helper methods', () => {
    it('invalidateUserPersona should publish user event', async () => {
      await service.invalidateUserPersona('123456');

      expect(mockRedis.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.PERSONA_CACHE_INVALIDATION,
        JSON.stringify({ type: 'user', discordId: '123456' })
      );
    });

    it('invalidateAll should publish all event', async () => {
      await service.invalidateAll();

      expect(mockRedis.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.PERSONA_CACHE_INVALIDATION,
        JSON.stringify({ type: 'all' })
      );
    });
  });
});
