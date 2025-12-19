/**
 * Tests for /channel deactivate subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import type { ChatInputCommandInteraction, GuildMember, PermissionsBitField } from 'discord.js';
import { handleDeactivate } from './deactivate.js';

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

describe('/channel deactivate', () => {
  const mockCallGatewayApi = vi.mocked(callGatewayApi);

  function createMockInteraction(options: {
    channelId?: string;
    inGuild?: boolean;
    hasManageMessages?: boolean;
  }): ChatInputCommandInteraction {
    const { channelId = '123456789012345678', inGuild = true, hasManageMessages = true } = options;

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
      channelId,
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

  it('should deactivate a channel successfully', async () => {
    const interaction = createMockInteraction({});
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        deactivated: true,
        personalityName: 'Test Personality',
      },
    });

    await handleDeactivate(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/channel/deactivate', {
      userId: 'user-123',
      method: 'DELETE',
      body: {
        channelId: '123456789012345678',
      },
    });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Deactivated **Test Personality**')
    );
  });

  it('should handle when no activation exists', async () => {
    const interaction = createMockInteraction({});
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        deactivated: false,
      },
    });

    await handleDeactivate(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('No personality is currently activated')
    );
  });

  it('should reject when not in a guild', async () => {
    const interaction = createMockInteraction({ inGuild: false });

    await handleDeactivate(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '❌ This command can only be used in a server.',
    });
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('should reject when user lacks ManageMessages permission', async () => {
    const interaction = createMockInteraction({ hasManageMessages: false });

    await handleDeactivate(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '❌ You need the "Manage Messages" permission to use this command.',
    });
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('should handle API errors', async () => {
    const interaction = createMockInteraction({});
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Database error',
      status: 500,
    });

    await handleDeactivate(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Failed to deactivate')
    );
  });

  it('should handle unexpected errors', async () => {
    const interaction = createMockInteraction({});
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleDeactivate(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('unexpected error'));
  });
});
