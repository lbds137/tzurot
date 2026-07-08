/**
 * Tests for /channel deactivate subcommand
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import type { PermissionsBitField, GuildMember } from 'discord.js';
import type { GatewayResult, UserClient } from '@tzurot/clients';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { handleDeactivate } from './deactivate.js';

vi.mock('../../utils/gatewayServiceCalls.js', () => ({
  invalidateChannelSettingsCache: vi.fn(),
}));

vi.mock('../../services/serviceRegistry.js', () => ({
  getChannelActivationCacheInvalidationService: vi.fn().mockReturnValue({
    invalidateChannel: vi.fn(),
  }),
}));

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

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

interface StubClient {
  deactivateChannel: ReturnType<typeof vi.fn>;
}

function createStubClient(): StubClient {
  return { deactivateChannel: vi.fn() };
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

describe('/channel deactivate', () => {
  let stub: StubClient;

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

    const mockMember = { permissions: mockPermissions } as GuildMember;
    const mockEditReply = vi.fn().mockResolvedValue(undefined);

    return {
      interaction: {
        editReply: mockEditReply,
        user: { id: 'user-123', username: 'testuser' },
      },
      user: { id: 'user-123', username: 'testuser' },
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
    stub = createStubClient();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  it('should deactivate a channel successfully', async () => {
    const context = createMockContext({});
    stub.deactivateChannel.mockResolvedValue(
      ok({ deactivated: true, personalityName: 'Test Personality' })
    );

    await handleDeactivate(context);

    expect(stub.deactivateChannel).toHaveBeenCalledWith({ channelId: '123456789012345678' });
    expect(context.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Deactivated **Test Personality**')
    );
  });

  it('should handle when no activation exists', async () => {
    const context = createMockContext({});
    stub.deactivateChannel.mockResolvedValue(ok({ deactivated: false }));

    await handleDeactivate(context);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.stringContaining('No character is currently activated')
    );
  });

  it('should reject when not in a guild', async () => {
    const context = createMockContext({ guildId: null });

    await handleDeactivate(context);

    // requireManageMessagesContext rejects first when guildId is null.
    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('server'),
    });
    expect(stub.deactivateChannel).not.toHaveBeenCalled();
  });

  it('should reject when user lacks ManageMessages permission', async () => {
    const context = createMockContext({ hasManageMessages: false });

    await handleDeactivate(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Manage Messages'),
    });
    expect(stub.deactivateChannel).not.toHaveBeenCalled();
  });

  it('should handle API errors', async () => {
    const context = createMockContext({});
    stub.deactivateChannel.mockResolvedValue(err(500, 'Database error'));

    await handleDeactivate(context);

    expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('Database error'));
  });

  it('should handle unexpected errors', async () => {
    const context = createMockContext({});
    stub.deactivateChannel.mockRejectedValue(new Error('Network error'));

    await handleDeactivate(context);

    expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('Failed to deactivate'));
  });
});
