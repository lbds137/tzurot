/**
 * Tests for /channel list subcommand
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbedBuilder } from 'discord.js';
import type { Client, Guild } from 'discord.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { handleList, buildGuildPages, CHANNELS_PER_PAGE_ALL_SERVERS } from './list.js';
import type { GuildPage } from './list.js';
import type { ChannelSettings } from '@tzurot/common-types';

// Mock gateway client
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: vi.fn(),
}));

// Mock permissions - use new context-aware version
vi.mock('../../utils/permissions.js', () => ({
  requireManageMessagesContext: vi.fn(),
}));

// Mock logger and requireBotOwner
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    requireBotOwner: vi.fn(),
  };
});

import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { requireManageMessagesContext } from '../../utils/permissions.js';
import { requireBotOwner } from '@tzurot/common-types';

describe('/channel list', () => {
  const mockCallGatewayApi = vi.mocked(callGatewayApi);
  const mockRequireManageMessages = vi.mocked(requireManageMessagesContext);
  const mockRequireBotOwner = vi.mocked(requireBotOwner);

  const MOCK_GUILD_ID = '987654321098765432';

  /**
   * Create a mock DeferredCommandContext for testing.
   */
  function createMockContext(
    options: { showAll?: boolean; guildId?: string | null } = {}
  ): DeferredCommandContext {
    const { showAll = false, guildId = MOCK_GUILD_ID } = options;

    const mockGuild = {
      id: guildId,
      name: 'Test Server',
    } as Guild;

    const mockChannels = {
      cache: new Map([
        ['111111111111111111', { name: 'general', guild: mockGuild }],
        ['222222222222222222', { name: 'chat', guild: mockGuild }],
      ]),
      fetch: vi.fn().mockImplementation(async (channelId: string) => {
        return mockChannels.cache.get(channelId) ?? null;
      }),
    };

    const mockGuilds = {
      cache: new Map([[guildId ?? '', mockGuild]]),
    };

    const mockClient = {
      channels: mockChannels,
      guilds: mockGuilds,
    } as unknown as Client;

    const mockMessage = {
      createMessageComponentCollector: vi.fn().mockReturnValue({
        on: vi.fn(),
      }),
    };

    const mockEditReply = vi.fn().mockResolvedValue(mockMessage);

    return {
      interaction: {
        user: { id: 'user-123' },
        client: mockClient,
        options: {
          getBoolean: vi.fn().mockImplementation((name: string) => {
            if (name === 'all') return showAll;
            return null;
          }),
        },
        editReply: mockEditReply,
      },
      user: { id: 'user-123' },
      guild: guildId !== null ? mockGuild : null,
      member: null,
      channel: null,
      channelId: '123456789012345678',
      guildId,
      commandName: 'channel',
      isEphemeral: true,
      getOption: vi.fn().mockImplementation((name: string) => {
        if (name === 'all') return showAll;
        return null;
      }),
      getRequiredOption: vi.fn(),
      getSubcommand: () => 'list',
      getSubcommandGroup: () => null,
      editReply: mockEditReply,
      followUp: vi.fn(),
      deleteReply: vi.fn(),
    } as unknown as DeferredCommandContext;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: permission check passes
    mockRequireManageMessages.mockResolvedValue(true);
    mockRequireBotOwner.mockResolvedValue(true);
  });

  it('should list channel settings successfully', async () => {
    const context = createMockContext();
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        settings: [
          {
            id: 'settings-1',
            channelId: '111111111111111111',
            guildId: MOCK_GUILD_ID,
            personalitySlug: 'personality-one',
            personalityName: 'Personality One',
            autoRespond: true,
            extendedContext: false,
            activatedBy: 'user-uuid',
            createdAt: '2024-01-01T00:00:00.000Z',
          },
          {
            id: 'settings-2',
            channelId: '222222222222222222',
            guildId: MOCK_GUILD_ID,
            personalitySlug: 'personality-two',
            personalityName: 'Personality Two',
            autoRespond: true,
            extendedContext: false,
            activatedBy: 'user-uuid',
            createdAt: '2024-01-02T00:00:00.000Z',
          },
        ],
      },
    });

    await handleList(context);

    expect(mockRequireManageMessages).toHaveBeenCalledWith(context);
    expect(mockCallGatewayApi).toHaveBeenCalledWith(`/user/channel/list?guildId=${MOCK_GUILD_ID}`, {
      userId: 'user-123',
      method: 'GET',
    });

    // Check that editReply was called with an embed and buttons
    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
        components: expect.any(Array),
      })
    );
  });

  it('should show message when no channel settings exist', async () => {
    const context = createMockContext();
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        settings: [],
      },
    });

    await handleList(context);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.stringContaining('No channels have activated personalities')
    );
  });

  it('should handle API errors', async () => {
    const context = createMockContext();
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Database error',
      status: 500,
    });

    await handleList(context);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Failed to list settings')
    );
  });

  it('should handle unexpected errors', async () => {
    const context = createMockContext();
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleList(context);

    expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('unexpected error'));
  });

  it('should display single channel setting correctly', async () => {
    const context = createMockContext();
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        settings: [
          {
            id: 'settings-1',
            channelId: '111111111111111111',
            guildId: MOCK_GUILD_ID,
            personalitySlug: 'test-char',
            personalityName: 'Test Character',
            autoRespond: true,
            extendedContext: false,
            activatedBy: 'user-uuid',
            createdAt: '2024-06-15T12:00:00.000Z',
          },
        ],
      },
    });

    await handleList(context);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
      })
    );
  });

  it('should return early if Manage Messages permission check fails', async () => {
    const context = createMockContext();
    mockRequireManageMessages.mockResolvedValue(false);

    await handleList(context);

    expect(mockRequireManageMessages).toHaveBeenCalledWith(context);
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('should reject --all flag for non-bot-owner', async () => {
    const context = createMockContext({ showAll: true });
    mockRequireBotOwner.mockResolvedValue(false);

    await handleList(context);

    expect(mockRequireBotOwner).toHaveBeenCalledWith(context.interaction);
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('should fetch all servers when --all flag is used by bot owner', async () => {
    const context = createMockContext({ showAll: true });
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        settings: [
          {
            id: 'settings-1',
            channelId: '111111111111111111',
            guildId: MOCK_GUILD_ID,
            personalitySlug: 'test-char',
            personalityName: 'Test Character',
            autoRespond: true,
            extendedContext: false,
            activatedBy: 'user-uuid',
            createdAt: '2024-06-15T12:00:00.000Z',
          },
        ],
      },
    });

    await handleList(context);

    // Should call without guildId filter
    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/channel/list', {
      userId: 'user-123',
      method: 'GET',
    });
  });
});

