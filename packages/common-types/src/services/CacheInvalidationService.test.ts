/**
 * CacheInvalidationService Unit Tests
 * Tests Redis pub/sub cache invalidation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CacheInvalidationService } from './CacheInvalidationService.js';
import { PersonalityService } from './PersonalityService.js';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '@prisma/client';

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
      expect(mockSubscriber.subscribe).toHaveBeenCalledWith('cache:invalidation');
      expect(mockSubscriber.on).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should handle subscription errors', async () => {
      vi.mocked(mockSubscriber.subscribe).mockRejectedValue(new Error('Connection failed'));

      await expect(service.subscribe()).rejects.toThrow('Connection failed');
    });
  });

  describe('publish', () => {
    it('should publish personality invalidation event', async () => {
      const event = { type: 'personality' as const, personalityId: 'test-id' };

      await service.publish(event);

      expect(mockRedis.publish).toHaveBeenCalledWith(
        'cache:invalidation',
        JSON.stringify(event)
      );
    });

    it('should publish all invalidation event', async () => {
      const event = { type: 'all' as const };

      await service.publish(event);

      expect(mockRedis.publish).toHaveBeenCalledWith(
        'cache:invalidation',
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
      handler!('cache:invalidation', message);

      expect(mockPersonalityService.invalidatePersonality).toHaveBeenCalledWith('test-id');
      expect(mockPersonalityService.invalidateAll).not.toHaveBeenCalled();
    });

    it('should invalidate all personalities when receiving all event', () => {
      const event = { type: 'all' as const };
      const message = JSON.stringify(event);

      // Simulate receiving message
      const handler = messageHandlers.get('message');
      expect(handler).toBeDefined();
      handler!('cache:invalidation', message);

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
        handler!('cache:invalidation', malformedMessage);
      }).not.toThrow();

      expect(mockPersonalityService.invalidateAll).not.toHaveBeenCalled();
      expect(mockPersonalityService.invalidatePersonality).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe and disconnect when subscriber exists', async () => {
      await service.subscribe();
      await service.unsubscribe();

      expect(mockSubscriber.unsubscribe).toHaveBeenCalledWith('cache:invalidation');
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
      handler!('cache:invalidation', JSON.stringify(event));

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
        handler!('cache:invalidation', JSON.stringify(event));
      }

      expect(mockPersonalityService.invalidatePersonality).toHaveBeenCalledTimes(3);
      expect(mockPersonalityService.invalidatePersonality).toHaveBeenCalledWith('id1');
      expect(mockPersonalityService.invalidatePersonality).toHaveBeenCalledWith('id2');
      expect(mockPersonalityService.invalidatePersonality).toHaveBeenCalledWith('id3');
      expect(mockPersonalityService.invalidateAll).toHaveBeenCalledTimes(1);
    });
  });
});
