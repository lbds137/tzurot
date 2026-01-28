/**
 * Tests for Admin Kick Subcommand Handler
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleKick } from './kick.js';
import type { ChatInputCommandInteraction, Client, Collection, Guild } from 'discord.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

// Mock logger
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

describe('handleKick', () => {
  let mockGuilds: Collection<string, Guild>;
  let mockClient: Client;

  beforeEach(() => {
    vi.clearAllMocks();

    mockGuilds = new Map() as Collection<string, Guild>;

    mockClient = {
      guilds: {
        cache: mockGuilds,
      },
    } as unknown as Client;
  });

  /**
   * Create a mock DeferredCommandContext for testing.
   */
  function createMockContext(serverId: string): DeferredCommandContext {
    const mockEditReply = vi.fn().mockResolvedValue(undefined);

    return {
      interaction: {
        client: mockClient,
        options: {
          getString: vi.fn((name: string) => {
            if (name === 'server-id') return serverId;
            return null;
          }),
          getBoolean: vi.fn(() => null),
          getInteger: vi.fn(() => null),
        },
      } as unknown as ChatInputCommandInteraction,
      user: { id: '123456789' },
      guild: null,
      member: null,
      channel: null,
      channelId: 'channel-123',
      guildId: null,
      commandName: 'admin',
      isEphemeral: true,
      getOption: vi.fn(),
      getRequiredOption: vi.fn((name: string) => {
        if (name === 'server-id') return serverId;
        throw new Error(`Unknown required option: ${name}`);
      }),
      getSubcommand: () => 'kick',
      getSubcommandGroup: () => null,
      editReply: mockEditReply,
      followUp: vi.fn(),
      deleteReply: vi.fn(),
    } as unknown as DeferredCommandContext;
  }

  it('should reply with error when server not found', async () => {
    const serverId = '999';
    const context = createMockContext(serverId);
    await handleKick(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content:
        `❌ Bot is not in a server with ID \`${serverId}\`.\n\n` +
        'Use `/admin servers` to see a list of all servers.',
    });
  });

  it('should successfully leave server', async () => {
    const serverId = '123';
    const serverName = 'Test Server';

    const mockGuild = {
      id: serverId,
      name: serverName,
      leave: vi.fn().mockResolvedValue(undefined),
    } as unknown as Guild;

    mockGuilds.set(serverId, mockGuild);

    const context = createMockContext(serverId);
    await handleKick(context);

    expect(mockGuild.leave).toHaveBeenCalled();
    expect(context.editReply).toHaveBeenCalledWith({
      content: `✅ Successfully left server: **${serverName}** (\`${serverId}\`)`,
    });
  });

  it('should handle errors when leaving server fails', async () => {
    const serverId = '123';
    const serverName = 'Test Server';

    const mockGuild = {
      id: serverId,
      name: serverName,
      leave: vi.fn().mockRejectedValue(new Error('Permission denied')),
    } as unknown as Guild;

    mockGuilds.set(serverId, mockGuild);

    const context = createMockContext(serverId);
    await handleKick(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content:
        `❌ Failed to leave server \`${serverId}\`.\n\n` +
        'The server may no longer exist or bot may lack permissions.',
    });
  });

  it('should handle server with special characters in name', async () => {
    const serverId = '456';
    const serverName = 'Server™ with "quotes" & special <chars>';

    const mockGuild = {
      id: serverId,
      name: serverName,
      leave: vi.fn().mockResolvedValue(undefined),
    } as unknown as Guild;

    mockGuilds.set(serverId, mockGuild);

    const context = createMockContext(serverId);
    await handleKick(context);

    expect(mockGuild.leave).toHaveBeenCalled();
    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining(serverName),
    });
  });
});
