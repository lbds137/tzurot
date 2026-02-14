import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DenylistFilter } from './DenylistFilter.js';
import type { DenylistCache } from '../services/DenylistCache.js';

// Mock common-types
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    isBotOwner: (id: string) => id === 'owner-id',
  };
});

function createMockMessage(authorId: string, guildId: string | null, channelId: string) {
  return {
    author: { id: authorId },
    guildId,
    channelId,
  } as never;
}

describe('DenylistFilter', () => {
  let filter: DenylistFilter;
  let mockCache: {
    isBotDenied: ReturnType<typeof vi.fn>;
    isGuildDenied: ReturnType<typeof vi.fn>;
    isChannelDenied: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockCache = {
      isBotDenied: vi.fn().mockReturnValue(false),
      isGuildDenied: vi.fn().mockReturnValue(false),
      isChannelDenied: vi.fn().mockReturnValue(false),
    };
    filter = new DenylistFilter(mockCache as unknown as DenylistCache);
  });

  it('should pass through messages from the bot owner', async () => {
    const message = createMockMessage('owner-id', 'guild1', 'chan1');
    const result = await filter.process(message);
    expect(result).toBe(false);
    expect(mockCache.isBotDenied).not.toHaveBeenCalled();
  });

  it('should filter messages from bot-denied users', async () => {
    mockCache.isBotDenied.mockImplementation((userId: string) => userId === 'denied-user');
    const message = createMockMessage('denied-user', 'guild1', 'chan1');
    const result = await filter.process(message);
    expect(result).toBe(true);
  });

  it('should filter messages from bot-denied guilds', async () => {
    mockCache.isBotDenied.mockImplementation(
      (_userId: string, guildId?: string) => guildId === 'denied-guild'
    );
    const message = createMockMessage('user1', 'denied-guild', 'chan1');
    const result = await filter.process(message);
    expect(result).toBe(true);
  });

  it('should filter messages from channel-denied users', async () => {
    mockCache.isChannelDenied.mockImplementation(
      (userId: string, channelId: string) => userId === 'user1' && channelId === 'denied-chan'
    );
    const message = createMockMessage('user1', 'guild1', 'denied-chan');
    const result = await filter.process(message);
    expect(result).toBe(true);
  });

  it('should pass through messages from non-denied users', async () => {
    const message = createMockMessage('clean-user', 'clean-guild', 'clean-chan');
    const result = await filter.process(message);
    expect(result).toBe(false);
  });

  it('should handle DM messages (null guildId)', async () => {
    const message = createMockMessage('user1', null, 'dm-chan');
    const result = await filter.process(message);
    expect(result).toBe(false);
    // Should not check guild denial with null guildId
    expect(mockCache.isBotDenied).toHaveBeenCalledWith('user1');
  });
});
