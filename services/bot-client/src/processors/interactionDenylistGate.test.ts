import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isInteractionDenied } from './interactionDenylistGate.js';
import type { DenylistCache } from '../services/DenylistCache.js';

vi.mock('@tzurot/common-types/utils/ownerMiddleware', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/ownerMiddleware')>(
    '@tzurot/common-types/utils/ownerMiddleware'
  );
  return {
    ...actual,
    isBotOwner: (id: string) => id === 'owner-id',
  };
});

describe('isInteractionDenied', () => {
  let mockCache: {
    isBotDenied: ReturnType<typeof vi.fn>;
    isUserGuildDenied: ReturnType<typeof vi.fn>;
    isChannelDenied: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockCache = {
      isBotDenied: vi.fn().mockReturnValue(false),
      isUserGuildDenied: vi.fn().mockReturnValue(false),
      isChannelDenied: vi.fn().mockReturnValue(false),
    };
  });

  it('never denies the bot owner, even when every cache check would deny', () => {
    mockCache.isBotDenied.mockReturnValue(true);
    mockCache.isUserGuildDenied.mockReturnValue(true);
    mockCache.isChannelDenied.mockReturnValue(true);

    const result = isInteractionDenied(mockCache as unknown as DenylistCache, {
      userId: 'owner-id',
      guildId: 'guild1',
      channelId: 'chan1',
      parentChannelId: null,
    });

    expect(result).toBe(false);
  });

  it('denies when isBotDenied is true', () => {
    mockCache.isBotDenied.mockReturnValue(true);

    const result = isInteractionDenied(mockCache as unknown as DenylistCache, {
      userId: 'user-1',
      guildId: 'guild1',
      channelId: 'chan1',
      parentChannelId: null,
    });

    expect(result).toBe(true);
  });

  it('denies when isUserGuildDenied is true', () => {
    mockCache.isUserGuildDenied.mockReturnValue(true);

    const result = isInteractionDenied(mockCache as unknown as DenylistCache, {
      userId: 'user-1',
      guildId: 'guild1',
      channelId: 'chan1',
      parentChannelId: null,
    });

    expect(result).toBe(true);
  });

  it('does not call isUserGuildDenied when guildId is null', () => {
    const result = isInteractionDenied(mockCache as unknown as DenylistCache, {
      userId: 'user-1',
      guildId: null,
      channelId: 'chan1',
      parentChannelId: null,
    });

    expect(result).toBe(false);
    expect(mockCache.isUserGuildDenied).not.toHaveBeenCalled();
    // The bot-wide check still runs, and the null must reach it as `undefined`
    // — isBotDenied's own signature takes `guildId?: string`, so forwarding a
    // raw null would be a different call than the one it is written for.
    // Asserting the skip alone would not catch that conversion breaking.
    expect(mockCache.isBotDenied).toHaveBeenCalledWith('user-1', undefined);
  });

  it('does not call isChannelDenied when channelId is null', () => {
    const result = isInteractionDenied(mockCache as unknown as DenylistCache, {
      userId: 'user-1',
      guildId: 'guild1',
      channelId: null,
      parentChannelId: null,
    });

    expect(result).toBe(false);
    expect(mockCache.isChannelDenied).not.toHaveBeenCalled();
  });

  it('returns false when nothing denies', () => {
    const result = isInteractionDenied(mockCache as unknown as DenylistCache, {
      userId: 'user-1',
      guildId: 'guild1',
      channelId: 'chan1',
      parentChannelId: null,
    });

    expect(result).toBe(false);
  });

  it('regression: a parent-channel-only denial blocks a slash command in the child thread', () => {
    // Mirrors the real ANY-MODE inheritance rule: denied if either the
    // channel itself or its parent has an entry. If production code passed
    // `null` for the parent instead of the real value, this mock returns
    // false and the test goes red — a `mockReturnValue(true)` would pass
    // either way and prove nothing.
    mockCache.isChannelDenied.mockImplementation(
      (_userId: string, channelId: string, parentChannelId: string | null) =>
        channelId === 'parent-1' || parentChannelId === 'parent-1'
    );

    const result = isInteractionDenied(mockCache as unknown as DenylistCache, {
      userId: 'user-1',
      guildId: 'guild1',
      channelId: 'thread-1',
      parentChannelId: 'parent-1',
    });

    expect(result).toBe(true);
    expect(mockCache.isChannelDenied).toHaveBeenCalledWith('user-1', 'thread-1', 'parent-1');
  });
});
