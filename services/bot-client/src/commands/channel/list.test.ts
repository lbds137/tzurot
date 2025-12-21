/**
 * Tests for /channel list subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbedBuilder, GuildMember, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import type { ChatInputCommandInteraction, Client, Channel, Guild } from 'discord.js';
import { handleList, buildGuildPages, CHANNELS_PER_PAGE_ALL_SERVERS } from './list.js';
import type { GuildPage } from './list.js';
import type { ActivatedChannel } from '@tzurot/common-types';

// Mock gateway client
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: vi.fn(),
}));

// Mock permissions
vi.mock('../../utils/permissions.js', () => ({
  requireManageMessagesDeferred: vi.fn(),
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
import { requireManageMessagesDeferred } from '../../utils/permissions.js';
import { requireBotOwner } from '@tzurot/common-types';

describe('/channel list', () => {
  const mockCallGatewayApi = vi.mocked(callGatewayApi);
  const mockRequireManageMessages = vi.mocked(requireManageMessagesDeferred);
  const mockRequireBotOwner = vi.mocked(requireBotOwner);

  const MOCK_GUILD_ID = '987654321098765432';

  function createMockInteraction(
    options: { showAll?: boolean; guildId?: string | null } = {}
  ): ChatInputCommandInteraction {
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

    return {
      user: { id: 'user-123' },
      guildId,
      client: mockClient,
      options: {
        getBoolean: vi.fn().mockImplementation((name: string) => {
          if (name === 'all') return showAll;
          return null;
        }),
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(mockMessage),
    } as unknown as ChatInputCommandInteraction;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: permission check passes
    mockRequireManageMessages.mockResolvedValue(true);
    mockRequireBotOwner.mockResolvedValue(true);
  });

  it('should list activations successfully', async () => {
    const interaction = createMockInteraction();
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        activations: [
          {
            id: 'activation-1',
            channelId: '111111111111111111',
            guildId: MOCK_GUILD_ID,
            personalitySlug: 'personality-one',
            personalityName: 'Personality One',
            activatedBy: 'user-uuid',
            createdAt: '2024-01-01T00:00:00.000Z',
          },
          {
            id: 'activation-2',
            channelId: '222222222222222222',
            guildId: MOCK_GUILD_ID,
            personalitySlug: 'personality-two',
            personalityName: 'Personality Two',
            activatedBy: 'user-uuid',
            createdAt: '2024-01-02T00:00:00.000Z',
          },
        ],
      },
    });

    await handleList(interaction);

    expect(mockRequireManageMessages).toHaveBeenCalledWith(interaction);
    expect(mockCallGatewayApi).toHaveBeenCalledWith(`/user/channel/list?guildId=${MOCK_GUILD_ID}`, {
      userId: 'user-123',
      method: 'GET',
    });

    // Check that editReply was called with an embed and buttons
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
        components: expect.any(Array),
      })
    );
  });

  it('should show message when no activations exist', async () => {
    const interaction = createMockInteraction();
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        activations: [],
      },
    });

    await handleList(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('No channels have activated personalities')
    );
  });

  it('should handle API errors', async () => {
    const interaction = createMockInteraction();
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Database error',
      status: 500,
    });

    await handleList(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Failed to list activations')
    );
  });

  it('should handle unexpected errors', async () => {
    const interaction = createMockInteraction();
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleList(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('unexpected error'));
  });

  it('should display single activation correctly', async () => {
    const interaction = createMockInteraction();
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        activations: [
          {
            id: 'activation-1',
            channelId: '111111111111111111',
            guildId: MOCK_GUILD_ID,
            personalitySlug: 'test-char',
            personalityName: 'Test Character',
            activatedBy: 'user-uuid',
            createdAt: '2024-06-15T12:00:00.000Z',
          },
        ],
      },
    });

    await handleList(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
      })
    );
  });

  it('should return early if Manage Messages permission check fails', async () => {
    const interaction = createMockInteraction();
    mockRequireManageMessages.mockResolvedValue(false);

    await handleList(interaction);

    expect(mockRequireManageMessages).toHaveBeenCalledWith(interaction);
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('should reject --all flag for non-bot-owner', async () => {
    const interaction = createMockInteraction({ showAll: true });
    mockRequireBotOwner.mockResolvedValue(false);

    await handleList(interaction);

    expect(mockRequireBotOwner).toHaveBeenCalledWith(interaction);
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('should fetch all servers when --all flag is used by bot owner', async () => {
    const interaction = createMockInteraction({ showAll: true });
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        activations: [
          {
            id: 'activation-1',
            channelId: '111111111111111111',
            guildId: MOCK_GUILD_ID,
            personalitySlug: 'test-char',
            personalityName: 'Test Character',
            activatedBy: 'user-uuid',
            createdAt: '2024-06-15T12:00:00.000Z',
          },
        ],
      },
    });

    await handleList(interaction);

    // Should call without guildId filter
    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/channel/list', {
      userId: 'user-123',
      method: 'GET',
    });
  });
});

describe('buildGuildPages', () => {
  // Helper to create mock activation
  function createActivation(
    channelId: string,
    guildId: string | null,
    personalitySlug = 'test-personality'
  ): ActivatedChannel {
    return {
      id: `activation-${channelId}`,
      channelId,
      guildId,
      personalitySlug,
      personalityName: `Personality ${channelId}`,
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

  it('should return empty array for empty activations', () => {
    const client = createMockClient();
    const result = buildGuildPages([], client);
    expect(result).toEqual([]);
  });

  it('should create single page for guild with few channels', () => {
    const guildId = 'guild-1';
    const client = createMockClient([{ id: guildId, name: 'Test Server' }]);
    const activations = [
      createActivation('ch-1', guildId),
      createActivation('ch-2', guildId),
      createActivation('ch-3', guildId),
    ];

    const result = buildGuildPages(activations, client);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      guildId,
      guildName: 'Test Server',
      isContinuation: false,
      isComplete: true,
    });
    expect(result[0].activations).toHaveLength(3);
  });

  it('should split large guild across multiple pages', () => {
    const guildId = 'guild-1';
    const client = createMockClient([{ id: guildId, name: 'Big Server' }]);
    // Create more activations than fit on one page
    const activations = Array.from({ length: CHANNELS_PER_PAGE_ALL_SERVERS + 3 }, (_, i) =>
      createActivation(`ch-${i}`, guildId)
    );

    const result = buildGuildPages(activations, client);

    expect(result).toHaveLength(2);

    // First page
    expect(result[0]).toMatchObject({
      guildId,
      guildName: 'Big Server',
      isContinuation: false,
      isComplete: false,
    });
    expect(result[0].activations).toHaveLength(CHANNELS_PER_PAGE_ALL_SERVERS);

    // Second page (continuation)
    expect(result[1]).toMatchObject({
      guildId,
      guildName: 'Big Server',
      isContinuation: true,
      isComplete: true,
    });
    expect(result[1].activations).toHaveLength(3);
  });

  it('should handle multiple guilds with separate pages', () => {
    const guild1 = 'guild-1';
    const guild2 = 'guild-2';
    const client = createMockClient([
      { id: guild1, name: 'Server One' },
      { id: guild2, name: 'Server Two' },
    ]);
    const activations = [
      createActivation('ch-1', guild1),
      createActivation('ch-2', guild1),
      createActivation('ch-3', guild2),
      createActivation('ch-4', guild2),
    ];

    const result = buildGuildPages(activations, client);

    expect(result).toHaveLength(2);
    expect(result[0].guildName).toBe('Server One');
    expect(result[0].activations).toHaveLength(2);
    expect(result[1].guildName).toBe('Server Two');
    expect(result[1].activations).toHaveLength(2);
  });

  it('should handle null guildId as "unknown"', () => {
    const client = createMockClient();
    const activations = [
      createActivation('ch-1', null),
      createActivation('ch-2', null),
    ];

    const result = buildGuildPages(activations, client);

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
    const activations = [createActivation('ch-1', guildId)];

    const result = buildGuildPages(activations, client);

    expect(result[0].guildName).toBe(`Unknown Server (${guildId})`);
  });

  it('should handle very large guild spanning 3+ pages', () => {
    const guildId = 'guild-1';
    const client = createMockClient([{ id: guildId, name: 'Huge Server' }]);
    const channelCount = CHANNELS_PER_PAGE_ALL_SERVERS * 2 + 2; // 18 channels with page size 8
    const activations = Array.from({ length: channelCount }, (_, i) =>
      createActivation(`ch-${i}`, guildId)
    );

    const result = buildGuildPages(activations, client);

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
    expect(result[2].activations).toHaveLength(2);
  });

  it('should handle mixed guilds where one spans multiple pages', () => {
    const guild1 = 'guild-1';
    const guild2 = 'guild-2';
    const client = createMockClient([
      { id: guild1, name: 'Small Server' },
      { id: guild2, name: 'Big Server' },
    ]);

    // Guild 1 has 2 channels, Guild 2 has 10 (spans 2 pages with page size 8)
    const activations = [
      createActivation('ch-1', guild1),
      createActivation('ch-2', guild1),
      ...Array.from({ length: 10 }, (_, i) => createActivation(`ch-big-${i}`, guild2)),
    ];

    const result = buildGuildPages(activations, client);

    expect(result).toHaveLength(3);
    expect(result[0].guildName).toBe('Small Server');
    expect(result[0].activations).toHaveLength(2);
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
  const mockRequireManageMessages = vi.mocked(requireManageMessagesDeferred);

  const MOCK_GUILD_ID = '987654321098765432';

  function createMockInteraction(): ChatInputCommandInteraction {
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

    return {
      user: { id: 'user-123' },
      guildId: MOCK_GUILD_ID,
      client: mockClient,
      options: {
        getBoolean: vi.fn().mockReturnValue(false),
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(mockMessage),
    } as unknown as ChatInputCommandInteraction;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireManageMessages.mockResolvedValue(true);
  });

  it('should escape markdown characters in personality names', async () => {
    const interaction = createMockInteraction();
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        activations: [
          {
            id: 'activation-1',
            channelId: '111111111111111111',
            guildId: MOCK_GUILD_ID,
            personalitySlug: 'test-char',
            // Name with markdown characters that could cause formatting issues
            // Note: Discord strikethrough uses ~~ (double tilde), not single ~
            personalityName: '**Bold** _Italic_ ~~Strike~~ `Code`',
            activatedBy: 'user-uuid',
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      },
    });

    await handleList(interaction);

    // Verify editReply was called with an embed
    expect(interaction.editReply).toHaveBeenCalled();
    const callArgs = vi.mocked(interaction.editReply).mock.calls[0][0];
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
    const interaction = createMockInteraction();
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        activations: [
          {
            id: 'activation-1',
            channelId: '111111111111111111',
            guildId: MOCK_GUILD_ID,
            personalitySlug: 'star-char',
            personalityName: '*Star* Character',
            activatedBy: 'user-uuid',
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      },
    });

    await handleList(interaction);

    const callArgs = vi.mocked(interaction.editReply).mock.calls[0][0];
    const embeds = (callArgs as { embeds: EmbedBuilder[] }).embeds;
    const description = embeds[0].data.description ?? '';

    // Asterisks should be escaped to prevent Discord from rendering as italic
    expect(description).toContain('\\*Star\\*');
  });
});
