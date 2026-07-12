/**
 * Tests for SystemSettingsCacheInvalidationService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SystemSettingsCacheInvalidationService,
  isValidSystemSettingsInvalidationEvent,
} from './SystemSettingsCacheInvalidationService.js';
import { REDIS_CHANNELS } from '@tzurot/common-types/constants/queue';
import type { Redis } from 'ioredis';

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

describe('SystemSettingsCacheInvalidationService', () => {
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

  function makeService(): SystemSettingsCacheInvalidationService {
    return new SystemSettingsCacheInvalidationService(mockRedis as unknown as Redis);
  }

  describe('publish', () => {
    it('should publish "keys" event', async () => {
      const service = makeService();

      await service.publish({ type: 'keys', keys: ['zaiHeadroomPercent', 'extractionEnabled'] });

      expect(mockRedis.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.SYSTEM_SETTINGS_CACHE_INVALIDATION,
        JSON.stringify({ type: 'keys', keys: ['zaiHeadroomPercent', 'extractionEnabled'] })
      );
    });

    it('should publish "all" event', async () => {
      const service = makeService();

      await service.publish({ type: 'all' });

      expect(mockRedis.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.SYSTEM_SETTINGS_CACHE_INVALIDATION,
        JSON.stringify({ type: 'all' })
      );
    });

    it('should throw on publish error', async () => {
      mockRedis.publish.mockRejectedValue(new Error('Redis error'));
      const service = makeService();

      await expect(service.publish({ type: 'all' })).rejects.toThrow('Redis error');
    });
  });

  describe('subscribe', () => {
    it('should create subscriber and subscribe to channel', async () => {
      const service = makeService();

      await service.subscribe(vi.fn());

      expect(mockRedis.duplicate).toHaveBeenCalledTimes(1);
      expect(mockSubscriber.subscribe).toHaveBeenCalledWith(
        REDIS_CHANNELS.SYSTEM_SETTINGS_CACHE_INVALIDATION
      );
    });

    it('should not double-subscribe', async () => {
      const service = makeService();

      await service.subscribe(vi.fn());
      await service.subscribe(vi.fn());

      expect(mockRedis.duplicate).toHaveBeenCalledTimes(1);
    });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe and disconnect the subscriber', async () => {
      const service = makeService();
      await service.subscribe(vi.fn());

      await service.unsubscribe();

      expect(mockSubscriber.unsubscribe).toHaveBeenCalled();
      expect(mockSubscriber.disconnect).toHaveBeenCalled();
    });

    it('should be a no-op when not subscribed', async () => {
      const service = makeService();

      await expect(service.unsubscribe()).resolves.toBeUndefined();
      expect(mockSubscriber.unsubscribe).not.toHaveBeenCalled();
    });
  });

  describe('helper methods', () => {
    it('invalidateKeys publishes a keys event', async () => {
      const service = makeService();

      await service.invalidateKeys(['fallbackTextModel']);

      expect(mockRedis.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.SYSTEM_SETTINGS_CACHE_INVALIDATION,
        JSON.stringify({ type: 'keys', keys: ['fallbackTextModel'] })
      );
    });

    it('invalidateAll publishes an all event', async () => {
      const service = makeService();

      await service.invalidateAll();

      expect(mockRedis.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.SYSTEM_SETTINGS_CACHE_INVALIDATION,
        JSON.stringify({ type: 'all' })
      );
    });
  });

  describe('subscribe dispatch (wire-contract validation)', () => {
    async function makeSubscribed(): Promise<{
      callback: ReturnType<typeof vi.fn>;
      emit: (channel: string, message: string) => void;
    }> {
      const service = makeService();
      const callback = vi.fn();
      await service.subscribe(callback);
      const handler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;
      return { callback, emit: handler };
    }

    it.each([
      [{ type: 'keys', keys: ['extractionEnabled'] }],
      [{ type: 'keys', keys: ['a', 'b', 'c'] }],
      [{ type: 'all' }],
    ])('valid event %j reaches the callback', async event => {
      const { callback, emit } = await makeSubscribed();

      emit(REDIS_CHANNELS.SYSTEM_SETTINGS_CACHE_INVALIDATION, JSON.stringify(event));

      expect(callback).toHaveBeenCalledWith(event);
    });

    it.each([
      ['empty keys array', { type: 'keys', keys: [] }],
      ['keys not an array', { type: 'keys', keys: 'extractionEnabled' }],
      ['non-string key member', { type: 'keys', keys: ['ok', 42] }],
      ['extra field on keys event', { type: 'keys', keys: ['a'], extra: true }],
      ['extra field on all event', { type: 'all', extra: true }],
      ['unknown type', { type: 'everything' }],
      ['missing keys field', { type: 'keys' }],
    ])('malformed event (%s) is rejected without invoking the callback', async (_label, event) => {
      const { callback, emit } = await makeSubscribed();

      emit(REDIS_CHANNELS.SYSTEM_SETTINGS_CACHE_INVALIDATION, JSON.stringify(event));

      expect(callback).not.toHaveBeenCalled();
    });

    it('non-JSON payload is rejected without invoking the callback', async () => {
      const { callback, emit } = await makeSubscribed();

      emit(REDIS_CHANNELS.SYSTEM_SETTINGS_CACHE_INVALIDATION, 'not-json{{');

      expect(callback).not.toHaveBeenCalled();
    });

    it('messages on other channels are ignored', async () => {
      const { callback, emit } = await makeSubscribed();

      emit(REDIS_CHANNELS.LLM_CONFIG_CACHE_INVALIDATION, JSON.stringify({ type: 'all' }));

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('isValidSystemSettingsInvalidationEvent', () => {
    it('rejects primitives and null', () => {
      expect(isValidSystemSettingsInvalidationEvent(null)).toBe(false);
      expect(isValidSystemSettingsInvalidationEvent('all')).toBe(false);
      expect(isValidSystemSettingsInvalidationEvent(42)).toBe(false);
    });
  });
});
