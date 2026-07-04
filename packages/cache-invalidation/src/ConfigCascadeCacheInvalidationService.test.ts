/**
 * Tests for ConfigCascadeCacheInvalidationService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigCascadeCacheInvalidationService } from './ConfigCascadeCacheInvalidationService.js';
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
describe('ConfigCascadeCacheInvalidationService', () => {
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
    it('should publish to correct channel', async () => {
      const service = new ConfigCascadeCacheInvalidationService(mockRedis as any);

      await service.publish({ type: 'all' });

      expect(mockRedis.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.CONFIG_CASCADE_CACHE_INVALIDATION,
        JSON.stringify({ type: 'all' })
      );
    });

    it('should throw on publish error', async () => {
      mockRedis.publish.mockRejectedValue(new Error('Redis error'));
      const service = new ConfigCascadeCacheInvalidationService(mockRedis as any);

      await expect(service.publish({ type: 'all' })).rejects.toThrow('Redis error');
    });
  });

  describe('subscribe', () => {
    it('should create subscriber and subscribe to channel', async () => {
      const service = new ConfigCascadeCacheInvalidationService(mockRedis as any);
      const callback = vi.fn();

      await service.subscribe(callback);

      expect(mockRedis.duplicate).toHaveBeenCalled();
      expect(mockSubscriber.subscribe).toHaveBeenCalledWith(
        REDIS_CHANNELS.CONFIG_CASCADE_CACHE_INVALIDATION
      );
    });

    it('should call callback when message received', async () => {
      const service = new ConfigCascadeCacheInvalidationService(mockRedis as any);
      const callback = vi.fn();

      await service.subscribe(callback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as ((channel: string, message: string) => void) | undefined;

      expect(messageHandler).toBeDefined();

      messageHandler!(
        REDIS_CHANNELS.CONFIG_CASCADE_CACHE_INVALIDATION,
        JSON.stringify({ type: 'admin' })
      );

      expect(callback).toHaveBeenCalledWith({ type: 'admin' });
    });
  });

  describe('helper methods', () => {
    it('invalidateUser should publish user event', async () => {
      const service = new ConfigCascadeCacheInvalidationService(mockRedis as any);

      await service.invalidateUser('user-123');

      expect(mockRedis.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.CONFIG_CASCADE_CACHE_INVALIDATION,
        JSON.stringify({ type: 'user', discordId: 'user-123' })
      );
    });

    it('invalidatePersonality should publish personality event', async () => {
      const service = new ConfigCascadeCacheInvalidationService(mockRedis as any);

      await service.invalidatePersonality('p-123');

      expect(mockRedis.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.CONFIG_CASCADE_CACHE_INVALIDATION,
        JSON.stringify({ type: 'personality', personalityId: 'p-123' })
      );
    });

    it('invalidateAdmin should publish admin event', async () => {
      const service = new ConfigCascadeCacheInvalidationService(mockRedis as any);

      await service.invalidateAdmin();

      expect(mockRedis.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.CONFIG_CASCADE_CACHE_INVALIDATION,
        JSON.stringify({ type: 'admin' })
      );
    });

    it('invalidateChannel should publish channel event', async () => {
      const service = new ConfigCascadeCacheInvalidationService(mockRedis as any);

      await service.invalidateChannel('ch-123');

      expect(mockRedis.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.CONFIG_CASCADE_CACHE_INVALIDATION,
        JSON.stringify({ type: 'channel', channelId: 'ch-123' })
      );
    });

    it('invalidateAll should publish all event', async () => {
      const service = new ConfigCascadeCacheInvalidationService(mockRedis as any);

      await service.invalidateAll();

      expect(mockRedis.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.CONFIG_CASCADE_CACHE_INVALIDATION,
        JSON.stringify({ type: 'all' })
      );
    });
  });
});
