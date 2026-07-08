/**
 * Tests for Channel Browse Handler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
import type { GatewayResult, UserClient } from '@tzurot/clients';
import { handleBrowse, handleBrowsePagination, isChannelBrowseInteraction } from './browse.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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

vi.mock('@tzurot/common-types/utils/ownerMiddleware', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/ownerMiddleware')>(
    '@tzurot/common-types/utils/ownerMiddleware'
  );
  return {
    ...actual,
    isBotOwner: vi.fn().mockReturnValue(false),
  };
});

const mockRequireManageMessagesContext = vi.fn().mockResolvedValue(true);
vi.mock('../../utils/permissions.js', () => ({
  requireManageMessagesContext: (...args: unknown[]) => mockRequireManageMessagesContext(...args),
}));

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

interface StubClient {
  listUserChannels: ReturnType<typeof vi.fn>;
  updateChannelGuild: ReturnType<typeof vi.fn>;
}

function createStubClient(): StubClient {
  return {
    listUserChannels: vi.fn(),
    updateChannelGuild: vi.fn(),
  };
}

function asUserClient(stub: StubClient): UserClient {
  return stub as unknown as UserClient;
}

function ok<T>(data: T): GatewayResult<T> {
  return { ok: true, data };
}

function err(status: number, message = 'fail'): GatewayResult<never> {
  return { ok: false, kind: status > 0 ? 'http' : 'network', error: message, status };
}

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
  let stub: StubClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { isBotOwner } = await import('@tzurot/common-types/utils/ownerMiddleware');
    vi.mocked(isBotOwner).mockReturnValue(false);

    mockRequireManageMessagesContext.mockResolvedValue(true);
    stub = createStubClient();
    stub.listUserChannels.mockResolvedValue(ok({ settings: [] }));
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createMockContext(query: string | null = null, filter: string | null = null) {
    return {
      user: { id: '123456789', username: 'testuser' },
      guildId: 'guild-123',
      interaction: {
        user: { id: '123456789', username: 'testuser' },
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
    expect(stub.listUserChannels).not.toHaveBeenCalled();
  });

  it('should browse channels with default settings', async () => {
    stub.listUserChannels.mockResolvedValue(
      ok({
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
      })
    );

    const context = createMockContext();
    await handleBrowse(context);

    // Current-server filter sends the guildId via the options bag.
    expect(stub.listUserChannels).toHaveBeenCalledWith({ guildId: 'guild-123' });
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
    expect(stub.listUserChannels).not.toHaveBeenCalled();
  });

  it('should allow all filter for bot owners', async () => {
    const { isBotOwner } = await import('@tzurot/common-types/utils/ownerMiddleware');
    vi.mocked(isBotOwner).mockReturnValue(true);

    stub.listUserChannels.mockResolvedValue(
      ok({
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
      })
    );

    const context = createMockContext(null, 'all');
    await handleBrowse(context);

    // The 'all' filter sends no guildId (empty options bag).
    expect(stub.listUserChannels).toHaveBeenCalledWith({});
    expect(mockEditReply).toHaveBeenCalled();
  });

  it('should filter by query', async () => {
    stub.listUserChannels.mockResolvedValue(
      ok({
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
      })
    );

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
    stub.listUserChannels.mockResolvedValue(ok({ settings: [] }));

    const context = createMockContext();
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
  });

  it('should handle API error', async () => {
    stub.listUserChannels.mockResolvedValue(err(500, 'Internal error'));

    const context = createMockContext();
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('Internal error'));
  });

  it('should handle unexpected errors', async () => {
    stub.listUserChannels.mockRejectedValue(new Error('Network error'));

    const context = createMockContext();
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load the channels')
    );
  });
});

describe('handleBrowsePagination', () => {
  const mockDeferUpdate = vi.fn();
  const mockEditReply = vi.fn();
  let stub: StubClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { isBotOwner } = await import('@tzurot/common-types/utils/ownerMiddleware');
    vi.mocked(isBotOwner).mockReturnValue(false);

    stub = createStubClient();
    stub.listUserChannels.mockResolvedValue(ok({ settings: [] }));
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  function createMockButtonInteraction(customId: string) {
    return {
      customId,
      user: { id: '123456789', username: 'testuser' },
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
    stub.listUserChannels.mockResolvedValue(
      ok({
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
      })
    );

    const mockInteraction = createMockButtonInteraction('channel::browse::1::current::date::');
    await handleBrowsePagination(mockInteraction, 'guild-123');

    expect(stub.listUserChannels).toHaveBeenCalledWith({ guildId: 'guild-123' });
    expect(mockEditReply).toHaveBeenCalled();
  });

  it('should return early for invalid custom ID', async () => {
    const mockInteraction = createMockButtonInteraction('invalid::custom::id');
    await handleBrowsePagination(mockInteraction, 'guild-123');

    expect(mockDeferUpdate).not.toHaveBeenCalled();
    expect(stub.listUserChannels).not.toHaveBeenCalled();
  });

  it('should reject all filter for non-bot-owners', async () => {
    const mockInteraction = createMockButtonInteraction('channel::browse::1::all::date::');
    await handleBrowsePagination(mockInteraction, 'guild-123');

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(stub.listUserChannels).not.toHaveBeenCalled();
  });

  it('should allow all filter for bot owners', async () => {
    const { isBotOwner } = await import('@tzurot/common-types/utils/ownerMiddleware');
    vi.mocked(isBotOwner).mockReturnValue(true);

    stub.listUserChannels.mockResolvedValue(ok({ settings: [] }));

    const mockInteraction = createMockButtonInteraction('channel::browse::1::all::date::');
    await handleBrowsePagination(mockInteraction, null);

    expect(stub.listUserChannels).toHaveBeenCalledWith({});
  });

  it('should apply sort from custom ID', async () => {
    stub.listUserChannels.mockResolvedValue(
      ok({
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
      })
    );

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
    stub.listUserChannels.mockResolvedValue(
      ok({
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
      })
    );

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
    stub.listUserChannels.mockResolvedValue(err(500, 'Internal error'));

    const mockInteraction = createMockButtonInteraction('channel::browse::1::current::date::');
    await handleBrowsePagination(mockInteraction, 'guild-123');

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockEditReply).not.toHaveBeenCalled();
  });

  it('should handle unexpected errors gracefully', async () => {
    stub.listUserChannels.mockRejectedValue(new Error('Network error'));

    const mockInteraction = createMockButtonInteraction('channel::browse::1::current::date::');

    await expect(handleBrowsePagination(mockInteraction, 'guild-123')).resolves.not.toThrow();

    expect(mockEditReply).not.toHaveBeenCalled();
  });
});

describe('backfillMissingGuildIds', () => {
  const mockEditReply = vi.fn();
  const mockChannelsFetch = vi.fn();
  let stub: StubClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { isBotOwner } = await import('@tzurot/common-types/utils/ownerMiddleware');
    vi.mocked(isBotOwner).mockReturnValue(false);
    mockRequireManageMessagesContext.mockResolvedValue(true);
    stub = createStubClient();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  function createMockContextWithFetch(channelFetchFn: typeof mockChannelsFetch) {
    return {
      user: { id: '123456789', username: 'testuser' },
      guildId: 'guild-123',
      interaction: {
        user: { id: '123456789', username: 'testuser' },
        client: {
          channels: {
            cache: new Map(),
            fetch: channelFetchFn,
          },
          guilds: { cache: new Map() },
        },
        options: {
          getString: vi.fn(() => null),
        },
      },
      getOption: vi.fn(() => null),
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleBrowse>[0];
  }

  it('should backfill missing guildId for channels', async () => {
    stub.listUserChannels.mockResolvedValue(
      ok({
        settings: [
          {
            channelId: 'channel-1',
            guildId: null,
            personalityId: 'personality-1',
            personalityName: 'Test',
            personalitySlug: 'test',
            createdAt: '2025-06-15T12:00:00.000Z',
          },
        ],
      })
    );
    stub.updateChannelGuild.mockResolvedValue(ok({ updated: true }));
    mockChannelsFetch.mockResolvedValue({ guild: { id: 'backfilled-guild-123' } });

    const context = createMockContextWithFetch(mockChannelsFetch);
    await handleBrowse(context);

    expect(stub.updateChannelGuild).toHaveBeenCalledWith({
      channelId: 'channel-1',
      guildId: 'backfilled-guild-123',
    });
  });

  it('should skip backfill when channel fetch returns null', async () => {
    stub.listUserChannels.mockResolvedValue(
      ok({
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
      })
    );
    mockChannelsFetch.mockResolvedValue(null);

    const context = createMockContextWithFetch(mockChannelsFetch);
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
    expect(stub.updateChannelGuild).not.toHaveBeenCalled();
  });

  it('should handle backfill errors gracefully', async () => {
    stub.listUserChannels.mockResolvedValue(
      ok({
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
      })
    );
    mockChannelsFetch.mockRejectedValue(new Error('Channel not accessible'));

    const context = createMockContextWithFetch(mockChannelsFetch);
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
  });

  it('should skip channels without guild property during backfill', async () => {
    stub.listUserChannels.mockResolvedValue(
      ok({
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
      })
    );
    // DM channel has no guild property.
    mockChannelsFetch.mockResolvedValue({ id: 'dm-channel' });

    const context = createMockContextWithFetch(mockChannelsFetch);
    await handleBrowse(context);

    expect(stub.updateChannelGuild).not.toHaveBeenCalled();
  });
});

describe('buildGuildPages (all-servers view)', () => {
  const mockEditReply = vi.fn();
  let stub: StubClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { isBotOwner } = await import('@tzurot/common-types/utils/ownerMiddleware');
    vi.mocked(isBotOwner).mockReturnValue(true);
    mockRequireManageMessagesContext.mockResolvedValue(true);
    stub = createStubClient();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  function createMockContext(filter: string | null = 'all') {
    return {
      user: { id: '123456789', username: 'testuser' },
      guildId: 'guild-123',
      interaction: {
        user: { id: '123456789', username: 'testuser' },
        client: {
          channels: { cache: new Map() },
          guilds: {
            cache: new Map([
              ['guild-1', { name: 'Server Alpha' }],
              ['guild-2', { name: 'Server Beta' }],
            ]),
          },
        },
        options: {
          getString: vi.fn((name: string) => {
            if (name === 'filter') return filter;
            return null;
          }),
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
    stub.listUserChannels.mockResolvedValue(
      ok({
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
      })
    );

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
    stub.listUserChannels.mockResolvedValue(
      ok({
        settings: [
          {
            channelId: 'channel-orphan',
            guildId: null,
            personalityId: 'p1',
            personalityName: 'Test',
            personalitySlug: 'test',
            createdAt: '2025-06-15T12:00:00.000Z',
          },
        ],
      })
    );

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
