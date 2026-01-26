/**
 * Tests for Admin Servers Subcommand Handler
 *
 * Tests the browse pattern with pagination, select menu, and server details.
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleServers,
  handleServersBrowsePagination,
  handleServersSelect,
  handleServersBack,
  parseBrowseCustomId,
  parseSelectCustomId,
  parseBackCustomId,
  isServersBrowseInteraction,
} from './servers.js';
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

describe('Admin Servers Browse', () => {
  let mockGuilds: Collection<string, Guild>;
  let mockClient: Client;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a proper Collection mock with map() and get() methods
    const guildsMap = new Map<string, Guild>();
    // Store reference to original Map.prototype.get before Object.assign
    const originalGet = guildsMap.get.bind(guildsMap);
    mockGuilds = Object.assign(guildsMap, {
      map: function <T>(fn: (guild: Guild) => T): T[] {
        return Array.from(guildsMap.values()).map(fn);
      },
      get: function (key: string): Guild | undefined {
        return originalGet(key);
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

  /**
   * Create a mock button interaction
   */
  function createMockButtonInteraction(customId: string) {
    return {
      customId,
      client: mockClient,
      user: { id: '123456789' },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as any;
  }

  /**
   * Create a mock select menu interaction
   */
  function createMockSelectInteraction(customId: string, values: string[]) {
    return {
      customId,
      values,
      client: mockClient,
      user: { id: '123456789' },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as any;
  }

  describe('handleServers', () => {
    it('should reply when bot is not in any servers', async () => {
      const context = createMockContext();
      await handleServers(context);

      expect(context.editReply).toHaveBeenCalledWith({
        embeds: [expect.any(Object)],
        components: expect.any(Array),
      });
    });

    it('should show browse page with servers', async () => {
      const mockGuild = {
        id: '123456789',
        name: 'Test Server',
        memberCount: 42,
        ownerId: '111',
        createdAt: new Date(),
        iconURL: () => null,
      } as unknown as Guild;

      mockGuilds.set('123456789', mockGuild);

      const context = createMockContext();
      await handleServers(context);

      expect(context.editReply).toHaveBeenCalledWith({
        embeds: [expect.any(Object)],
        components: expect.arrayContaining([expect.any(Object)]),
      });
    });

    it('should include select menu and pagination buttons', async () => {
      const guild1 = {
        id: '111',
        name: 'Server One',
        memberCount: 10,
        ownerId: '111',
        createdAt: new Date(),
        iconURL: () => null,
      } as unknown as Guild;
      const guild2 = {
        id: '222',
        name: 'Server Two',
        memberCount: 20,
        ownerId: '111',
        createdAt: new Date(),
        iconURL: () => null,
      } as unknown as Guild;

      mockGuilds.set('111', guild1);
      mockGuilds.set('222', guild2);

      const context = createMockContext();
      await handleServers(context);

      // Should have 2 components: select menu + buttons
      const callArgs = vi.mocked(context.editReply).mock.calls[0][0] as {
        embeds: unknown[];
        components: unknown[];
      };
      expect(callArgs.components.length).toBe(2);
    });

    it('should handle errors gracefully', async () => {
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
  });

  describe('handleServersBrowsePagination', () => {
    it('should handle pagination button clicks', async () => {
      const guild = {
        id: '111',
        name: 'Test Server',
        memberCount: 10,
        ownerId: '111',
        createdAt: new Date(),
        iconURL: () => null,
      } as unknown as Guild;
      mockGuilds.set('111', guild);

      const interaction = createMockButtonInteraction('admin-servers::browse::0::members');
      await handleServersBrowsePagination(interaction);

      expect(interaction.deferUpdate).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalled();
    });

    it('should handle sort toggle', async () => {
      const guild = {
        id: '111',
        name: 'Test Server',
        memberCount: 10,
        ownerId: '111',
        createdAt: new Date(),
        iconURL: () => null,
      } as unknown as Guild;
      mockGuilds.set('111', guild);

      const interaction = createMockButtonInteraction('admin-servers::browse::0::name');
      await handleServersBrowsePagination(interaction);

      expect(interaction.deferUpdate).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalled();
    });

    it('should ignore invalid custom IDs', async () => {
      const interaction = createMockButtonInteraction('invalid::custom::id');
      await handleServersBrowsePagination(interaction);

      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });
  });

  describe('handleServersSelect', () => {
    it('should show server details when selected', async () => {
      const guild = {
        id: '111',
        name: 'Test Server',
        memberCount: 42,
        ownerId: '222',
        createdAt: new Date(),
        iconURL: () => 'https://example.com/icon.png',
      } as unknown as Guild;
      mockGuilds.set('111', guild);

      const interaction = createMockSelectInteraction('admin-servers::select::0::members', ['111']);
      await handleServersSelect(interaction);

      expect(interaction.deferUpdate).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [expect.any(Object)],
        components: [expect.any(Object)],
      });
    });

    it('should handle server not found', async () => {
      const interaction = createMockSelectInteraction('admin-servers::select::0::members', [
        'nonexistent',
      ]);
      await handleServersSelect(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '❌ Server not found. It may have been removed.',
        embeds: [],
        components: [],
      });
    });

    it('should ignore invalid custom IDs', async () => {
      const interaction = createMockSelectInteraction('invalid::custom::id', ['111']);
      await handleServersSelect(interaction);

      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });
  });

  describe('handleServersBack', () => {
    it('should return to browse page', async () => {
      const guild = {
        id: '111',
        name: 'Test Server',
        memberCount: 10,
        ownerId: '111',
        createdAt: new Date(),
        iconURL: () => null,
      } as unknown as Guild;
      mockGuilds.set('111', guild);

      const interaction = createMockButtonInteraction('admin-servers::back::0::members');
      await handleServersBack(interaction);

      expect(interaction.deferUpdate).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalled();
    });

    it('should preserve page and sort state', async () => {
      const guild = {
        id: '111',
        name: 'Test Server',
        memberCount: 10,
        ownerId: '111',
        createdAt: new Date(),
        iconURL: () => null,
      } as unknown as Guild;
      mockGuilds.set('111', guild);

      const interaction = createMockButtonInteraction('admin-servers::back::2::name');
      await handleServersBack(interaction);

      expect(interaction.deferUpdate).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalled();
    });

    it('should ignore invalid custom IDs', async () => {
      const interaction = createMockButtonInteraction('invalid::custom::id');
      await handleServersBack(interaction);

      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });
  });

  describe('custom ID parsing', () => {
    describe('parseBrowseCustomId', () => {
      it('should parse valid browse custom IDs', () => {
        expect(parseBrowseCustomId('admin-servers::browse::0::members')).toEqual({
          page: 0,
          sort: 'members',
        });
        expect(parseBrowseCustomId('admin-servers::browse::5::name')).toEqual({
          page: 5,
          sort: 'name',
        });
      });

      it('should return null for invalid custom IDs', () => {
        expect(parseBrowseCustomId('invalid')).toBeNull();
        expect(parseBrowseCustomId('admin-servers::browse')).toBeNull();
        expect(parseBrowseCustomId('admin-servers::browse::invalid::members')).toBeNull();
        expect(parseBrowseCustomId('admin-servers::browse::0::invalid')).toBeNull();
      });
    });

    describe('parseSelectCustomId', () => {
      it('should parse valid select custom IDs', () => {
        expect(parseSelectCustomId('admin-servers::select::0::members')).toEqual({
          page: 0,
          sort: 'members',
        });
        expect(parseSelectCustomId('admin-servers::select::3::name')).toEqual({
          page: 3,
          sort: 'name',
        });
      });

      it('should return null for invalid custom IDs', () => {
        expect(parseSelectCustomId('invalid')).toBeNull();
        expect(parseSelectCustomId('admin-servers::select')).toBeNull();
      });
    });

    describe('parseBackCustomId', () => {
      it('should parse valid back custom IDs', () => {
        expect(parseBackCustomId('admin-servers::back::0::members')).toEqual({
          page: 0,
          sort: 'members',
        });
        expect(parseBackCustomId('admin-servers::back::2::name')).toEqual({
          page: 2,
          sort: 'name',
        });
      });

      it('should return null for invalid custom IDs', () => {
        expect(parseBackCustomId('invalid')).toBeNull();
        expect(parseBackCustomId('admin-servers::back')).toBeNull();
      });
    });

    describe('isServersBrowseInteraction', () => {
      it('should identify servers browse interactions', () => {
        expect(isServersBrowseInteraction('admin-servers::browse::0::members')).toBe(true);
        expect(isServersBrowseInteraction('admin-servers::select::0::members')).toBe(true);
        expect(isServersBrowseInteraction('admin-servers::back::0::members')).toBe(true);
      });

      it('should reject non-servers browse interactions', () => {
        expect(isServersBrowseInteraction('admin-settings::menu')).toBe(false);
        expect(isServersBrowseInteraction('character::browse')).toBe(false);
        expect(isServersBrowseInteraction('random')).toBe(false);
      });
    });
  });

  describe('member count formatting', () => {
    it('should format large member counts with K suffix', async () => {
      const guild = {
        id: '111',
        name: 'Large Server',
        memberCount: 12500,
        ownerId: '111',
        createdAt: new Date(),
        iconURL: () => null,
      } as unknown as Guild;
      mockGuilds.set('111', guild);

      const context = createMockContext();
      await handleServers(context);

      const callArgs = vi.mocked(context.editReply).mock.calls[0][0] as {
        embeds: { data: { description: string } }[];
      };
      const description = callArgs.embeds[0].data.description;
      expect(description).toContain('12.5K');
    });

    it('should format very large member counts with M suffix', async () => {
      const guild = {
        id: '111',
        name: 'Huge Server',
        memberCount: 2500000,
        ownerId: '111',
        createdAt: new Date(),
        iconURL: () => null,
      } as unknown as Guild;
      mockGuilds.set('111', guild);

      const context = createMockContext();
      await handleServers(context);

      const callArgs = vi.mocked(context.editReply).mock.calls[0][0] as {
        embeds: { data: { description: string } }[];
      };
      const description = callArgs.embeds[0].data.description;
      expect(description).toContain('2.5M');
    });
  });

  describe('markdown escaping', () => {
    it('should escape markdown characters in guild names', async () => {
      const mockGuild = {
        id: '123',
        name: '**Bold Server** _with_ `code`',
        memberCount: 42,
        ownerId: '111',
        createdAt: new Date(),
        iconURL: () => null,
      } as unknown as Guild;

      mockGuilds.set('123', mockGuild);

      const context = createMockContext();
      await handleServers(context);

      const callArgs = vi.mocked(context.editReply).mock.calls[0][0] as {
        embeds: { data: { description: string } }[];
      };
      const description = callArgs.embeds[0].data.description;

      // Verify markdown is escaped
      expect(description).toContain('\\*\\*Bold Server\\*\\*');
      expect(description).toContain('\\_with\\_');
      expect(description).toContain('\\`code\\`');
    });
  });
});
