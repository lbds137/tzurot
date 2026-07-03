/**
 * Tests for SttResolverCacheInvalidationService.
 *
 * Mirrors TtsConfigCacheInvalidationService.test.ts in shape — different
 * channel, narrower event surface (no `config` variant since STT doesn't
 * reference a config row).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  SttResolverCacheInvalidationService,
  isValidSttResolverInvalidationEvent,
} from './SttResolverCacheInvalidationService.js';
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
describe('isValidSttResolverInvalidationEvent', () => {
  it('accepts user event', () => {
    expect(isValidSttResolverInvalidationEvent({ type: 'user', discordId: '123' })).toBe(true);
  });

  it('accepts all event', () => {
    expect(isValidSttResolverInvalidationEvent({ type: 'all' })).toBe(true);
  });

  it('rejects user event missing discordId', () => {
    expect(isValidSttResolverInvalidationEvent({ type: 'user' })).toBe(false);
  });

  it('rejects config event (STT has no per-config surface)', () => {
    expect(isValidSttResolverInvalidationEvent({ type: 'config', configId: 'cfg' })).toBe(false);
  });

  it('rejects unknown event type', () => {
    expect(isValidSttResolverInvalidationEvent({ type: 'mystery' })).toBe(false);
  });

  it('rejects null and primitives', () => {
    expect(isValidSttResolverInvalidationEvent(null)).toBe(false);
    expect(isValidSttResolverInvalidationEvent(undefined)).toBe(false);
    expect(isValidSttResolverInvalidationEvent('not-an-object')).toBe(false);
  });
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