describe('buildGuildPages', () => {
  // Helper to create mock channel settings
  function createChannelSetting(
    channelId: string,
    guildId: string | null,
    personalitySlug = 'test-personality'
  ): ChannelSettings {
    return {
      id: `settings-${channelId}`,
      channelId,
      guildId,
      personalitySlug,
      personalityName: `Personality ${channelId}`,
      autoRespond: true,
      extendedContext: false,
      activatedBy: 'user-uuid',
      createdAt: '2024-01-01T00:00:00.000Z',
    };
  }

  // Helper to create mock client with guild cache
  function createMockClient(guilds: { id: string; name: string }[] = []): Client {
    const guildCache = new Map(guilds.map(g => [g.id, g]));
    return {
      guilds: { cache: guildCache },
      channels: { cache: new Map() },
    } as unknown as Client;
  }

  it('should return empty array for empty settings', () => {
    const client = createMockClient();
    const result = buildGuildPages([], client);
    expect(result).toEqual([]);
  });

  it('should create single page for guild with few channels', () => {
    const guildId = 'guild-1';
    const client = createMockClient([{ id: guildId, name: 'Test Server' }]);
    const settings = [
      createChannelSetting('ch-1', guildId),
      createChannelSetting('ch-2', guildId),
      createChannelSetting('ch-3', guildId),
    ];

    const result = buildGuildPages(settings, client);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      guildId,
      guildName: 'Test Server',
      isContinuation: false,
      isComplete: true,
    });
    expect(result[0].settings).toHaveLength(3);
  });

  it('should split large guild across multiple pages', () => {
    const guildId = 'guild-1';
    const client = createMockClient([{ id: guildId, name: 'Big Server' }]);
    // Create more settings than fit on one page
    const settings = Array.from({ length: CHANNELS_PER_PAGE_ALL_SERVERS + 3 }, (_, i) =>
      createChannelSetting(`ch-${i}`, guildId)
    );

    const result = buildGuildPages(settings, client);

    expect(result).toHaveLength(2);

    // First page
    expect(result[0]).toMatchObject({
      guildId,
      guildName: 'Big Server',
      isContinuation: false,
      isComplete: false,
    });
    expect(result[0].settings).toHaveLength(CHANNELS_PER_PAGE_ALL_SERVERS);

    // Second page (continuation)
    expect(result[1]).toMatchObject({
      guildId,
      guildName: 'Big Server',
      isContinuation: true,
      isComplete: true,
    });
    expect(result[1].settings).toHaveLength(3);
  });

  it('should handle multiple guilds with separate pages', () => {
    const guild1 = 'guild-1';
    const guild2 = 'guild-2';
    const client = createMockClient([
      { id: guild1, name: 'Server One' },
      { id: guild2, name: 'Server Two' },
    ]);
    const settings = [
      createChannelSetting('ch-1', guild1),
      createChannelSetting('ch-2', guild1),
      createChannelSetting('ch-3', guild2),
      createChannelSetting('ch-4', guild2),
    ];

    const result = buildGuildPages(settings, client);

    expect(result).toHaveLength(2);
    expect(result[0].guildName).toBe('Server One');
    expect(result[0].settings).toHaveLength(2);
    expect(result[1].guildName).toBe('Server Two');
    expect(result[1].settings).toHaveLength(2);
  });

  it('should handle null guildId as "unknown"', () => {
    const client = createMockClient();
    const settings = [createChannelSetting('ch-1', null), createChannelSetting('ch-2', null)];

    const result = buildGuildPages(settings, client);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      guildId: 'unknown',
      guildName: 'Unknown Server (unknown)',
      isContinuation: false,
      isComplete: true,
    });
  });

  it('should use fallback name for unknown guild IDs', () => {
    const guildId = 'unknown-guild-123';
    const client = createMockClient(); // Empty cache
    const settings = [createChannelSetting('ch-1', guildId)];

    const result = buildGuildPages(settings, client);

    expect(result[0].guildName).toBe(`Unknown Server (${guildId})`);
  });

  it('should handle very large guild spanning 3+ pages', () => {
    const guildId = 'guild-1';
    const client = createMockClient([{ id: guildId, name: 'Huge Server' }]);
    const channelCount = CHANNELS_PER_PAGE_ALL_SERVERS * 2 + 2; // 18 channels with page size 8
    const settings = Array.from({ length: channelCount }, (_, i) =>
      createChannelSetting(`ch-${i}`, guildId)
    );

    const result = buildGuildPages(settings, client);

    expect(result).toHaveLength(3);

    // First page
    expect(result[0].isContinuation).toBe(false);
    expect(result[0].isComplete).toBe(false);

    // Middle page
    expect(result[1].isContinuation).toBe(true);
    expect(result[1].isComplete).toBe(false);

    // Last page
    expect(result[2].isContinuation).toBe(true);
    expect(result[2].isComplete).toBe(true);
    expect(result[2].settings).toHaveLength(2);
  });

  it('should handle mixed guilds where one spans multiple pages', () => {
    const guild1 = 'guild-1';
    const guild2 = 'guild-2';
    const client = createMockClient([
      { id: guild1, name: 'Small Server' },
      { id: guild2, name: 'Big Server' },
    ]);

    // Guild 1 has 2 channels, Guild 2 has 10 (spans 2 pages with page size 8)
    const settings = [
      createChannelSetting('ch-1', guild1),
      createChannelSetting('ch-2', guild1),
      ...Array.from({ length: 10 }, (_, i) => createChannelSetting(`ch-big-${i}`, guild2)),
    ];

    const result = buildGuildPages(settings, client);

    expect(result).toHaveLength(3);
    expect(result[0].guildName).toBe('Small Server');
    expect(result[0].settings).toHaveLength(2);
    expect(result[1].guildName).toBe('Big Server');
    expect(result[1].isContinuation).toBe(false);
    expect(result[2].guildName).toBe('Big Server');
    expect(result[2].isContinuation).toBe(true);
  });
});

