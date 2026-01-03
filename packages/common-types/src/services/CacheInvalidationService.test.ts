/**
 * CacheInvalidationService Unit Tests
 * Tests Redis pub/sub cache invalidation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CacheInvalidationService } from './CacheInvalidationService.js';
import { PersonalityService } from './personality/index.js';
import { REDIS_CHANNELS } from '../constants/queue.js';
import type { Redis } from 'ioredis';
import type { PrismaClient } from './prisma.js';

describe('CacheInvalidationService', () => {
  let mockRedis: Redis;
  let mockSubscriber: Redis;
  let mockPrisma: PrismaClient;
  let mockPersonalityService: PersonalityService;
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
    } as unknown as Redis;

    // Mock Prisma
    mockPrisma = {} as PrismaClient;

    // Mock PersonalityService
    mockPersonalityService = new PersonalityService(mockPrisma);
    vi.spyOn(mockPersonalityService, 'invalidatePersonality');
    vi.spyOn(mockPersonalityService, 'invalidateAll');

    service = new CacheInvalidationService(mockRedis, mockPersonalityService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('subscribe', () => {
    it('should create duplicate Redis connection and subscribe to channel', async () => {
      await service.subscribe();

      expect(mockRedis.duplicate).toHaveBeenCalledTimes(1);
      expect(mockSubscriber.subscribe).toHaveBeenCalledWith(REDIS_CHANNELS.CACHE_INVALIDATION);
      expect(mockSubscriber.on).toHaveBeenCalledWith('message', expect.any(Function));
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
