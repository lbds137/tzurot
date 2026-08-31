/**
 * Tests for UserCacheInvalidationService — the cross-process provisioning-cache
 * invalidation broadcast used on account deletion.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UserCacheInvalidationService } from './UserCacheInvalidationService.js';
import { REDIS_CHANNELS } from '@tzurot/common-types/constants/queue';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@tzurot/common-types/utils/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/utils/logger')>();
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

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

describe('UserCacheInvalidationService', () => {
  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockSubscriber: ReturnType<typeof createMockRedis>;
  let service: UserCacheInvalidationService;

  beforeEach(() => {
    mockSubscriber = createMockRedis();
    mockRedis = createMockRedis();
    mockRedis.duplicate.mockReturnValue(mockSubscriber);
    service = new UserCacheInvalidationService(mockRedis as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('publishes a user event on the user-cache channel', async () => {
    await service.invalidateUser('discord-123');

    expect(mockRedis.publish).toHaveBeenCalledWith(
      REDIS_CHANNELS.USER_CACHE_INVALIDATION,
      JSON.stringify({ type: 'user', discordId: 'discord-123' })
    );
  });

  it('publishes an all event', async () => {
    await service.invalidateAll();

    expect(mockRedis.publish).toHaveBeenCalledWith(
      REDIS_CHANNELS.USER_CACHE_INVALIDATION,
      JSON.stringify({ type: 'all' })
    );
  });

  // Pins the service's declared diagnostic contract (getLogContext/getEventDescription),
  // which is otherwise only exercised through log output.
  it('carries the service log context into the published log line', async () => {
    mockLogger.info.mockClear();

    await service.invalidateUser('discord-123');

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ discordId: 'discord-123', description: 'user discord-123' }),
      expect.any(String)
    );
  });

  it('delivers a valid user event to the subscriber callback', async () => {
    const callback = vi.fn();
    await service.subscribe(callback);

    expect(mockSubscriber.subscribe).toHaveBeenCalledWith(REDIS_CHANNELS.USER_CACHE_INVALIDATION);
    // Grab the registered message handler and feed it an event.
    const onMessage = mockSubscriber.on.mock.calls.find(c => c[0] === 'message')?.[1] as (
      channel: string,
      message: string
    ) => void;
    onMessage(
      REDIS_CHANNELS.USER_CACHE_INVALIDATION,
      JSON.stringify({ type: 'user', discordId: 'discord-123' })
    );

    expect(callback).toHaveBeenCalledWith({ type: 'user', discordId: 'discord-123' });
  });
});
