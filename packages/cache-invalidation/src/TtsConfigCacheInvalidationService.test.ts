/**
 * Tests for TtsConfigCacheInvalidationService.
 *
 * Mirrors LlmConfigCacheInvalidationService.test.ts in shape — same event
 * variants (user / config / all), same publish helper APIs. Heavy lifting
 * happens in BaseCacheInvalidationService (already separately tested);
 * these tests verify the TTS-specific wiring is right.
 */

import { describe, it, expect, vi } from 'vitest';
import { TtsConfigCacheInvalidationService } from './TtsConfigCacheInvalidationService.js';
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
describe('TtsConfigCacheInvalidationService', () => {
  function makeService(): {
    service: TtsConfigCacheInvalidationService;
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
    return { service: new TtsConfigCacheInvalidationService(mockRedis), publish };
  }

  it('uses the TTS_CONFIG_CACHE_INVALIDATION channel', async () => {
    const { service, publish } = makeService();
    await service.invalidateAll();
    expect(publish).toHaveBeenCalledWith(
      REDIS_CHANNELS.TTS_CONFIG_CACHE_INVALIDATION,
      expect.any(String)
    );
  });

  it('invalidateUserTtsConfig publishes a user event', async () => {
    const { service, publish } = makeService();
    await service.invalidateUserTtsConfig('discord-456');
    const [, body] = publish.mock.calls[0];
    expect(JSON.parse(body)).toEqual({ type: 'user', discordId: 'discord-456' });
  });

  it('invalidateConfigUsers publishes a config event', async () => {
    const { service, publish } = makeService();
    await service.invalidateConfigUsers('cfg-uuid-789');
    const [, body] = publish.mock.calls[0];
    expect(JSON.parse(body)).toEqual({ type: 'config', configId: 'cfg-uuid-789' });
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
      const mockRedis = {
        duplicate: vi.fn().mockReturnValue(subscriber),
        publish: vi.fn().mockResolvedValue(1),
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        disconnect: vi.fn(),
        on: vi.fn(),
      } as unknown as Redis;
      const service = new TtsConfigCacheInvalidationService(mockRedis);
      const callback = vi.fn();
      await service.subscribe(callback);
      return {
        deliver: (
          raw: string,
          channel: string = REDIS_CHANNELS.TTS_CONFIG_CACHE_INVALIDATION
        ): void => {
          onMessage?.(channel, raw);
        },
        callback,
      };
    }

    it.each([
      ['user', { type: 'user', discordId: 'discord-1' }],
      ['config', { type: 'config', configId: 'cfg-1' }],
      ['all', { type: 'all' }],
    ])('delivers a valid %s event to the callback', async (_name, event) => {
      const { deliver, callback } = await makeSubscribed();
      deliver(JSON.stringify(event));
      expect(callback).toHaveBeenCalledWith(event);
    });

    it.each([
      ['a user event missing discordId', JSON.stringify({ type: 'user' })],
      ['a config event with a numeric configId', JSON.stringify({ type: 'config', configId: 7 })],
      ['an unknown event type', JSON.stringify({ type: 'everything' })],
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
