/**
 * Tests for Admin Command Router
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { data, execute, autocomplete } from './index.js';
import type {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  Collection,
  Guild,
} from 'discord.js';
import { MessageFlags } from 'discord.js';

// Mock fetch
global.fetch = vi.fn();

// Mock requireBotOwner middleware
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    requireBotOwner: vi.fn(),
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

// Mock subcommand handlers
vi.mock('./db-sync.js', () => ({
  handleDbSync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./servers.js', () => ({
  handleServers: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./kick.js', () => ({
  handleKick: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./usage.js', () => ({
  handleUsage: vi.fn().mockResolvedValue(undefined),
}));

import { requireBotOwner } from '@tzurot/common-types';
import { handleDbSync } from './db-sync.js';
import { handleServers } from './servers.js';
import { handleKick } from './kick.js';
import { handleUsage } from './usage.js';

describe('admin command', () => {
  describe('data (SlashCommandBuilder)', () => {
    it('should have correct command name and description', () => {
      expect(data.name).toBe('admin');
      expect(data.description).toBe('Admin commands (Owner only)');
    });

    it('should have db-sync subcommand', () => {
      const options = data.options ?? [];
      const dbSyncSubcommand = options.find(opt => 'name' in opt && opt.name === 'db-sync');

      expect(dbSyncSubcommand).toBeDefined();
      if (dbSyncSubcommand && 'name' in dbSyncSubcommand && 'description' in dbSyncSubcommand) {
        expect(dbSyncSubcommand.name).toBe('db-sync');
        expect(dbSyncSubcommand.description).toBe('Trigger bidirectional database synchronization');
      }
    });

    it('should have servers subcommand', () => {
      const options = data.options ?? [];
      const serversSubcommand = options.find(opt => 'name' in opt && opt.name === 'servers');

      expect(serversSubcommand).toBeDefined();
      if (serversSubcommand && 'name' in serversSubcommand && 'description' in serversSubcommand) {
        expect(serversSubcommand.name).toBe('servers');
        expect(serversSubcommand.description).toBe('List all servers the bot is in');
      }
    });

    it('should have kick subcommand', () => {
      const options = data.options ?? [];
      const kickSubcommand = options.find(opt => 'name' in opt && opt.name === 'kick');

      expect(kickSubcommand).toBeDefined();
      if (kickSubcommand && 'name' in kickSubcommand && 'description' in kickSubcommand) {
        expect(kickSubcommand.name).toBe('kick');
        expect(kickSubcommand.description).toBe('Remove the bot from a server');
      }
    });

    it('should have usage subcommand', () => {
      const options = data.options ?? [];
      const usageSubcommand = options.find(opt => 'name' in opt && opt.name === 'usage');

      expect(usageSubcommand).toBeDefined();
      if (usageSubcommand && 'name' in usageSubcommand && 'description' in usageSubcommand) {
        expect(usageSubcommand.name).toBe('usage');
        expect(usageSubcommand.description).toBe('View API usage statistics');
      }
    });
  });

  describe('execute (router)', () => {
    let mockInteraction: ChatInputCommandInteraction;

    beforeEach(() => {
      vi.clearAllMocks();

      mockInteraction = {
        user: { id: 'test-user-id' },
        options: {
          getSubcommand: vi.fn(),
        },
        reply: vi.fn().mockResolvedValue(undefined),
        isModalSubmit: vi.fn().mockReturnValue(false),
      } as unknown as ChatInputCommandInteraction;
    });

    it('should check owner permission before executing', async () => {
      vi.mocked(requireBotOwner).mockResolvedValue(false);

      await execute(mockInteraction);

      expect(requireBotOwner).toHaveBeenCalledWith(mockInteraction);
      // Should not call any handlers
      expect(handleDbSync).not.toHaveBeenCalled();
      expect(handleServers).not.toHaveBeenCalled();
      expect(handleKick).not.toHaveBeenCalled();
      expect(handleUsage).not.toHaveBeenCalled();
    });

    it('should route to handleDbSync for db-sync subcommand', async () => {
      vi.mocked(requireBotOwner).mockResolvedValue(true);
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('db-sync');

      await execute(mockInteraction);

      expect(handleDbSync).toHaveBeenCalledWith(mockInteraction);
      expect(handleServers).not.toHaveBeenCalled();
      expect(handleKick).not.toHaveBeenCalled();
      expect(handleUsage).not.toHaveBeenCalled();
    });

    it('should route to handleServers for servers subcommand', async () => {
      vi.mocked(requireBotOwner).mockResolvedValue(true);
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('servers');

      await execute(mockInteraction);

      expect(handleServers).toHaveBeenCalledWith(mockInteraction);
      expect(handleDbSync).not.toHaveBeenCalled();
      expect(handleKick).not.toHaveBeenCalled();
      expect(handleUsage).not.toHaveBeenCalled();
    });

    it('should route to handleKick for kick subcommand', async () => {
      vi.mocked(requireBotOwner).mockResolvedValue(true);
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('kick');

      await execute(mockInteraction);

      expect(handleKick).toHaveBeenCalledWith(mockInteraction);
      expect(handleDbSync).not.toHaveBeenCalled();
      expect(handleServers).not.toHaveBeenCalled();
      expect(handleUsage).not.toHaveBeenCalled();
    });

    it('should route to handleUsage for usage subcommand', async () => {
      vi.mocked(requireBotOwner).mockResolvedValue(true);
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('usage');

      await execute(mockInteraction);

      expect(handleUsage).toHaveBeenCalledWith(mockInteraction);
      expect(handleDbSync).not.toHaveBeenCalled();
      expect(handleServers).not.toHaveBeenCalled();
      expect(handleKick).not.toHaveBeenCalled();
    });

    it('should handle unknown subcommand', async () => {
      vi.mocked(requireBotOwner).mockResolvedValue(true);
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('unknown');

      await execute(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: '❌ Unknown subcommand',
        flags: MessageFlags.Ephemeral,
      });
      expect(handleDbSync).not.toHaveBeenCalled();
      expect(handleServers).not.toHaveBeenCalled();
      expect(handleKick).not.toHaveBeenCalled();
      expect(handleUsage).not.toHaveBeenCalled();
    });

    it('should route handlers without passing config directly', async () => {
      vi.mocked(requireBotOwner).mockResolvedValue(true);
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('db-sync');

      await execute(mockInteraction);

      // Handlers now get config internally via centralized adminApiClient
      expect(handleDbSync).toHaveBeenCalledWith(mockInteraction);
    });
  });

  describe('autocomplete', () => {
    let mockAutocompleteInteraction: AutocompleteInteraction;

    beforeEach(() => {
      vi.clearAllMocks();

      mockAutocompleteInteraction = {
        options: {
          getFocused: vi.fn(),
          getSubcommand: vi.fn().mockReturnValue('kick'),
        },
        respond: vi.fn().mockResolvedValue(undefined),
        client: {
          guilds: {
            cache: new Map() as unknown as Collection<string, Guild>,
          },
        },
        user: { id: 'test-user' },
        guildId: 'test-guild',
        commandName: 'admin',
      } as unknown as AutocompleteInteraction;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    describe('server-id autocomplete', () => {
      it('should respond with filtered servers', async () => {
        vi.mocked(mockAutocompleteInteraction.options.getFocused).mockReturnValue({
          name: 'server-id',
          value: 'test',
        });

        // Create a mock guilds cache with filter, map, and slice methods
        const mockGuilds = [
          { id: 'guild-1', name: 'Test Server', memberCount: 100 },
          { id: 'guild-2', name: 'Other Server', memberCount: 50 },
        ];

        const mockCache = {
          filter: vi.fn((fn: (g: (typeof mockGuilds)[0]) => boolean) => ({
            map: vi.fn((mapFn: (g: (typeof mockGuilds)[0]) => { name: string; value: string }) =>
              mockGuilds.filter(fn).map(mapFn)
            ),
          })),
        };

        mockAutocompleteInteraction.client.guilds.cache = mockCache as unknown as Collection<
          string,
          Guild
        >;

        // Make filter return only 'Test Server' when querying 'test'
        mockCache.filter.mockImplementation((fn: (g: (typeof mockGuilds)[0]) => boolean) => ({
          map: (mapFn: (g: (typeof mockGuilds)[0]) => { name: string; value: string }) => {
            const filtered = mockGuilds.filter(g => g.name.toLowerCase().includes('test'));
            return {
              slice: () => filtered.map(mapFn),
            };
          },
        }));

        await autocomplete(mockAutocompleteInteraction);

        expect(mockAutocompleteInteraction.respond).toHaveBeenCalledWith([
          { name: 'Test Server (100 members)', value: 'guild-1' },
        ]);
      });
    });

    describe('unknown option', () => {
      it('should respond with empty array for unknown option', async () => {
        vi.mocked(mockAutocompleteInteraction.options.getFocused).mockReturnValue({
          name: 'unknown',
          value: 'test',
        });

        await autocomplete(mockAutocompleteInteraction);

        expect(mockAutocompleteInteraction.respond).toHaveBeenCalledWith([]);
      });
    });

    describe('error handling', () => {
      it('should respond with empty array on handler exception', async () => {
        vi.mocked(mockAutocompleteInteraction.options.getFocused).mockReturnValue({
          name: 'server-id',
          value: '',
        });
        // Create a mock that throws when used
        mockAutocompleteInteraction.client.guilds.cache = {
          filter: () => {
            throw new Error('Handler error');
          },
        } as unknown as Collection<string, Guild>;

        await autocomplete(mockAutocompleteInteraction);

        expect(mockAutocompleteInteraction.respond).toHaveBeenCalledWith([]);
      });
    });
  });
});
