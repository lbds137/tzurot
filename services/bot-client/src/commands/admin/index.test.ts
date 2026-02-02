/**
 * Tests for Admin Command Router
 *
 * This command uses deferralMode: 'ephemeral', so execute receives SafeCommandContext.
 * The router casts to DeferredCommandContext and uses requireBotOwnerContext.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import adminCommand from './index.js';

// Destructure from default export
const { data, execute, autocomplete } = adminCommand;
import type { AutocompleteInteraction, Collection, Guild } from 'discord.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

// Mock fetch
global.fetch = vi.fn();

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

// Mock requireBotOwnerContext from commandContext module
const mockRequireBotOwnerContext = vi.fn();
vi.mock('../../utils/commandContext/index.js', async () => {
  const actual = await vi.importActual('../../utils/commandContext/index.js');
  return {
    ...actual,
    requireBotOwnerContext: (...args: unknown[]) => mockRequireBotOwnerContext(...args),
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
    /**
     * Create a mock DeferredCommandContext for testing the router.
     */
    function createMockContext(subcommand: string): DeferredCommandContext {
      const mockEditReply = vi.fn().mockResolvedValue(undefined);

      return {
        interaction: {},
        user: { id: 'test-user-id' },
        guild: null,
        member: null,
        channel: null,
        channelId: 'channel-123',
        guildId: null,
        commandName: 'admin',
        isEphemeral: true,
        getOption: vi.fn(),
        getRequiredOption: vi.fn(),
        getSubcommand: () => subcommand,
        getSubcommandGroup: () => null,
        editReply: mockEditReply,
        followUp: vi.fn(),
        deleteReply: vi.fn(),
      } as unknown as DeferredCommandContext;
    }

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should check owner permission before executing', async () => {
      mockRequireBotOwnerContext.mockResolvedValue(false);
      const context = createMockContext('db-sync');

      await execute(context);

      expect(mockRequireBotOwnerContext).toHaveBeenCalledWith(context);
      // Should not call any handlers
      expect(handleDbSync).not.toHaveBeenCalled();
      expect(handleServers).not.toHaveBeenCalled();
      expect(handleKick).not.toHaveBeenCalled();
      expect(handleUsage).not.toHaveBeenCalled();
    });

    it('should route to handleDbSync for db-sync subcommand', async () => {
      mockRequireBotOwnerContext.mockResolvedValue(true);
      const context = createMockContext('db-sync');

      await execute(context);

      expect(handleDbSync).toHaveBeenCalledWith(context);
      expect(handleServers).not.toHaveBeenCalled();
      expect(handleKick).not.toHaveBeenCalled();
      expect(handleUsage).not.toHaveBeenCalled();
    });

    it('should route to handleServers for servers subcommand', async () => {
      mockRequireBotOwnerContext.mockResolvedValue(true);
      const context = createMockContext('servers');

      await execute(context);

      expect(handleServers).toHaveBeenCalledWith(context);
      expect(handleDbSync).not.toHaveBeenCalled();
      expect(handleKick).not.toHaveBeenCalled();
      expect(handleUsage).not.toHaveBeenCalled();
    });

    it('should route to handleKick for kick subcommand', async () => {
      mockRequireBotOwnerContext.mockResolvedValue(true);
      const context = createMockContext('kick');

      await execute(context);

      expect(handleKick).toHaveBeenCalledWith(context);
      expect(handleDbSync).not.toHaveBeenCalled();
      expect(handleServers).not.toHaveBeenCalled();
      expect(handleUsage).not.toHaveBeenCalled();
    });

    it('should route to handleUsage for usage subcommand', async () => {
      mockRequireBotOwnerContext.mockResolvedValue(true);
      const context = createMockContext('usage');

      await execute(context);

      expect(handleUsage).toHaveBeenCalledWith(context);
      expect(handleDbSync).not.toHaveBeenCalled();
      expect(handleServers).not.toHaveBeenCalled();
      expect(handleKick).not.toHaveBeenCalled();
    });

    it('should handle unknown subcommand', async () => {
      mockRequireBotOwnerContext.mockResolvedValue(true);
      const context = createMockContext('unknown');

      await execute(context);

      // createSubcommandContextRouter returns a generic message without the subcommand name
      expect(context.editReply).toHaveBeenCalledWith({
        content: '❌ Unknown subcommand',
      });
      expect(handleDbSync).not.toHaveBeenCalled();
      expect(handleServers).not.toHaveBeenCalled();
      expect(handleKick).not.toHaveBeenCalled();
      expect(handleUsage).not.toHaveBeenCalled();
    });

    it('should route handlers with context (not raw interaction)', async () => {
      mockRequireBotOwnerContext.mockResolvedValue(true);
      const context = createMockContext('db-sync');

      await execute(context);

      // Handlers receive DeferredCommandContext, not raw interaction
      expect(handleDbSync).toHaveBeenCalledWith(context);
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
        } as never);

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

        Object.defineProperty(mockAutocompleteInteraction.client.guilds, 'cache', {
          value: mockCache,
          writable: true,
        });

        // Make filter return only 'Test Server' when querying 'test'
        mockCache.filter.mockImplementation((_fn: (g: (typeof mockGuilds)[0]) => boolean) => ({
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
        } as never);

        await autocomplete(mockAutocompleteInteraction);

        expect(mockAutocompleteInteraction.respond).toHaveBeenCalledWith([]);
      });
    });

    describe('error handling', () => {
      it('should respond with empty array on handler exception', async () => {
        vi.mocked(mockAutocompleteInteraction.options.getFocused).mockReturnValue({
          name: 'server-id',
          value: '',
        } as never);
        // Create a mock that throws when used
        Object.defineProperty(mockAutocompleteInteraction.client.guilds, 'cache', {
          value: {
            filter: () => {
              throw new Error('Handler error');
            },
          },
          writable: true,
        });

        await autocomplete(mockAutocompleteInteraction);

        expect(mockAutocompleteInteraction.respond).toHaveBeenCalledWith([]);
      });
    });
  });
});
