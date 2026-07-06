/**
 * Tests for SttResolverCacheInvalidationService.
 *
 * Mirrors TtsConfigCacheInvalidationService.test.ts in shape — different
 * channel, narrower event surface (no `config` variant since STT doesn't
 * reference a config row).
 */

import { describe, it, expect, vi } from 'vitest';
import { SttResolverCacheInvalidationService } from './SttResolverCacheInvalidationService.js';
import { REDIS_CHANNELS } from '@tzurot/common-types/constants/queue';
import type { Redis } from 'ioredis';
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
describe('SttResolverCacheInvalidationService', () => {
  function makeService(): {
    service: SttResolverCacheInvalidationService;
    publish: ReturnType<typeof vi.fn>;
  } {
    const publish = vi.fn().mockResolvedValue(1);
    const mockRedis = {
      duplicate: vi.fn(),
      publish,
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      disconnect: vi.fn(),
      on: vi.fn(),
    } as unknown as Redis;
    return { service: new SttResolverCacheInvalidationService(mockRedis), publish };
  }

  it('uses the STT_RESOLVER_CACHE_INVALIDATION channel', async () => {
    const { service, publish } = makeService();
    await service.invalidateAll();
    expect(publish).toHaveBeenCalledWith(
      REDIS_CHANNELS.STT_RESOLVER_CACHE_INVALIDATION,
      expect.any(String)
    );
  });

  it('invalidateUserStt publishes a user event', async () => {
    const { service, publish } = makeService();
    await service.invalidateUserStt('discord-456');
    const [, body] = publish.mock.calls[0];
    expect(JSON.parse(body)).toEqual({ type: 'user', discordId: 'discord-456' });
  });

  it('invalidateAll publishes an all event', async () => {
    const { service, publish } = makeService();
    await service.invalidateAll();
    const [, body] = publish.mock.calls[0];
    expect(JSON.parse(body)).toEqual({ type: 'all' });
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
      const dispatchService = new SttResolverCacheInvalidationService(redisForDispatch);
      const callback = vi.fn();
      await dispatchService.subscribe(callback);
      return {
        deliver: (
          raw: string,
          channel: string = REDIS_CHANNELS.STT_RESOLVER_CACHE_INVALIDATION
        ): void => {
          onMessage?.(channel, raw);
        },
        callback,
      };
    }

    it.each([
      ['user', { type: 'user', discordId: 'discord-1' }],
      ['all', { type: 'all' }],
    ])('delivers a valid %s event to the callback', async (_name, event) => {
      const { deliver, callback } = await makeSubscribed();
      deliver(JSON.stringify(event));
      expect(callback).toHaveBeenCalledWith(event);
    });

    it.each([
      [
        'the config variant STT deliberately does not support',
        JSON.stringify({ type: 'config', configId: 'cfg-1' }),
      ],
      ['a user event with a numeric discordId', JSON.stringify({ type: 'user', discordId: 42 })],
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
