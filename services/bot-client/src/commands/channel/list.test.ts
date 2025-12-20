/**
 * Tests for /channel list subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbedBuilder, GuildMember, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import type { ChatInputCommandInteraction, Client, Channel, Guild } from 'discord.js';
import { handleList } from './list.js';

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
