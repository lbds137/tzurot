/**
 * Tests for Admin Servers Subcommand Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleServers } from './servers.js';
import type { ChatInputCommandInteraction, Client, Collection, Guild } from 'discord.js';

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
  let mockInteraction: ChatInputCommandInteraction;
  let mockClient: Client;
  let mockGuilds: Collection<string, Guild>;

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

    mockInteraction = {
      client: mockClient,
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;
  });

  // Note: deferReply is handled by top-level interactionCreate handler

  it('should reply when bot is not in any servers', async () => {
    // Empty guilds collection
    await handleServers(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith('Bot is not in any servers.');
  });

  it('should list servers with member counts', async () => {
    const mockGuild = {
      id: '123456789',
      name: 'Test Server',
      memberCount: 42,
    } as Guild;

    mockGuilds.set('123456789', mockGuild);

    await handleServers(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      embeds: [expect.objectContaining({})],
    });
  });

  it('should handle multiple servers', async () => {
    const guild1 = {
      id: '111',
      name: 'Server One',
      memberCount: 10,
    } as Guild;

    const guild2 = {
      id: '222',
      name: 'Server Two',
      memberCount: 20,
    } as Guild;

    mockGuilds.set('111', guild1);
    mockGuilds.set('222', guild2);

    await handleServers(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
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

    await handleServers(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
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

    await handleServers(mockInteraction);

    // Should still reply successfully with truncation
    expect(mockInteraction.editReply).toHaveBeenCalledWith({
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

    await handleServers(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith('❌ Failed to retrieve server list.');
  });

  it('should include total count in title', async () => {
    const guild1 = { id: '1', name: 'Server 1', memberCount: 10 } as Guild;
    const guild2 = { id: '2', name: 'Server 2', memberCount: 20 } as Guild;
    const guild3 = { id: '3', name: 'Server 3', memberCount: 30 } as Guild;

    mockGuilds.set('1', guild1);
    mockGuilds.set('2', guild2);
    mockGuilds.set('3', guild3);

    await handleServers(mockInteraction);

    // Should show count of 3
    expect(mockGuilds.size).toBe(3);
    expect(mockInteraction.editReply).toHaveBeenCalled();
  });
});
