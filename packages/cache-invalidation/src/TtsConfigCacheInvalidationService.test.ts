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
});
