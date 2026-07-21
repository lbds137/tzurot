/**
 * Tests for Settings Command Index
 * Tests command routing for consolidated settings (timezone, apikey, defaults, data)
 *
 * History:
 * - Consolidated from former /me timezone, /wallet, and /me preset commands
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import settingsCommand from './index.js';

// Destructure from default export
const { data, execute, autocomplete, handleModal, handleButton, handleSelectMenu } =
  settingsCommand;

// Mock timezone handlers
vi.mock('./timezone/set.js', () => ({
  handleTimezoneSet: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./timezone/get.js', () => ({
  handleTimezoneGet: vi.fn().mockResolvedValue(undefined),
}));

// Mock apikey handlers
vi.mock('./apikey/set.js', () => ({
  handleSetKey: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./apikey/browse.js', () => ({
  handleBrowse: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./apikey/remove.js', () => ({
  handleRemoveKey: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./apikey/test.js', () => ({
  handleTestKey: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./apikey/modal.js', () => ({
  handleApikeyModalSubmit: vi.fn().mockResolvedValue(undefined),
}));

// Mock defaults handlers
vi.mock('./defaults/edit.js', () => ({
  handleDefaultsEdit: vi.fn().mockResolvedValue(undefined),
  handleUserDefaultsButton: vi.fn().mockResolvedValue(undefined),
  handleUserDefaultsSelectMenu: vi.fn().mockResolvedValue(undefined),
  handleUserDefaultsModal: vi.fn().mockResolvedValue(undefined),
  isUserDefaultsInteraction: vi.fn((customId: string) =>
    customId.startsWith('user-defaults-settings::')
  ),
}));

vi.mock('./data/delete.js', () => ({
  handleDataDelete: vi.fn().mockResolvedValue(undefined),
  handleDataDeleteButton: vi.fn().mockResolvedValue(undefined),
  handleDataDeleteModal: vi.fn().mockResolvedValue(undefined),
  // Must match the real operation constant — the account-delete routing
  // tests build REAL DestructiveCustomIds against it (drift pins).
  SETTINGS_ACCOUNT_DELETE_OPERATION: 'account-delete',
}));

// Mock logger
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

describe('Settings Command Index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command data', () => {
    it('should have correct name and description', () => {
      expect(data.name).toBe('settings');
      expect(data.description).toBe('Manage your account settings');
    });

    it('should have timezone subcommand group with get and set', () => {
      const json = data.toJSON();
      const options = json.options ?? [];

      // Find subcommand groups (type 2)
      const groups = options.filter((opt: { type: number }) => opt.type === 2);
      const timezoneGroup = groups.find((g: { name: string }) => g.name === 'timezone');

      expect(timezoneGroup).toBeDefined();

      const subcommands = (
        (timezoneGroup as { options?: Array<{ name: string }> })?.options ?? []
      ).map(s => s.name);
      expect(subcommands).toContain('get');
      expect(subcommands).toContain('set');
    });

    it('should have apikey subcommand group with set, browse, remove, test', () => {
      const json = data.toJSON();
      const options = json.options ?? [];

      const groups = options.filter((opt: { type: number }) => opt.type === 2);
      const apikeyGroup = groups.find((g: { name: string }) => g.name === 'apikey');

      expect(apikeyGroup).toBeDefined();

      const subcommands = (
        (apikeyGroup as { options?: Array<{ name: string }> })?.options ?? []
      ).map(s => s.name);
      expect(subcommands).toContain('set');
      expect(subcommands).toContain('browse');
      expect(subcommands).toContain('remove');
      expect(subcommands).toContain('test');
    });

    it('should have defaults subcommand group with edit', () => {
      const json = data.toJSON();
      const options = json.options ?? [];

      const groups = options.filter((opt: { type: number }) => opt.type === 2);
      const defaultsGroup = groups.find((g: { name: string }) => g.name === 'defaults');

      expect(defaultsGroup).toBeDefined();

      const subcommands = (
        (defaultsGroup as { options?: Array<{ name: string }> })?.options ?? []
      ).map(s => s.name);
      expect(subcommands).toContain('edit');
    });

    it('does NOT register the legacy /settings tts or /settings voices stubs', () => {
      const json = data.toJSON();
      const options = json.options ?? [];
      const groupNames = options
        .filter((opt: { type: number }) => opt.type === 2)
        .map((g: { name: string }) => g.name);
      // /settings tts and /settings voices live under /voice now;
      // Discord surfaces "Unknown command" for legacy paths instead of
      // an in-bot redirect.
      expect(groupNames).not.toContain('tts');
      expect(groupNames).not.toContain('voices');
    });

    it('should have componentPrefixes for user-defaults only', () => {
      // Account-delete customIds start with 'settings::' and route natively
      // by command name — no extra prefix needed since the Tier-B migration.
      // The preset-override prefix re-homed to /preset with the override group.
      expect(settingsCommand.componentPrefixes).toEqual(['user-defaults-settings']);
    });

    it('should have correct deferral modes', () => {
      // Most subcommands are ephemeral deferred
      expect(settingsCommand.deferralMode).toBe('ephemeral');

      // apikey set shows a modal
      expect(settingsCommand.subcommandDeferralModes).toEqual({
        'apikey set': 'modal',
      });
    });
  });

  describe('execute - subcommand routing', () => {
    /**
     * Create a mock SafeCommandContext for routing tests
     */
    function createMockContext(
      group: string,
      subcommand: string,
      options: { getString?: (name: string) => string | null } = {}
    ) {
      return {
        user: { id: '123' },
        interaction: {
          options: {
            getString: options.getString ?? (() => null),
          },
        },
        getSubcommandGroup: () => group,
        getSubcommand: () => subcommand,
        editReply: vi.fn(),
        showModal: vi.fn(),
        reply: vi.fn(),
      } as any;
    }

    describe('timezone group', () => {
      it('should route to timezone get handler', async () => {
        const { handleTimezoneGet } = await import('./timezone/get.js');
        const context = createMockContext('timezone', 'get');

        await execute(context);

        expect(handleTimezoneGet).toHaveBeenCalledWith(context);
      });

      it('should route to timezone set handler', async () => {
        const { handleTimezoneSet } = await import('./timezone/set.js');
        const context = createMockContext('timezone', 'set');

        await execute(context);

        expect(handleTimezoneSet).toHaveBeenCalledWith(context);
      });
    });

    describe('apikey group', () => {
      it('should route to apikey set handler (modal)', async () => {
        const { handleSetKey } = await import('./apikey/set.js');
        const context = createMockContext('apikey', 'set');

        await execute(context);

        expect(handleSetKey).toHaveBeenCalledWith(context);
      });

      it('should route to apikey browse handler', async () => {
        const { handleBrowse } = await import('./apikey/browse.js');
        const context = createMockContext('apikey', 'browse');

        await execute(context);

        expect(handleBrowse).toHaveBeenCalledWith(context);
      });

      it('should route to apikey remove handler', async () => {
        const { handleRemoveKey } = await import('./apikey/remove.js');
        const context = createMockContext('apikey', 'remove');

        await execute(context);

        expect(handleRemoveKey).toHaveBeenCalledWith(context);
      });

      it('should route to apikey test handler', async () => {
        const { handleTestKey } = await import('./apikey/test.js');
        const context = createMockContext('apikey', 'test');

        await execute(context);

        expect(handleTestKey).toHaveBeenCalledWith(context);
      });
    });

    describe('defaults group', () => {
      it('should route to defaults edit handler', async () => {
        const { handleDefaultsEdit } = await import('./defaults/edit.js');
        const context = createMockContext('defaults', 'edit');

        await execute(context);

        expect(handleDefaultsEdit).toHaveBeenCalledWith(context);
      });
    });

    it('should handle unknown group gracefully', async () => {
      const context = createMockContext('unknown', 'test');

      await execute(context);

      expect(context.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Unknown settings group'),
      });
    });
  });

  describe('handleModal - modal routing', () => {
    it('should route apikey modals to apikey modal handler', async () => {
      const { handleApikeyModalSubmit } = await import('./apikey/modal.js');

      const interaction = {
        customId: 'settings::apikey::set::openrouter',
      } as any;

      await handleModal(interaction);

      expect(handleApikeyModalSubmit).toHaveBeenCalledWith(interaction);
    });

    it('routes account-delete modals via the REAL destructive customId (drift pin)', async () => {
      const { handleDataDeleteModal } = await import('./data/delete.js');
      const { DestructiveCustomIds } = await import('../../utils/customIds.js');

      const interaction = {
        customId: DestructiveCustomIds.modalSubmit('settings', 'account-delete'),
      } as any;
      await handleModal(interaction);

      expect(handleDataDeleteModal).toHaveBeenCalledWith(interaction);
    });

    it('acks an unknown modal custom ID (unacked submits surface as "interaction failed")', async () => {
      const reply = vi.fn().mockResolvedValue(undefined);
      const interaction = {
        customId: 'unknown-entity::modal::id',
        deferred: false,
        replied: false,
        reply,
      } as any;

      await handleModal(interaction);

      expect(reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Unknown modal submission') })
      );
    });

    it('should route user-defaults modals to defaults handler', async () => {
      const { handleUserDefaultsModal } = await import('./defaults/edit.js');

      const interaction = {
        customId: 'user-defaults-settings::modal::user-456::maxMessages',
      } as any;

      await handleModal(interaction);

      expect(handleUserDefaultsModal).toHaveBeenCalledWith(interaction);
    });
  });

  describe('handleButton - button routing', () => {
    it('should route user-defaults buttons to defaults handler', async () => {
      const { handleUserDefaultsButton } = await import('./defaults/edit.js');

      const interaction = {
        customId: 'user-defaults-settings::set::user-456::maxMessages:auto',
      } as any;

      await handleButton(interaction);

      expect(handleUserDefaultsButton).toHaveBeenCalledWith(interaction);
    });

    it('routes account-delete buttons via the REAL destructive customId (drift pin)', async () => {
      const { handleDataDeleteButton } = await import('./data/delete.js');
      const { DestructiveCustomIds } = await import('../../utils/customIds.js');

      const interaction = {
        customId: DestructiveCustomIds.confirmButton('settings', 'account-delete'),
      } as any;
      await handleButton(interaction);

      expect(handleDataDeleteButton).toHaveBeenCalledWith(interaction);
    });

    it('acks an unknown button custom ID instead of dead-ending it', async () => {
      const reply = vi.fn().mockResolvedValue(undefined);
      const interaction = {
        customId: 'unknown-entity::action::id',
        deferred: false,
        replied: false,
        reply,
      } as any;

      await handleButton(interaction);

      // The unrouted fallback must acknowledge — a silent warn left the
      // button dead with no user feedback.
      expect(reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Unknown interaction') })
      );
    });
  });

  describe('handleSelectMenu - select menu routing', () => {
    it('should route user-defaults select menus to defaults handler', async () => {
      const { handleUserDefaultsSelectMenu } = await import('./defaults/edit.js');

      const interaction = {
        customId: 'user-defaults-settings::select::user-456',
      } as any;

      await handleSelectMenu(interaction);

      expect(handleUserDefaultsSelectMenu).toHaveBeenCalledWith(interaction);
    });

    it('acks an unknown select menu custom ID instead of dead-ending it', async () => {
      const reply = vi.fn().mockResolvedValue(undefined);
      const interaction = {
        customId: 'unknown-entity::select::id',
        deferred: false,
        replied: false,
        reply,
      } as any;

      await handleSelectMenu(interaction);

      expect(reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Unknown interaction') })
      );
    });
  });

  describe('autocomplete', () => {
    it('should handle timezone autocomplete inline', async () => {
      const interaction = {
        options: {
          getFocused: () => ({ name: 'timezone', value: 'eastern' }),
          getSubcommandGroup: () => 'timezone',
        },
        respond: vi.fn(),
      } as any;

      await autocomplete(interaction);

      expect(interaction.respond).toHaveBeenCalled();
      const choices = interaction.respond.mock.calls[0][0];
      // Should filter to timezones matching "eastern" (label includes "Eastern Time")
      expect(choices.some((c: { value: string }) => c.value.includes('New_York'))).toBe(true);
    });

    it('should return empty array for unknown options', async () => {
      const interaction = {
        options: {
          getFocused: () => ({ name: 'unknown', value: '' }),
          getSubcommandGroup: () => 'apikey',
        },
        respond: vi.fn(),
      } as any;

      await autocomplete(interaction);

      expect(interaction.respond).toHaveBeenCalledWith([]);
    });
  });
});
