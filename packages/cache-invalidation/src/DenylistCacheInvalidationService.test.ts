/**
 * Tests for DenylistCacheInvalidationService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Redis } from 'ioredis';
import {
  DenylistCacheInvalidationService,
  isValidDenylistInvalidationEvent,
  type DenylistInvalidationEvent,
} from './DenylistCacheInvalidationService.js';
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
describe('DenylistCacheInvalidationService', () => {
  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockSubscriber: ReturnType<typeof createMockRedis>;
  let service: DenylistCacheInvalidationService;

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
    service = new DenylistCacheInvalidationService(mockRedis as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('isValidDenylistInvalidationEvent', () => {
    it('should validate add event', () => {
      expect(
        isValidDenylistInvalidationEvent({
          type: 'add',
          entry: { type: 'USER', discordId: '123', scope: 'BOT', scopeId: '*', mode: 'BLOCK' },
        })
      ).toBe(true);
    });

    it('should validate remove event', () => {
      expect(
        isValidDenylistInvalidationEvent({
          type: 'remove',
          entry: { type: 'GUILD', discordId: '456', scope: 'BOT', scopeId: '*', mode: 'BLOCK' },
        })
      ).toBe(true);
    });

    it('should validate all event', () => {
      expect(isValidDenylistInvalidationEvent({ type: 'all' })).toBe(true);
    });

    it('should reject null', () => {
      expect(isValidDenylistInvalidationEvent(null)).toBe(false);
    });

    it('should reject undefined', () => {
      expect(isValidDenylistInvalidationEvent(undefined)).toBe(false);
    });

    it('should reject non-objects', () => {
      expect(isValidDenylistInvalidationEvent('string')).toBe(false);
      expect(isValidDenylistInvalidationEvent(123)).toBe(false);
    });

    it('should reject invalid event types', () => {
      expect(isValidDenylistInvalidationEvent({ type: 'unknown' })).toBe(false);
    });

    it('should reject add event without entry', () => {
      expect(isValidDenylistInvalidationEvent({ type: 'add' })).toBe(false);
    });

    it('should reject add event with non-object entry', () => {
      expect(isValidDenylistInvalidationEvent({ type: 'add', entry: 'bad' })).toBe(false);
    });

    it('should reject add event with missing entry fields', () => {
      expect(
        isValidDenylistInvalidationEvent({
          type: 'add',
          entry: { type: 'USER', discordId: '123' },
        })
      ).toBe(false);
    });

    it('should reject add event with wrong entry field types', () => {
      expect(
        isValidDenylistInvalidationEvent({
          type: 'add',
          entry: { type: 'USER', discordId: 123, scope: 'BOT', scopeId: '*', mode: 'BLOCK' },
        })
      ).toBe(false);
    });

    it('should reject add event with missing mode field', () => {
      expect(
        isValidDenylistInvalidationEvent({
          type: 'add',
          entry: { type: 'USER', discordId: '123', scope: 'BOT', scopeId: '*' },
        })
      ).toBe(false);
    });

    it('should reject all event with extra properties', () => {
      expect(isValidDenylistInvalidationEvent({ type: 'all', extra: 'field' })).toBe(false);
    });

    it('should reject add event with extra top-level properties', () => {
      expect(
        isValidDenylistInvalidationEvent({
          type: 'add',
          entry: { type: 'USER', discordId: '123', scope: 'BOT', scopeId: '*', mode: 'BLOCK' },
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
        REDIS_CHANNELS.DENYLIST_CACHE_INVALIDATION
      );
    });

    it('should call callback when valid add event is received', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      const event: DenylistInvalidationEvent = {
        type: 'add',
        entry: { type: 'USER', discordId: '123', scope: 'BOT', scopeId: '*', mode: 'BLOCK' },
      };
      messageHandler(REDIS_CHANNELS.DENYLIST_CACHE_INVALIDATION, JSON.stringify(event));

      expect(callback).toHaveBeenCalledWith(event);
    });

    it('should call callback when valid remove event is received', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      const event: DenylistInvalidationEvent = {
        type: 'remove',
        entry: { type: 'USER', discordId: '123', scope: 'CHANNEL', scopeId: '456', mode: 'BLOCK' },
      };
      messageHandler(REDIS_CHANNELS.DENYLIST_CACHE_INVALIDATION, JSON.stringify(event));

      expect(callback).toHaveBeenCalledWith(event);
    });

    it('should call callback when valid all event is received', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      const event: DenylistInvalidationEvent = { type: 'all' };
      messageHandler(REDIS_CHANNELS.DENYLIST_CACHE_INVALIDATION, JSON.stringify(event));

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
  });

  describe('publishAdd', () => {
    it('should publish add event', async () => {
      const entry = { type: 'USER', discordId: '123', scope: 'BOT', scopeId: '*', mode: 'BLOCK' };
      await service.publishAdd(entry);

      expect(mockRedis.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.DENYLIST_CACHE_INVALIDATION,
        JSON.stringify({ type: 'add', entry })
      );
    });
  });

  describe('publishRemove', () => {
    it('should publish remove event', async () => {
      const entry = { type: 'GUILD', discordId: '456', scope: 'BOT', scopeId: '*', mode: 'BLOCK' };
      await service.publishRemove(entry);

      expect(mockRedis.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.DENYLIST_CACHE_INVALIDATION,
        JSON.stringify({ type: 'remove', entry })
      );
    });
  });

  describe('publishReloadAll', () => {
    it('should publish all event', async () => {
      await service.publishReloadAll();

      expect(mockRedis.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.DENYLIST_CACHE_INVALIDATION,
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
        REDIS_CHANNELS.DENYLIST_CACHE_INVALIDATION
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
      const dispatchService = new DenylistCacheInvalidationService(redisForDispatch);
      const callback = vi.fn();
      await dispatchService.subscribe(callback);
      return {
        deliver: (
          raw: string,
          channel: string = REDIS_CHANNELS.DENYLIST_CACHE_INVALIDATION
        ): void => {
          onMessage?.(channel, raw);
        },
        callback,
      };
    }

    it.each([
      [
        'add',
        {
          type: 'add',
          entry: { type: 'user', discordId: 'd-1', scope: 'user', scopeId: 'u-1', mode: 'block' },
        },
      ],
      [
        'remove',
        {
          type: 'remove',
          entry: { type: 'user', discordId: 'd-2', scope: 'guild', scopeId: 'g-1', mode: 'block' },
        },
      ],
      ['all', { type: 'all' }],
    ])('delivers a valid %s event to the callback', async (_name, event) => {
      const { deliver, callback } = await makeSubscribed();
      deliver(JSON.stringify(event));
      expect(callback).toHaveBeenCalledWith(event);
    });

    it.each([
      ['an add event missing its entry', JSON.stringify({ type: 'add' })],
      [
        'an add event whose entry lacks mode',
        JSON.stringify({
          type: 'add',
          entry: { type: 'user', discordId: 'd-1', scope: 'user', scopeId: 'u-1' },
        }),
      ],
      ['an all event carrying an extra key', JSON.stringify({ type: 'all', extra: true })],
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
