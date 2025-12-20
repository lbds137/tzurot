/**
 * Tests for /channel activate subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import type { ChatInputCommandInteraction, GuildMember, PermissionsBitField } from 'discord.js';
import { handleActivate } from './activate.js';

// Mock gateway client
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: vi.fn(),
}));

// Mock logger
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
  };
});

import { callGatewayApi } from '../../utils/userGatewayClient.js';

describe('/channel activate', () => {
  const mockCallGatewayApi = vi.mocked(callGatewayApi);

  function createMockInteraction(options: {
    personalitySlug?: string;
    channelId?: string;
    guildId?: string | null;
    inGuild?: boolean;
    hasManageMessages?: boolean;
  }): ChatInputCommandInteraction {
    const {
      personalitySlug = 'test-personality',
      channelId = '123456789012345678',
      guildId = '987654321098765432',
      inGuild = true,
      hasManageMessages = true,
    } = options;

    const mockPermissions = {
      has: vi.fn((permission: bigint) => {
        if (permission === PermissionFlagsBits.ManageMessages) {
          return hasManageMessages;
        }
        return false;
      }),
    } as unknown as PermissionsBitField;

    const mockMember = {
      permissions: mockPermissions,
    } as GuildMember;

    return {
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'personality') return personalitySlug;
          return null;
        }),
      },
      channelId,
      guildId,
      user: { id: 'user-123' },
      member: mockMember,
      inGuild: vi.fn().mockReturnValue(inGuild),
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should activate a personality successfully', async () => {
    const interaction = createMockInteraction({});
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        activation: {
          id: 'activation-uuid',
          channelId: '123456789012345678',
          personalitySlug: 'test-personality',
          personalityName: 'Test Personality',
          activatedBy: 'user-uuid',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
        replaced: false,
      },
    });

    await handleActivate(interaction);

    // deferReply is now handled at top-level interactionCreate handler
    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/channel/activate', {
      userId: 'user-123',
      method: 'POST',
      body: {
        channelId: '123456789012345678',
        personalitySlug: 'test-personality',
        guildId: '987654321098765432',
      },
    });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Activated **Test Personality**')
    );
  });

  it('should indicate when replacing an existing activation', async () => {
    const interaction = createMockInteraction({});
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        activation: {
          id: 'activation-uuid',
          channelId: '123456789012345678',
          personalitySlug: 'new-personality',
          personalityName: 'New Personality',
          activatedBy: 'user-uuid',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
        replaced: true,
      },
    });

    await handleActivate(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('replaced previous activation')
    );
  });

  it('should reject when not in a guild', async () => {
    const interaction = createMockInteraction({ inGuild: false });

    await handleActivate(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '❌ This command can only be used in a server.',
    });
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('should reject when user lacks ManageMessages permission', async () => {
    const interaction = createMockInteraction({ hasManageMessages: false });

    await handleActivate(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '❌ You need the "Manage Messages" permission to use this command.',
    });
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('should handle 404 - personality not found', async () => {
    const interaction = createMockInteraction({});
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'NOT_FOUND',
      status: 404,
    });

    await handleActivate(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('should handle 403 - no access to personality', async () => {
    const interaction = createMockInteraction({});
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'UNAUTHORIZED',
      status: 403,
    });

    await handleActivate(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("don't have access")
    );
  });

  it('should handle generic API errors', async () => {
    const interaction = createMockInteraction({});
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Internal server error',
      status: 500,
    });

    await handleActivate(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Failed to activate')
    );
  });

  it('should handle unexpected errors', async () => {
    const interaction = createMockInteraction({});
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleActivate(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('unexpected error'));
  });
});
