import { describe, it, expect, vi } from 'vitest';
import { ChannelType } from 'discord.js';
import type { Message } from 'discord.js';
import type { DenylistCache } from '../DenylistCache.js';
import { buildBlockDeniedChecker } from './blockDeniedChecker.js';

function mockMessage(overrides: Record<string, unknown> = {}): Message {
  return {
    guildId: 'guild-1',
    channelId: 'channel-1',
    channel: { id: 'channel-1', type: 0 },
    ...overrides,
  } as unknown as Message;
}

describe('buildBlockDeniedChecker', () => {
  it('returns undefined when no denylist cache is configured', () => {
    expect(buildBlockDeniedChecker(undefined, mockMessage(), 'p-1')).toBeUndefined();
  });

  it('returns a predicate that delegates to cache.isBlocked with full scope', () => {
    const isBlocked = vi.fn().mockReturnValue(true);
    const cache = { isBlocked } as unknown as DenylistCache;

    const predicate = buildBlockDeniedChecker(cache, mockMessage(), 'p-1');
    expect(predicate).toBeDefined();
    expect(predicate!('user-9')).toBe(true);
    expect(isBlocked).toHaveBeenCalledWith('user-9', 'guild-1', 'channel-1', 'p-1', undefined);
  });

  it('passes undefined guildId for DM messages', () => {
    const isBlocked = vi.fn().mockReturnValue(false);
    const cache = { isBlocked } as unknown as DenylistCache;

    const predicate = buildBlockDeniedChecker(cache, mockMessage({ guildId: null }), 'p-2');
    expect(predicate!('user-1')).toBe(false);
    expect(isBlocked).toHaveBeenCalledWith('user-1', undefined, 'channel-1', 'p-2', undefined);
  });

  it('passes the thread parent id to cache.isBlocked for thread channels', () => {
    const isBlocked = vi.fn().mockReturnValue(false);
    const cache = { isBlocked } as unknown as DenylistCache;

    const predicate = buildBlockDeniedChecker(
      cache,
      mockMessage({
        channelId: 'thread-1',
        channel: { id: 'thread-1', type: ChannelType.PublicThread, parentId: 'parent-1' },
      }),
      'p-3'
    );
    predicate!('user-1');
    // 5th arg is the thread's PARENT id (denylist applies at the parent scope),
    // not undefined as for a top-level text channel.
    expect(isBlocked).toHaveBeenCalledWith('user-1', 'guild-1', 'thread-1', 'p-3', 'parent-1');
  });
});
