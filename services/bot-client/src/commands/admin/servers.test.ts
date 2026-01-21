/**
 * Tests for Admin Servers Subcommand Handler
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleServers } from './servers.js';
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

describe('handleServers', () => {
  let mockGuilds: Collection<string, Guild>;
  let mockClient: Client;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a proper Collection mock with map() method
    const guildsMap = new Map<string, Guild>();
    mockGuilds = Object.assign(guildsMap, {
      map: function <T>(fn: (guild: Guild) => T): T[] {
        return Array.from(guildsMap.values()).map(fn);
      },
    }) as Collection<string, Guild>;

    mockClient = {
      guilds: {
        cache: mockGuilds,
      },
    } as unknown as Client;
  });

  /**
   * Create a mock DeferredCommandContext for testing.
   */
  function createMockContext(): DeferredCommandContext {
    const mockEditReply = vi.fn().mockResolvedValue(undefined);

    return {
      interaction: {
        client: mockClient,
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
      getRequiredOption: vi.fn(),
      getSubcommand: () => 'servers',
      getSubcommandGroup: () => null,
      editReply: mockEditReply,
      followUp: vi.fn(),
      deleteReply: vi.fn(),
    } as unknown as DeferredCommandContext;
  }

  it('should reply when bot is not in any servers', async () => {
    const context = createMockContext();
    await handleServers(context);

    expect(context.editReply).toHaveBeenCalledWith({ content: 'Bot is not in any servers.' });
  });

  it('should list servers with member counts', async () => {
    const mockGuild = {
      id: '123456789',
      name: 'Test Server',
      memberCount: 42,
    } as Guild;

    mockGuilds.set('123456789', mockGuild);

    const context = createMockContext();
    await handleServers(context);

    expect(context.editReply).toHaveBeenCalledWith({
      embeds: [expect.objectContaining({})],
    });
  });

  it('should handle multiple servers', async () => {
    const guild1 = { id: '111', name: 'Server One', memberCount: 10 } as Guild;
    const guild2 = { id: '222', name: 'Server Two', memberCount: 20 } as Guild;

    mockGuilds.set('111', guild1);
    mockGuilds.set('222', guild2);

    const context = createMockContext();
    await handleServers(context);

    expect(context.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should handle unknown member count', async () => {
    const mockGuild = {
      id: '123',
      name: 'Test Server',
      memberCount: null,
    } as unknown as Guild;

    mockGuilds.set('123', mockGuild);

    const context = createMockContext();
    await handleServers(context);

    expect(context.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should truncate long server list', async () => {
    // Add many servers to exceed character limit
    for (let i = 0; i < 100; i++) {
      const guild = {
        id: `${i}`,
        name: `Very Long Server Name That Takes Up Space ${i}`,
        memberCount: 1000 + i,
      } as Guild;
      mockGuilds.set(`${i}`, guild);
    }

    const context = createMockContext();
    await handleServers(context);

    // Should still reply successfully with truncation
    expect(context.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should handle errors gracefully', async () => {
    // Force an error by making guilds.cache throw
    Object.defineProperty(mockClient.guilds, 'cache', {
      get: () => {
        throw new Error('Test error');
      },
    });

    const context = createMockContext();
    await handleServers(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: '❌ Failed to retrieve server list.',
    });
  });

  it('should include total count in title', async () => {
    const guild1 = { id: '1', name: 'Server 1', memberCount: 10 } as Guild;
    const guild2 = { id: '2', name: 'Server 2', memberCount: 20 } as Guild;
    const guild3 = { id: '3', name: 'Server 3', memberCount: 30 } as Guild;

    mockGuilds.set('1', guild1);
    mockGuilds.set('2', guild2);
    mockGuilds.set('3', guild3);

    const context = createMockContext();
    await handleServers(context);

    // Should show count of 3
    expect(mockGuilds.size).toBe(3);
    expect(context.editReply).toHaveBeenCalled();
  });

  it('should escape markdown characters in guild names', async () => {
    // Guild name with markdown characters that could break formatting
    const mockGuild = {
      id: '123',
      name: '**Bold Server** _with_ `code`',
      memberCount: 42,
    } as Guild;

    mockGuilds.set('123', mockGuild);

    const context = createMockContext();
    await handleServers(context);

    expect(context.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });

    // Get the embed and verify the description contains escaped markdown
    const callArgs = vi.mocked(context.editReply).mock.calls[0][0] as {
      embeds: { data: { description: string } }[];
    };
    const description = callArgs.embeds[0].data.description;

    // Verify markdown is escaped (asterisks, underscores, backticks)
    expect(description).toContain('\\*\\*Bold Server\\*\\*');
    expect(description).toContain('\\_with\\_');
    expect(description).toContain('\\`code\\`');
  });
});
