/**
 * CacheInvalidationService Unit Tests
 * Tests Redis pub/sub cache invalidation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CacheInvalidationService,
  isValidInvalidationEvent,
  type PersonalityCacheTarget,
} from './CacheInvalidationService.js';
import { REDIS_CHANNELS } from '@tzurot/common-types/constants/queue';
import type { Redis } from 'ioredis';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@tzurot/common-types/utils/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/utils/logger')>();
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

describe('CacheInvalidationService', () => {
  let mockRedis: Redis;
  let mockSubscriber: Redis;
  let mockPersonalityService: PersonalityCacheTarget;
  let service: CacheInvalidationService;
  let messageHandlers: Map<string, (channel: string, message: string) => void>;

  beforeEach(() => {
    messageHandlers = new Map();

    // Mock Redis subscriber
    mockSubscriber = {
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      on: vi.fn((event: string, handler: (channel: string, message: string) => void) => {
        if (event === 'message') {
          messageHandlers.set('message', handler);
        }
        return mockSubscriber;
      }),
    } as unknown as Redis;

    // Mock Redis client
    mockRedis = {
      duplicate: vi.fn().mockReturnValue(mockSubscriber),
      publish: vi.fn().mockResolvedValue(1), // Returns number of subscribers
      // Present so the "never enters subscriber mode" test below asserts rather
      // than crashes: without it, a regression to this.redis.subscribe() would
      // fail as a TypeError on an undefined method instead of as a clear
      // expectation failure.
      subscribe: vi.fn().mockResolvedValue(undefined),
    } as unknown as Redis;

    // Stub the personality cache target — the service depends only on the
    // PersonalityCacheTarget interface, not the concrete PersonalityService
    // (which now lives in @tzurot/identity).
    mockPersonalityService = {
      invalidatePersonality: vi.fn(),
      invalidateAll: vi.fn(),
    };

    service = new CacheInvalidationService(mockRedis, mockPersonalityService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The message-handler path wraps guard evaluation in a try/catch that logs
  // and swallows any TypeError the guard itself might throw — so a mutant
  // that breaks the guard's null/branch handling still passes through that
  // handler undetected. Assert the guard directly instead.
  describe('isValidInvalidationEvent', () => {
    it('rejects null without throwing', () => {
      expect(isValidInvalidationEvent(null)).toBe(false);
    });

    it('rejects an unknown event type that otherwise looks like a personality event', () => {
      expect(isValidInvalidationEvent({ type: 'unknown', personalityId: 'p-1' })).toBe(false);
    });

    it('accepts a well-formed all event', () => {
      expect(isValidInvalidationEvent({ type: 'all' })).toBe(true);
    });

    it('accepts a well-formed personality event', () => {
      expect(isValidInvalidationEvent({ type: 'personality', personalityId: 'p-1' })).toBe(true);
    });

    it('rejects a callable whose own properties look like a valid event', () => {
      // typeof a function is 'function', not 'object' — the guard rejects it on
      // the typeof arm alone, which the null check cannot cover.
      const callable = Object.assign(() => undefined, { type: 'all' });

      expect(isValidInvalidationEvent(callable)).toBe(false);
    });
  });

  describe('subscribe', () => {
    it('should create duplicate Redis connection and subscribe to channel', async () => {
      await service.subscribe();

      expect(mockRedis.duplicate).toHaveBeenCalledTimes(1);
      expect(mockSubscriber.subscribe).toHaveBeenCalledWith(REDIS_CHANNELS.CACHE_INVALIDATION);
      expect(mockSubscriber.on).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should never put the shared client into subscriber mode', async () => {
      await service.subscribe();

      // Load-bearing for the caller, not just tidy: api-gateway hands this same
      // client to the dedup cache and rate limiters and configures it with a
      // commandTimeout. A connection in subscriber mode accepts only pub/sub
      // commands, so subscribing HERE instead of on the duplicate would break
      // every other consumer of the shared client.
      expect(mockRedis.subscribe).not.toHaveBeenCalled();
      expect(mockSubscriber.subscribe).toHaveBeenCalled();
    });

    it('should handle subscription errors', async () => {
      vi.mocked(mockSubscriber.subscribe).mockRejectedValue(new Error('Connection failed'));

      await expect(service.subscribe()).rejects.toThrow('Connection failed');
    });

    it('should clean up subscriber on subscription error', async () => {
      vi.mocked(mockSubscriber.subscribe).mockRejectedValue(new Error('Connection failed'));

      await expect(service.subscribe()).rejects.toThrow('Connection failed');

      // Verify that the subscriber connection was cleaned up
      expect(mockSubscriber.disconnect).toHaveBeenCalledTimes(1);
    });

    it('should prevent resource leak from double-subscribe', async () => {
      // First subscribe
      await service.subscribe();
      expect(mockRedis.duplicate).toHaveBeenCalledTimes(1);

      // Second subscribe should be ignored
      await service.subscribe();
      expect(mockRedis.duplicate).toHaveBeenCalledTimes(1); // Still 1, not 2
    });

    it('propagates the original error when creating the duplicate connection fails', async () => {
      vi.mocked(mockRedis.duplicate).mockImplementation(() => {
        throw new Error('Duplicate failed');
      });

      // The cleanup guard must not run when no subscriber was ever assigned —
      // dereferencing the null subscriber would mask this error with a TypeError.
      await expect(service.subscribe()).rejects.toThrow('Duplicate failed');
    });
  });

  describe('publish', () => {
    it('should publish personality invalidation event', async () => {
      const event = { type: 'personality' as const, personalityId: 'test-id' };

      await service.publish(event);

      expect(mockRedis.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.CACHE_INVALIDATION,
        JSON.stringify(event)
      );
    });

    it('should publish all invalidation event', async () => {
      const event = { type: 'all' as const };

      await service.publish(event);

      expect(mockRedis.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.CACHE_INVALIDATION,
        JSON.stringify(event)
      );
    });

    it('should handle publish errors', async () => {
      vi.mocked(mockRedis.publish).mockRejectedValue(new Error('Publish failed'));

      const event = { type: 'all' as const };
      await expect(service.publish(event)).rejects.toThrow('Publish failed');
    });

    it('logs the ALL-personalities publish without a per-personality context object', async () => {
      mockLogger.info.mockClear();

      await service.publish({ type: 'all' });

      expect(mockLogger.info).toHaveBeenCalledTimes(1);
      // The 'all' arm logs a bare message; the personality arm prepends a context object.
      expect(mockLogger.info.mock.calls[0]).toHaveLength(1);
    });

    it('logs the personality publish with the personalityId context object', async () => {
      mockLogger.info.mockClear();

      await service.publish({ type: 'personality', personalityId: 'p-1' });

      expect(mockLogger.info).toHaveBeenCalledWith({ personalityId: 'p-1' }, expect.any(String));
    });
  });

  describe('message handling', () => {
    beforeEach(async () => {
      await service.subscribe();
    });

    it('should invalidate specific personality when receiving personality event', () => {
      const event = { type: 'personality' as const, personalityId: 'test-id' };
      const message = JSON.stringify(event);

      // Simulate receiving message
      const handler = messageHandlers.get('message');
      expect(handler).toBeDefined();
      handler!(REDIS_CHANNELS.CACHE_INVALIDATION, message);

      expect(mockPersonalityService.invalidatePersonality).toHaveBeenCalledWith('test-id');
      expect(mockPersonalityService.invalidateAll).not.toHaveBeenCalled();
    });

    it('should invalidate all personalities when receiving all event', () => {
      const event = { type: 'all' as const };
      const message = JSON.stringify(event);

      // Simulate receiving message
      const handler = messageHandlers.get('message');
      expect(handler).toBeDefined();
      handler!(REDIS_CHANNELS.CACHE_INVALIDATION, message);

      expect(mockPersonalityService.invalidateAll).toHaveBeenCalledTimes(1);
      expect(mockPersonalityService.invalidatePersonality).not.toHaveBeenCalled();
    });

    it('should ignore messages from other channels', () => {
      const event = { type: 'all' as const };
      const message = JSON.stringify(event);

      // Simulate receiving message from wrong channel
      const handler = messageHandlers.get('message');
      expect(handler).toBeDefined();
      handler!('other-channel', message);

      expect(mockPersonalityService.invalidateAll).not.toHaveBeenCalled();
      expect(mockPersonalityService.invalidatePersonality).not.toHaveBeenCalled();
    });

    it('should handle malformed JSON gracefully', () => {
      const malformedMessage = 'not-valid-json';

      // Should not throw error
      const handler = messageHandlers.get('message');
      expect(handler).toBeDefined();
      expect(() => {
        handler!(REDIS_CHANNELS.CACHE_INVALIDATION, malformedMessage);
      }).not.toThrow();

      expect(mockPersonalityService.invalidateAll).not.toHaveBeenCalled();
      expect(mockPersonalityService.invalidatePersonality).not.toHaveBeenCalled();
    });

    it('logs a parse failure when the message is not valid JSON', () => {
      mockLogger.error.mockClear();
      const handler = messageHandlers.get('message');
      expect(handler).toBeDefined();

      handler!(REDIS_CHANNELS.CACHE_INVALIDATION, 'not-valid-json');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(SyntaxError) }),
        expect.any(String)
      );
    });

    it('should reject an all event carrying extra keys (strict key count)', () => {
      const handler = messageHandlers.get('message');
      expect(handler).toBeDefined();
      handler!(REDIS_CHANNELS.CACHE_INVALIDATION, JSON.stringify({ type: 'all', extra: true }));

      expect(mockPersonalityService.invalidateAll).not.toHaveBeenCalled();
    });

    it('should reject a personality event carrying extra keys (strict key count)', () => {
      const handler = messageHandlers.get('message');
      expect(handler).toBeDefined();
      handler!(
        REDIS_CHANNELS.CACHE_INVALIDATION,
        JSON.stringify({ type: 'personality', personalityId: 'p-1', extra: true })
      );

      expect(mockPersonalityService.invalidatePersonality).not.toHaveBeenCalled();
    });

    it('should reject invalid event type', () => {
      const invalidEvent = { type: 'invalid' };
      const message = JSON.stringify(invalidEvent);

      const handler = messageHandlers.get('message');
      expect(handler).toBeDefined();
      handler!(REDIS_CHANNELS.CACHE_INVALIDATION, message);

      expect(mockPersonalityService.invalidateAll).not.toHaveBeenCalled();
      expect(mockPersonalityService.invalidatePersonality).not.toHaveBeenCalled();
    });

    it('should reject personality event missing personalityId', () => {
      const invalidEvent = { type: 'personality' };
      const message = JSON.stringify(invalidEvent);

      const handler = messageHandlers.get('message');
      expect(handler).toBeDefined();
      handler!(REDIS_CHANNELS.CACHE_INVALIDATION, message);

      expect(mockPersonalityService.invalidateAll).not.toHaveBeenCalled();
      expect(mockPersonalityService.invalidatePersonality).not.toHaveBeenCalled();
    });

    it('should reject personality event with non-string personalityId', () => {
      const invalidEvent = { type: 'personality', personalityId: 123 };
      const message = JSON.stringify(invalidEvent);

      const handler = messageHandlers.get('message');
      expect(handler).toBeDefined();
      handler!(REDIS_CHANNELS.CACHE_INVALIDATION, message);

      expect(mockPersonalityService.invalidateAll).not.toHaveBeenCalled();
      expect(mockPersonalityService.invalidatePersonality).not.toHaveBeenCalled();
    });

    it('should reject events with extra properties', () => {
      const invalidEvent = { type: 'all', extraProp: 'unexpected' };
      const message = JSON.stringify(invalidEvent);

      const handler = messageHandlers.get('message');
      expect(handler).toBeDefined();
      handler!(REDIS_CHANNELS.CACHE_INVALIDATION, message);

      expect(mockPersonalityService.invalidateAll).not.toHaveBeenCalled();
      expect(mockPersonalityService.invalidatePersonality).not.toHaveBeenCalled();
    });

    it('should reject non-object events', () => {
      const invalidEvents = ['null', '"string"', '123', 'true', '[]'];

      const handler = messageHandlers.get('message');
      expect(handler).toBeDefined();

      for (const invalidMessage of invalidEvents) {
        handler!(REDIS_CHANNELS.CACHE_INVALIDATION, invalidMessage);
      }

      expect(mockPersonalityService.invalidateAll).not.toHaveBeenCalled();
      expect(mockPersonalityService.invalidatePersonality).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe and disconnect when subscriber exists', async () => {
      await service.subscribe();
      await service.unsubscribe();

      expect(mockSubscriber.unsubscribe).toHaveBeenCalledWith(REDIS_CHANNELS.CACHE_INVALIDATION);
      expect(mockSubscriber.disconnect).toHaveBeenCalledTimes(1);
    });

    it('should handle unsubscribe when not subscribed', async () => {
      // Should not throw error
      await expect(service.unsubscribe()).resolves.not.toThrow();
    });
  });

  describe('helper methods', () => {
    it('should call publish with correct event for invalidatePersonality', async () => {
      const publishSpy = vi.spyOn(service, 'publish');

      await service.invalidatePersonality('test-id');

      expect(publishSpy).toHaveBeenCalledWith({
        type: 'personality',
        personalityId: 'test-id',
      });
    });

    it('should call publish with correct event for invalidateAll', async () => {
      const publishSpy = vi.spyOn(service, 'publish');

      await service.invalidateAll();

      expect(publishSpy).toHaveBeenCalledWith({ type: 'all' });
    });
  });

  describe('end-to-end invalidation flow', () => {
    it('should propagate invalidation across services', async () => {
      // Service 1 subscribes
      await service.subscribe();

      // Service 2 (simulated) publishes invalidation
      const event = { type: 'all' as const };
      await service.publish(event);

      // Simulate receiving the published message
      const handler = messageHandlers.get('message');
      handler!(REDIS_CHANNELS.CACHE_INVALIDATION, JSON.stringify(event));

      // Verify invalidation was called
      expect(mockPersonalityService.invalidateAll).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple concurrent invalidations', async () => {
      await service.subscribe();

      // Simulate multiple rapid invalidations
      const events = [
        { type: 'personality' as const, personalityId: 'id1' },
        { type: 'personality' as const, personalityId: 'id2' },
        { type: 'all' as const },
        { type: 'personality' as const, personalityId: 'id3' },
      ];

      const handler = messageHandlers.get('message');
      for (const event of events) {
        handler!(REDIS_CHANNELS.CACHE_INVALIDATION, JSON.stringify(event));
      }

      expect(mockPersonalityService.invalidatePersonality).toHaveBeenCalledTimes(3);
      expect(mockPersonalityService.invalidatePersonality).toHaveBeenCalledWith('id1');
      expect(mockPersonalityService.invalidatePersonality).toHaveBeenCalledWith('id2');
      expect(mockPersonalityService.invalidatePersonality).toHaveBeenCalledWith('id3');
      expect(mockPersonalityService.invalidateAll).toHaveBeenCalledTimes(1);
    });
  });
});