/**
 * Integration tests for markdown escaping
 * Verifies that user-provided content is properly escaped when displayed
 */
describe('markdown escaping integration', () => {
  const mockCallGatewayApi = vi.mocked(callGatewayApi);
  const mockRequireManageMessages = vi.mocked(requireManageMessagesContext);

  const MOCK_GUILD_ID = '987654321098765432';

  /**
   * Create a mock DeferredCommandContext for testing.
   */
  function createMockContext(): DeferredCommandContext {
    const mockGuild = {
      id: MOCK_GUILD_ID,
      name: 'Test Server',
    } as Guild;

    const mockChannels = {
      cache: new Map([['111111111111111111', { name: 'general', guild: mockGuild }]]),
      fetch: vi.fn().mockImplementation(async (channelId: string) => {
        return mockChannels.cache.get(channelId) ?? null;
      }),
    };

    const mockGuilds = {
      cache: new Map([[MOCK_GUILD_ID, mockGuild]]),
    };

    const mockClient = {
      channels: mockChannels,
      guilds: mockGuilds,
    } as unknown as Client;

    const mockMessage = {
      createMessageComponentCollector: vi.fn().mockReturnValue({
        on: vi.fn(),
      }),
    };

    const mockEditReply = vi.fn().mockResolvedValue(mockMessage);

    return {
      interaction: {
        user: { id: 'user-123' },
        client: mockClient,
        options: {
          getBoolean: vi.fn().mockReturnValue(false),
        },
        editReply: mockEditReply,
      },
      user: { id: 'user-123' },
      guild: mockGuild,
      member: null,
      channel: null,
      channelId: '123456789012345678',
      guildId: MOCK_GUILD_ID,
      commandName: 'channel',
      isEphemeral: true,
      getOption: vi.fn().mockReturnValue(false),
      getRequiredOption: vi.fn(),
      getSubcommand: () => 'list',
      getSubcommandGroup: () => null,
      editReply: mockEditReply,
      followUp: vi.fn(),
      deleteReply: vi.fn(),
    } as unknown as DeferredCommandContext;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireManageMessages.mockResolvedValue(true);
  });

  it('should escape markdown characters in personality names', async () => {
    const context = createMockContext();
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        settings: [
          {
            id: 'settings-1',
            channelId: '111111111111111111',
            guildId: MOCK_GUILD_ID,
            personalitySlug: 'test-char',
            // Name with markdown characters that could cause formatting issues
            // Note: Discord strikethrough uses ~~ (double tilde), not single ~
            personalityName: '**Bold** _Italic_ ~~Strike~~ `Code`',
            autoRespond: true,
            extendedContext: false,
            activatedBy: 'user-uuid',
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      },
    });

    await handleList(context);

    // Verify editReply was called with an embed
    expect(context.editReply).toHaveBeenCalled();
    const callArgs = vi.mocked(context.editReply).mock.calls[0][0];
    expect(callArgs).toHaveProperty('embeds');

    // Get the embed description and verify markdown is escaped
    const embeds = (callArgs as { embeds: EmbedBuilder[] }).embeds;
    const description = embeds[0].data.description ?? '';

    // The escaped version should NOT render as bold/italic/etc
    // discord.js escapeMarkdown escapes *, _, ~~, ` with backslashes
    expect(description).toContain('\\*\\*Bold\\*\\*');
    expect(description).toContain('\\_Italic\\_');
    expect(description).toContain('\\~\\~Strike\\~\\~');
    expect(description).toContain('\\`Code\\`');
  });

  it('should escape asterisks in personality names to prevent bold formatting', async () => {
    const context = createMockContext();
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        settings: [
          {
            id: 'settings-1',
            channelId: '111111111111111111',
            guildId: MOCK_GUILD_ID,
            personalitySlug: 'star-char',
            personalityName: '*Star* Character',
            autoRespond: true,
            extendedContext: false,
            activatedBy: 'user-uuid',
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      },
    });

    await handleList(context);

    const callArgs = vi.mocked(context.editReply).mock.calls[0][0];
    const embeds = (callArgs as { embeds: EmbedBuilder[] }).embeds;
    const description = embeds[0].data.description ?? '';

    // Asterisks should be escaped to prevent Discord from rendering as italic
    expect(description).toContain('\\*Star\\*');
  });

  it('should handle empty and whitespace-only personality names gracefully', async () => {
    const context = createMockContext();
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        settings: [
          {
            id: 'settings-1',
            channelId: '111111111111111111',
            guildId: MOCK_GUILD_ID,
            personalitySlug: 'empty-name',
            personalityName: '',
            autoRespond: true,
            extendedContext: false,
            activatedBy: 'user-uuid',
            createdAt: '2024-01-01T00:00:00.000Z',
          },
          {
            id: 'settings-2',
            channelId: '222222222222222222',
            guildId: MOCK_GUILD_ID,
            personalitySlug: 'whitespace-name',
            personalityName: '   ',
            autoRespond: true,
            extendedContext: false,
            activatedBy: 'user-uuid',
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      },
    });

    // Should not throw
    await expect(handleList(context)).resolves.not.toThrow();

    // Should still call editReply successfully
    expect(context.editReply).toHaveBeenCalled();
  });
});
