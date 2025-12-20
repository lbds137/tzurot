/**
 * Tests for Admin Kick Subcommand Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleKick } from './kick.js';
import type { ChatInputCommandInteraction, Client, Collection, Guild, User } from 'discord.js';

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
  let mockInteraction: ChatInputCommandInteraction;
  let mockClient: Client;
  let mockGuilds: Collection<string, Guild>;
  let mockUser: User;

  beforeEach(() => {
    vi.clearAllMocks();

    mockGuilds = new Map() as Collection<string, Guild>;

    mockClient = {
      guilds: {
        cache: mockGuilds,
      },
    } as unknown as Client;

    mockUser = {
      tag: 'TestUser#1234',
    } as User;

    mockInteraction = {
      client: mockClient,
      user: mockUser,
      options: {
        getString: vi.fn(),
      },
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;
  });

  // Note: deferReply is handled by top-level interactionCreate handler

  it('should get server-id from options as required', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue('server-123');

    await handleKick(mockInteraction);

    expect(mockInteraction.options.getString).toHaveBeenCalledWith('server-id', true);
  });

  it('should reply with error when server not found', async () => {
    const serverId = '999';
    vi.mocked(mockInteraction.options.getString).mockReturnValue(serverId);

    await handleKick(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      `❌ Bot is not in a server with ID \`${serverId}\`.\n\n` +
        'Use `/admin servers` to see a list of all servers.'
    );
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
    vi.mocked(mockInteraction.options.getString).mockReturnValue(serverId);

    await handleKick(mockInteraction);

    expect(mockGuild.leave).toHaveBeenCalled();
    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      `✅ Successfully left server: **${serverName}** (\`${serverId}\`)`
    );
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
    vi.mocked(mockInteraction.options.getString).mockReturnValue(serverId);

    await handleKick(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      `❌ Failed to leave server \`${serverId}\`.\n\n` +
        'The server may no longer exist or bot may lack permissions.'
    );
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
    vi.mocked(mockInteraction.options.getString).mockReturnValue(serverId);

    await handleKick(mockInteraction);

    expect(mockGuild.leave).toHaveBeenCalled();
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.stringContaining(serverName));
  });
});
