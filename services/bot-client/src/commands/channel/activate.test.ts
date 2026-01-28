/**
 * Tests for /channel activate subcommand
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import type { PermissionsBitField, GuildMember } from 'discord.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { handleActivate } from './activate.js';

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

describe('/channel activate', () => {
  const mockCallGatewayApi = vi.mocked(callGatewayApi);

  /**
   * Create a mock DeferredCommandContext for testing.
   */
  function createMockContext(options: {
    personalitySlug?: string;
    channelId?: string;
    guildId?: string | null;
    hasManageMessages?: boolean;
  }): DeferredCommandContext {
    const {
      personalitySlug = 'test-personality',
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
      interaction: {
        editReply: mockEditReply,
        options: {
          getString: vi.fn((name: string) => {
            if (name === 'personality') return personalitySlug;
            return null;
          }),
        },
      },
      user: { id: 'user-123' },
      guild: guildId !== null ? { id: guildId } : null,
      member: guildId !== null ? mockMember : null,
      channel: null,
      channelId,
      guildId,
      commandName: 'channel',
      isEphemeral: true,
      getOption: vi.fn(),
      getRequiredOption: vi.fn((name: string) => {
        if (name === 'personality') return personalitySlug;
        throw new Error(`Unknown option: ${name}`);
      }),
      getSubcommand: () => 'activate',
      getSubcommandGroup: () => null,
      editReply: mockEditReply,
      followUp: vi.fn(),
      deleteReply: vi.fn(),
    } as unknown as DeferredCommandContext;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should activate a personality successfully', async () => {
    const context = createMockContext({});
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        activation: {
          id: 'activation-123',
          personalitySlug: 'test-personality',
          personalityName: 'Test Personality',
        },
        replaced: false,
      },
    });

    await handleActivate(context);

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/channel/activate', {
      userId: 'user-123',
      method: 'POST',
      body: {
        channelId: '123456789012345678',
        personalitySlug: 'test-personality',
        guildId: '987654321098765432',
      },
    });
    expect(context.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Activated **Test Personality**')
    );
  });

  it('should indicate when replacing an existing activation', async () => {
    const context = createMockContext({});
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        activation: {
          id: 'activation-123',
          personalitySlug: 'test-personality',
          personalityName: 'Test Personality',
        },
        replaced: true,
      },
    });

    await handleActivate(context);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.stringContaining('replaced previous activation')
    );
  });

  it('should reject when not in a guild', async () => {
    const context = createMockContext({ guildId: null });

    await handleActivate(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('only be used in a server'),
    });
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('should reject when user lacks ManageMessages permission', async () => {
    const context = createMockContext({ hasManageMessages: false });

    await handleActivate(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Manage Messages'),
    });
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('should handle 404 - personality not found', async () => {
    const context = createMockContext({});
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: false,
      status: 404,
      error: 'Personality not found',
    });

    await handleActivate(context);

    expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('should handle 403 - no access to personality', async () => {
    const context = createMockContext({});
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Access denied',
    });

    await handleActivate(context);

    expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining("don't have access"));
  });

  it('should handle generic API errors', async () => {
    const context = createMockContext({});
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: 'Internal server error',
    });

    await handleActivate(context);

    expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('Failed to activate'));
  });

  it('should handle unexpected errors', async () => {
    const context = createMockContext({});
    mockCallGatewayApi.mockRejectedValueOnce(new Error('Network error'));

    await handleActivate(context);

    expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('unexpected error'));
  });
});
