/**
 * Tests for /channel command group
 *
 * This command uses deferralMode: 'ephemeral' which means:
 * - Execute receives SafeCommandContext (not raw interaction)
 * - Tests must mock the context, not the interaction directly
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AutocompleteInteraction } from 'discord.js';
import type { SafeCommandContext } from '../../utils/commandContext/types.js';
import channelCommand from './index.js';

// Destructure from default export
const { data, execute, autocomplete, deferralMode } = channelCommand;

// Mock handlers
vi.mock('./activate.js', () => ({
  handleActivate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./deactivate.js', () => ({
  handleDeactivate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./browse.js', () => ({
  handleBrowse: vi.fn().mockResolvedValue(undefined),
  handleBrowsePagination: vi.fn().mockResolvedValue(undefined),
  isChannelBrowseInteraction: vi.fn().mockReturnValue(false),
}));

vi.mock('./autocomplete.js', () => ({
  handleAutocomplete: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./settings.js', () => ({
  handleContext: vi.fn().mockResolvedValue(undefined),
  handleChannelContextSelectMenu: vi.fn().mockResolvedValue(undefined),
  handleChannelContextButton: vi.fn().mockResolvedValue(undefined),
  handleChannelContextModal: vi.fn().mockResolvedValue(undefined),
  isChannelContextInteraction: vi.fn().mockReturnValue(false),
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

import { handleActivate } from './activate.js';
import { handleDeactivate } from './deactivate.js';
import { handleBrowse } from './browse.js';
import { handleAutocomplete } from './autocomplete.js';
import { handleContext } from './settings.js';

describe('/channel command group', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command definition', () => {
    it('should have correct command name', () => {
      expect(data.name).toBe('channel');
    });

    it('should have description', () => {
      expect(data.description).toBeDefined();
      expect(data.description.length).toBeGreaterThan(0);
    });

    it('should have deferralMode set to ephemeral', () => {
      expect(deferralMode).toBe('ephemeral');
    });

    it('should have activate subcommand', () => {
      const json = data.toJSON();
      const activateSubcommand = json.options?.find(
        (opt: { name: string }) => opt.name === 'activate'
      );
      expect(activateSubcommand).toBeDefined();
    });

    it('should have deactivate subcommand', () => {
      const json = data.toJSON();
      const deactivateSubcommand = json.options?.find(
        (opt: { name: string }) => opt.name === 'deactivate'
      );
      expect(deactivateSubcommand).toBeDefined();
    });

    it('should have browse subcommand', () => {
      const json = data.toJSON();
      const browseSubcommand = json.options?.find((opt: { name: string }) => opt.name === 'browse');
      expect(browseSubcommand).toBeDefined();
    });

    it('should have settings subcommand', () => {
      const json = data.toJSON();
      const settingsSubcommand = json.options?.find(
        (opt: { name: string }) => opt.name === 'settings'
      );
      expect(settingsSubcommand).toBeDefined();
    });
  });

  describe('execute', () => {
    /**
     * Create a mock SafeCommandContext for testing routing.
     */
    function createMockContext(subcommand: string): SafeCommandContext {
      return {
        interaction: {},
        user: { id: 'user-123' },
        guild: null,
        member: null,
        channel: null,
        channelId: 'channel-123',
        guildId: 'guild-123',
        commandName: 'channel',
        isEphemeral: true,
        getOption: vi.fn(),
        getRequiredOption: vi.fn(),
        getSubcommand: () => subcommand,
        getSubcommandGroup: () => null,
        editReply: vi.fn(),
        followUp: vi.fn(),
        deleteReply: vi.fn(),
      } as unknown as SafeCommandContext;
    }

    it('should route to activate handler', async () => {
      const context = createMockContext('activate');

      await execute(context);

      expect(handleActivate).toHaveBeenCalled();
    });

    it('should route to deactivate handler', async () => {
      const context = createMockContext('deactivate');

      await execute(context);

      expect(handleDeactivate).toHaveBeenCalled();
    });

    it('should route to browse handler', async () => {
      const context = createMockContext('browse');

      await execute(context);

      expect(handleBrowse).toHaveBeenCalled();
    });

    it('should route to settings handler', async () => {
      const context = createMockContext('settings');

      await execute(context);

      expect(handleContext).toHaveBeenCalled();
    });
  });

  describe('autocomplete', () => {
    it('should call handleAutocomplete', async () => {
      const interaction = {
        options: {
          getSubcommand: vi.fn().mockReturnValue('activate'),
        },
        user: { id: 'user-123' },
      } as unknown as AutocompleteInteraction;

      await autocomplete(interaction);

      expect(handleAutocomplete).toHaveBeenCalledWith(interaction);
    });
  });
});
