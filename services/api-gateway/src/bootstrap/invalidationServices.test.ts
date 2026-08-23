import { describe, it, expect, vi } from 'vitest';
import type { Redis } from 'ioredis';
import {
  ApiKeyCacheInvalidationService,
  DenylistCacheInvalidationService,
  LlmConfigCacheInvalidationService,
  SttResolverCacheInvalidationService,
  TtsConfigCacheInvalidationService,
  UserCacheInvalidationService,
} from '@tzurot/cache-invalidation';
import { createChannelInvalidationServices } from './invalidationServices.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

describe('createChannelInvalidationServices', () => {
  /**
   * The constructors only stash the client (subscription happens later, on a
   * `duplicate()`), so a bare object is enough to build every service.
   */
  function createFakeRedis(): Redis {
    return { duplicate: vi.fn() } as unknown as Redis;
  }

  it('builds one service of each channel type over the given client', () => {
    const services = createChannelInvalidationServices(createFakeRedis());

    expect(services.apiKeyCacheInvalidation).toBeInstanceOf(ApiKeyCacheInvalidationService);
    expect(services.llmConfigCacheInvalidation).toBeInstanceOf(LlmConfigCacheInvalidationService);
    expect(services.ttsConfigCacheInvalidation).toBeInstanceOf(TtsConfigCacheInvalidationService);
    expect(services.sttResolverCacheInvalidation).toBeInstanceOf(
      SttResolverCacheInvalidationService
    );
    expect(services.denylistInvalidation).toBeInstanceOf(DenylistCacheInvalidationService);
    // The provisioning-cache publisher the set-default-persona route needs; a
    // missing entry here leaves that route's broadcast silently undefined.
    expect(services.userCacheInvalidation).toBeInstanceOf(UserCacheInvalidationService);
  });

  it('returns independent instances per call', () => {
    const first = createChannelInvalidationServices(createFakeRedis());
    const second = createChannelInvalidationServices(createFakeRedis());

    expect(first.userCacheInvalidation).not.toBe(second.userCacheInvalidation);
  });
});
