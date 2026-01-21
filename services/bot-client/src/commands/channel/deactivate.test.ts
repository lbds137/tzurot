/**
 * Tests for /channel deactivate subcommand
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import type { PermissionsBitField, GuildMember } from 'discord.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { handleDeactivate } from './deactivate.js';

// Mock gateway client
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: vi.fn(),
}));

// Mock GatewayClient for cache invalidation
vi.mock('../../utils/GatewayClient.js', () => ({
  invalidateChannelSettingsCache: vi.fn(),
}));

// Mock service registry
vi.mock('../../services/serviceRegistry.js', () => ({
  getChannelActivationCacheInvalidationService: vi.fn().mockReturnValue({
    invalidateChannel: vi.fn(),
  }),
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

  /**
   * Create a mock DeferredCommandContext for testing.
   */
  function createMockContext(options: {
    channelId?: string;
    guildId?: string | null;
    hasManageMessages?: boolean;
  }): DeferredCommandContext {
    const {
      channelId = '123456789012345678',
      guildId = '987654321098765432',
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

    const mockEditReply = vi.fn().mockResolvedValue(undefined);

    return {
      interaction: { editReply: mockEditReply },
      user: { id: 'user-123' },
      guild: guildId !== null ? { id: guildId } : null,
      member: guildId !== null ? mockMember : null,
      channel: null,
      channelId,
      guildId,
      commandName: 'channel',
      isEphemeral: true,
      getOption: vi.fn(),
      getRequiredOption: vi.fn(),
      getSubcommand: () => 'deactivate',
      getSubcommandGroup: () => null,
      editReply: mockEditReply,
      followUp: vi.fn(),
      deleteReply: vi.fn(),
    } as unknown as DeferredCommandContext;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should deactivate a channel successfully', async () => {
    const context = createMockContext({});
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        deactivated: true,
        personalityName: 'Test Personality',
      },
    });

    await handleDeactivate(context);

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/channel/deactivate', {
      userId: 'user-123',
      method: 'DELETE',
      body: {
        channelId: '123456789012345678',
      },
    });
    expect(context.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Deactivated **Test Personality**')
    );
  });

  it('should handle when no activation exists', async () => {
    const context = createMockContext({});
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        deactivated: false,
      },
    });

    await handleDeactivate(context);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.stringContaining('No personality is currently activated')
    );
  });

  it('should reject when not in a guild', async () => {
    const context = createMockContext({ guildId: null });

    await handleDeactivate(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: '❌ This command can only be used in a server.',
    });
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('should reject when user lacks ManageMessages permission', async () => {
    const context = createMockContext({ hasManageMessages: false });

    await handleDeactivate(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: '❌ You need the "Manage Messages" permission to use this command.',
    });
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('should handle API errors', async () => {
    const context = createMockContext({});
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Database error',
      status: 500,
    });

    await handleDeactivate(context);

    expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('Failed to deactivate'));
  });

  it('should handle unexpected errors', async () => {
    const context = createMockContext({});
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleDeactivate(context);

    expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('unexpected error'));
  });
});
