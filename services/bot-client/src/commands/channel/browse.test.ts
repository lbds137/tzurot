/**
 * Tests for Channel Browse Handler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleBrowse,
  handleBrowsePagination,
  parseBrowseCustomId,
  isChannelBrowseInteraction,
} from './browse.js';
import type { ButtonInteraction } from 'discord.js';

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
    isBotOwner: vi.fn().mockReturnValue(false),
  };
});

// Mock userGatewayClient
const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

// Mock permissions
const mockRequireManageMessagesContext = vi.fn().mockResolvedValue(true);
vi.mock('../../utils/permissions.js', () => ({
  requireManageMessagesContext: (...args: unknown[]) => mockRequireManageMessagesContext(...args),
}));

describe('parseBrowseCustomId', () => {
  it('should parse valid browse custom ID', () => {
    const result = parseBrowseCustomId('channel::browse::0::current::date::');
    expect(result).toEqual({ page: 0, filter: 'current', sort: 'date', query: null });
  });

  it('should parse browse custom ID with query', () => {
    const result = parseBrowseCustomId('channel::browse::1::all::name::luna');
    expect(result).toEqual({ page: 1, filter: 'all', sort: 'name', query: 'luna' });
  });

  it('should return null for non-browse custom ID', () => {
    expect(parseBrowseCustomId('channel::list::0::date')).toBeNull();
  });

  it('should return null for invalid format', () => {
    expect(parseBrowseCustomId('channel::browse')).toBeNull();
  });

  it('should return null for invalid filter', () => {
    expect(parseBrowseCustomId('channel::browse::0::invalid::date::')).toBeNull();
  });

  it('should return null for invalid sort', () => {
    expect(parseBrowseCustomId('channel::browse::0::current::invalid::')).toBeNull();
  });

  it('should return null for non-numeric page', () => {
    expect(parseBrowseCustomId('channel::browse::abc::current::date::')).toBeNull();
  });
});

describe('isChannelBrowseInteraction', () => {
  it('should return true for browse custom IDs', () => {
    expect(isChannelBrowseInteraction('channel::browse::0::current::date::')).toBe(true);
  });

  it('should return false for non-browse custom IDs', () => {
    expect(isChannelBrowseInteraction('channel::list::0::date')).toBe(false);
  });

  it('should return false for other channel interactions', () => {
    expect(isChannelBrowseInteraction('channel-settings::modal::123')).toBe(false);
  });
});

describe('handleBrowse', () => {
  const mockEditReply = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset isBotOwner mock to default (false)
    const { isBotOwner } = await import('@tzurot/common-types');
    vi.mocked(isBotOwner).mockReturnValue(false);

    mockRequireManageMessagesContext.mockResolvedValue(true);
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { settings: [] },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createMockContext(query: string | null = null, filter: string | null = null) {
    return {
      user: { id: '123456789' },
      guildId: 'guild-123',
      interaction: {
        client: {
          channels: { cache: new Map() },
          guilds: { cache: new Map() },
        },
        options: {
          getString: vi.fn((name: string) => {
            if (name === 'query') return query;
            if (name === 'filter') return filter;
            return null;
          }),
        },
      },
      getOption: vi.fn(<T>(name: string): T | null => {
        if (name === 'query') return query as T;
        if (name === 'filter') return filter as T;
        return null;
      }),
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleBrowse>[0];
  }

  it('should check permission before proceeding', async () => {
    mockRequireManageMessagesContext.mockResolvedValue(false);

    const context = createMockContext();
    await handleBrowse(context);

    expect(mockRequireManageMessagesContext).toHaveBeenCalled();
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('should browse channels with default settings', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        settings: [
          {
            channelId: 'channel-1',
            guildId: 'guild-123',
            personalityId: 'personality-1',
            personalityName: 'Test Personality',
            personalitySlug: 'test-personality',
            createdAt: '2025-06-15T12:00:00.000Z',
          },
        ],
      },
    });

    const context = createMockContext();
    await handleBrowse(context);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      expect.stringContaining('/user/channel/list?guildId='),
      expect.objectContaining({
        userId: '123456789',
        method: 'GET',
      })
    );
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
  });

  it('should reject all filter for non-bot-owners', async () => {
    const context = createMockContext(null, 'all');
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith(
      expect.stringContaining('only available to bot owners')
    );
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('should allow all filter for bot owners', async () => {
    const { isBotOwner } = await import('@tzurot/common-types');
    vi.mocked(isBotOwner).mockReturnValue(true);

    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        settings: [
          {
            channelId: 'channel-1',
            guildId: 'guild-123',
            personalityId: 'personality-1',
            personalityName: 'Test',
            personalitySlug: 'test',
            createdAt: '2025-06-15T12:00:00.000Z',
          },
        ],
      },
    });

    const context = createMockContext(null, 'all');
    await handleBrowse(context);

    // Verify the API was called with the all-servers path (no guildId filter)
    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/channel/list',
      expect.objectContaining({
        userId: '123456789',
        method: 'GET',
      })
    );
    // Verify a response was sent (embed contains guild page data)
    expect(mockEditReply).toHaveBeenCalled();
  });

  it('should filter by query', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        settings: [
          {
            channelId: 'channel-1',
            guildId: 'guild-123',
            personalityId: 'personality-1',
            personalityName: 'Luna',
            personalitySlug: 'luna',
            createdAt: '2025-06-15T12:00:00.000Z',
          },
          {
            channelId: 'channel-2',
            guildId: 'guild-123',
            personalityId: 'personality-2',
            personalityName: 'Other',
            personalitySlug: 'other',
            createdAt: '2025-06-15T12:00:00.000Z',
          },
        ],
      },
    });

    const context = createMockContext('luna', null);
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({
              description: expect.stringContaining('Luna'),
            }),
          }),
        ]),
      })
    );
  });

  it('should handle empty results', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { settings: [] },
    });

    const context = createMockContext();
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
  });

  it('should handle API error', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'Internal error',
    });

    const context = createMockContext();
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith(
      expect.stringContaining('Failed to browse channels')
    );
  });

  it('should handle unexpected errors', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    const context = createMockContext();
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('unexpected error'));
  });
});

describe('handleBrowsePagination', () => {
  const mockDeferUpdate = vi.fn();
  const mockEditReply = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset isBotOwner mock to default (false)
    const { isBotOwner } = await import('@tzurot/common-types');
    vi.mocked(isBotOwner).mockReturnValue(false);

    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { settings: [] },
    });
  });

  function createMockButtonInteraction(customId: string) {
    return {
      customId,
      user: { id: '123456789' },
      client: {
        channels: { cache: new Map() },
        guilds: { cache: new Map() },
      },
      deferUpdate: mockDeferUpdate,
      editReply: mockEditReply,
    } as unknown as ButtonInteraction;
  }

  it('should defer update on pagination', async () => {
    const mockInteraction = createMockButtonInteraction('channel::browse::1::current::date::');
    await handleBrowsePagination(mockInteraction, 'guild-123');

    expect(mockDeferUpdate).toHaveBeenCalled();
  });

  it('should refresh data on pagination', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        settings: [
          {
            channelId: 'channel-1',
            guildId: 'guild-123',
            personalityId: 'personality-1',
            personalityName: 'Test',
            personalitySlug: 'test',
            createdAt: '2025-06-15T12:00:00.000Z',
          },
        ],
      },
    });

    const mockInteraction = createMockButtonInteraction('channel::browse::1::current::date::');
    await handleBrowsePagination(mockInteraction, 'guild-123');

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      expect.stringContaining('/user/channel/list'),
      expect.objectContaining({
        userId: '123456789',
        method: 'GET',
      })
    );
    expect(mockEditReply).toHaveBeenCalled();
  });

  it('should return early for invalid custom ID', async () => {
    const mockInteraction = createMockButtonInteraction('invalid::custom::id');
    await handleBrowsePagination(mockInteraction, 'guild-123');

    expect(mockDeferUpdate).not.toHaveBeenCalled();
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('should reject all filter for non-bot-owners', async () => {
    const mockInteraction = createMockButtonInteraction('channel::browse::1::all::date::');
    await handleBrowsePagination(mockInteraction, 'guild-123');

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('should allow all filter for bot owners', async () => {
    const { isBotOwner } = await import('@tzurot/common-types');
    vi.mocked(isBotOwner).mockReturnValue(true);

    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { settings: [] },
    });

    const mockInteraction = createMockButtonInteraction('channel::browse::1::all::date::');
    await handleBrowsePagination(mockInteraction, null);

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/channel/list', expect.any(Object));
  });

  it('should apply sort from custom ID', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        settings: [
          {
            channelId: 'channel-1',
            guildId: 'guild-123',
            personalityId: 'personality-1',
            personalityName: 'Test',
            personalitySlug: 'test',
            createdAt: '2025-06-15T12:00:00.000Z',
          },
        ],
      },
    });

    const mockInteraction = createMockButtonInteraction('channel::browse::0::current::name::');
    await handleBrowsePagination(mockInteraction, 'guild-123');

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            footer: expect.objectContaining({
              text: expect.stringContaining('alphabetically'),
            }),
          }),
        }),
      ]),
      components: expect.any(Array),
    });
  });

  it('should apply query filter from custom ID', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        settings: [
          {
            channelId: 'channel-1',
            guildId: 'guild-123',
            personalityId: 'personality-1',
            personalityName: 'Luna',
            personalitySlug: 'luna',
            createdAt: '2025-06-15T12:00:00.000Z',
          },
          {
            channelId: 'channel-2',
            guildId: 'guild-123',
            personalityId: 'personality-2',
            personalityName: 'Other',
            personalitySlug: 'other',
            createdAt: '2025-06-15T12:00:00.000Z',
          },
        ],
      },
    });

    const mockInteraction = createMockButtonInteraction('channel::browse::0::current::date::luna');
    await handleBrowsePagination(mockInteraction, 'guild-123');

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            description: expect.stringContaining('Luna'),
          }),
        }),
      ]),
      components: expect.any(Array),
    });
  });

  it('should handle API error silently (keep existing content)', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'Internal error',
    });

    const mockInteraction = createMockButtonInteraction('channel::browse::1::current::date::');
    await handleBrowsePagination(mockInteraction, 'guild-123');

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockEditReply).not.toHaveBeenCalled();
  });

  it('should handle unexpected errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    const mockInteraction = createMockButtonInteraction('channel::browse::1::current::date::');

    // Should not throw
    await expect(handleBrowsePagination(mockInteraction, 'guild-123')).resolves.not.toThrow();

    // Should not call editReply on error (keeps existing content)
    expect(mockEditReply).not.toHaveBeenCalled();
  });
});

describe('backfillMissingGuildIds', () => {
  const mockEditReply = vi.fn();
  const mockChannelsFetch = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    const { isBotOwner } = await import('@tzurot/common-types');
    vi.mocked(isBotOwner).mockReturnValue(false);
    mockRequireManageMessagesContext.mockResolvedValue(true);
  });

  function createMockContextWithFetch(channelFetchFn: typeof mockChannelsFetch) {
    return {
      user: { id: '123456789' },
      guildId: 'guild-123',
      interaction: {
        client: {
          channels: {
            cache: new Map(),
            fetch: channelFetchFn,
          },
          guilds: { cache: new Map() },
        },
      },
      getOption: vi.fn(() => null),
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleBrowse>[0];
  }

  it('should backfill missing guildId for channels', async () => {
    // API returns activation with null guildId
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        settings: [
          {
            channelId: 'channel-1',
            guildId: null, // Missing guildId triggers backfill
            personalityId: 'personality-1',
            personalityName: 'Test',
            personalitySlug: 'test',
            createdAt: '2025-06-15T12:00:00.000Z',
          },
        ],
      },
    });

    // Mock channel fetch to return channel with guild
    mockChannelsFetch.mockResolvedValue({
      guild: { id: 'backfilled-guild-123' },
    });

    const context = createMockContextWithFetch(mockChannelsFetch);
    await handleBrowse(context);

    // Verify backfill API was called
    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/channel/update-guild',
      expect.objectContaining({
        userId: '123456789',
        method: 'PATCH',
        body: {
          channelId: 'channel-1',
          guildId: 'backfilled-guild-123',
        },
      })
    );
  });

  it('should skip backfill when channel fetch returns null', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        settings: [
          {
            channelId: 'deleted-channel',
            guildId: null,
            personalityId: 'personality-1',
            personalityName: 'Test',
            personalitySlug: 'test',
            createdAt: '2025-06-15T12:00:00.000Z',
          },
        ],
      },
    });

    // Channel doesn't exist anymore
    mockChannelsFetch.mockResolvedValue(null);

    const context = createMockContextWithFetch(mockChannelsFetch);
    await handleBrowse(context);

    // Should still complete without error
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });

    // Backfill API should NOT be called (channel was null)
    const updateGuildCalls = mockCallGatewayApi.mock.calls.filter(
      call => call[0] === '/user/channel/update-guild'
    );
    expect(updateGuildCalls).toHaveLength(0);
  });

  it('should handle backfill errors gracefully', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        settings: [
          {
            channelId: 'error-channel',
            guildId: null,
            personalityId: 'personality-1',
            personalityName: 'Test',
            personalitySlug: 'test',
            createdAt: '2025-06-15T12:00:00.000Z',
          },
        ],
      },
    });

    // Channel fetch throws error
    mockChannelsFetch.mockRejectedValue(new Error('Channel not accessible'));

    const context = createMockContextWithFetch(mockChannelsFetch);
    await handleBrowse(context);

    // Should still complete and show results (even empty)
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
  });

  it('should skip channels without guild property during backfill', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        settings: [
          {
            channelId: 'dm-channel',
            guildId: null,
            personalityId: 'personality-1',
            personalityName: 'Test',
            personalitySlug: 'test',
            createdAt: '2025-06-15T12:00:00.000Z',
          },
        ],
      },
    });

    // DM channel has no guild property
    mockChannelsFetch.mockResolvedValue({
      id: 'dm-channel',
      // No guild property - simulating DM channel
    });

    const context = createMockContextWithFetch(mockChannelsFetch);
    await handleBrowse(context);

    // Backfill API should NOT be called (no guild property)
    const updateGuildCalls = mockCallGatewayApi.mock.calls.filter(
      call => call[0] === '/user/channel/update-guild'
    );
    expect(updateGuildCalls).toHaveLength(0);
  });
});

describe('buildGuildPages (all-servers view)', () => {
  const mockEditReply = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    const { isBotOwner } = await import('@tzurot/common-types');
    vi.mocked(isBotOwner).mockReturnValue(true); // Bot owner for all-servers
    mockRequireManageMessagesContext.mockResolvedValue(true);
  });

  function createMockContext(filter: string | null = 'all') {
    return {
      user: { id: '123456789' },
      guildId: 'guild-123',
      interaction: {
        client: {
          channels: { cache: new Map() },
          guilds: {
            cache: new Map([
              ['guild-1', { name: 'Server Alpha' }],
              ['guild-2', { name: 'Server Beta' }],
            ]),
          },
        },
      },
      getOption: vi.fn(<T>(name: string): T | null => {
        if (name === 'filter') return filter as T;
        return null;
      }),
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleBrowse>[0];
  }

  it('should group channels by guild in all-servers view', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        settings: [
          {
            channelId: 'channel-1',
            guildId: 'guild-1',
            personalityId: 'p1',
            personalityName: 'Luna',
            personalitySlug: 'luna',
            createdAt: '2025-06-15T12:00:00.000Z',
          },
          {
            channelId: 'channel-2',
            guildId: 'guild-2',
            personalityId: 'p2',
            personalityName: 'Nova',
            personalitySlug: 'nova',
            createdAt: '2025-06-16T12:00:00.000Z',
          },
        ],
      },
    });

    const context = createMockContext('all');
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            title: expect.stringContaining('Server'),
          }),
        }),
      ]),
      components: expect.any(Array),
    });
  });

  it('should handle unknown guildId in all-servers view', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        settings: [
          {
            channelId: 'channel-orphan',
            guildId: null, // Unknown guild
            personalityId: 'p1',
            personalityName: 'Test',
            personalitySlug: 'test',
            createdAt: '2025-06-15T12:00:00.000Z',
          },
        ],
      },
    });

    const context = createMockContext('all');
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            title: expect.stringContaining('Unknown Server'),
          }),
        }),
      ]),
      components: expect.any(Array),
    });
  });
});
