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
});
