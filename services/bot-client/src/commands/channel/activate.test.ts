/**
 * Tests for /channel activate subcommand
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import type { PermissionsBitField, GuildMember } from 'discord.js';
import type { GatewayResult, UserClient } from '@tzurot/clients';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { handleActivate } from './activate.js';

// Mock gateway service calls for cache invalidation
vi.mock('../../utils/gatewayServiceCalls.js', () => ({
  invalidateChannelSettingsCache: vi.fn(),
}));

// Mock service registry
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
  activateChannel: ReturnType<typeof vi.fn>;
}

function createStubClient(): StubClient {
  return { activateChannel: vi.fn() };
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

describe('/channel activate', () => {
  let stub: StubClient;

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

    const mockMember = { permissions: mockPermissions } as GuildMember;
    const mockEditReply = vi.fn().mockResolvedValue(undefined);

    return {
      interaction: {
        editReply: mockEditReply,
        user: { id: 'user-123', username: 'testuser' },
        options: {
          getString: vi.fn((name: string) => {
            if (name === 'character') return personalitySlug;
            return null;
          }),
        },
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
      getRequiredOption: vi.fn((name: string) => {
        if (name === 'character') return personalitySlug;
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
    stub = createStubClient();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  it('should activate a personality successfully', async () => {
    const context = createMockContext({});
    stub.activateChannel.mockResolvedValueOnce(
      ok({
        activation: {
          id: 'activation-123',
          personalitySlug: 'test-personality',
          personalityName: 'Test Personality',
        },
        replaced: false,
      })
    );

    await handleActivate(context);

    expect(stub.activateChannel).toHaveBeenCalledWith({
      channelId: '123456789012345678',
      personalitySlug: 'test-personality',
      guildId: '987654321098765432',
    });
    expect(context.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Activated **Test Personality**')
    );
  });

  it('should indicate when replacing an existing activation', async () => {
    const context = createMockContext({});
    stub.activateChannel.mockResolvedValueOnce(
      ok({
        activation: {
          id: 'activation-123',
          personalitySlug: 'test-personality',
          personalityName: 'Test Personality',
        },
        replaced: true,
      })
    );

    await handleActivate(context);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.stringContaining('replaced previous activation')
    );
  });

  it('should reject when not in a guild', async () => {
    const context = createMockContext({ guildId: null });

    await handleActivate(context);

    // requireManageMessagesContext rejects first (guildId === null), so the
    // editReply call has the `{ content: ... }` shape from that helper, not
    // the bare-string shape from activate.ts's own guard.
    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('server'),
    });
    expect(stub.activateChannel).not.toHaveBeenCalled();
  });

  it('should reject when user lacks ManageMessages permission', async () => {
    const context = createMockContext({ hasManageMessages: false });

    await handleActivate(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Manage Messages'),
    });
    expect(stub.activateChannel).not.toHaveBeenCalled();
  });

  it('should handle 404 - personality not found', async () => {
    const context = createMockContext({});
    stub.activateChannel.mockResolvedValueOnce(err(404, 'Personality not found'));

    await handleActivate(context);

    expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('should handle 403 - no access to personality', async () => {
    const context = createMockContext({});
    stub.activateChannel.mockResolvedValueOnce(err(403, 'Access denied'));

    await handleActivate(context);

    expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('permission to access'));
  });

  it('should handle generic API errors', async () => {
    const context = createMockContext({});
    stub.activateChannel.mockResolvedValueOnce(err(500, 'Internal server error'));

    await handleActivate(context);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Internal server error')
    );
  });

  it('should handle unexpected errors', async () => {
    const context = createMockContext({});
    stub.activateChannel.mockRejectedValueOnce(new Error('Network error'));

    await handleActivate(context);

    expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('Failed to activate'));
  });

  it('rejects the autocomplete-error sentinel before calling the gateway', async () => {
    const context = createMockContext({ personalitySlug: '__autocomplete_error__' });

    await handleActivate(context);

    expect(stub.activateChannel).not.toHaveBeenCalled();
    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Autocomplete was unavailable'),
    });
  });
});
