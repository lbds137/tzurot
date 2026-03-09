/**
 * Tests for Settings Command Index
 * Tests command routing for consolidated settings (timezone, apikey, preset, defaults)
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

// Mock preset handlers
vi.mock('./preset/browse.js', () => ({
  handleBrowseOverrides: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./preset/set.js', () => ({
  handleSet: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./preset/reset.js', () => ({
  handleReset: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./preset/default.js', () => ({
  handleDefault: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./preset/clear-default.js', () => ({
  handleClearDefault: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./preset/autocomplete.js', () => ({
  handleAutocomplete: vi.fn().mockResolvedValue(undefined),
}));

// Mock voice handlers
vi.mock('./voices/browse.js', () => ({
  handleBrowseVoices: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./voices/delete.js', () => ({
  handleDeleteVoice: vi.fn().mockResolvedValue(undefined),
  handleVoiceAutocomplete: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./voices/clear.js', () => ({
  handleClearVoices: vi.fn().mockResolvedValue(undefined),
  handleVoiceClearButton: vi.fn().mockResolvedValue(undefined),
  handleVoiceClearModal: vi.fn().mockResolvedValue(undefined),
  VOICE_CLEAR_OPERATION: 'voice-clear',
}));

// Mock destructive confirmation utilities
vi.mock('../../utils/destructiveConfirmation.js', () => ({
  buildDestructiveWarning: vi.fn(),
  createHardDeleteConfig: vi.fn(),
  handleDestructiveConfirmButton: vi.fn(),
  handleDestructiveCancel: vi.fn(),
  handleDestructiveModalSubmit: vi.fn(),
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

    it('should have preset subcommand group with browse, set, reset, default, clear-default', () => {
      const json = data.toJSON();
      const options = json.options ?? [];

      const groups = options.filter((opt: { type: number }) => opt.type === 2);
      const presetGroup = groups.find((g: { name: string }) => g.name === 'preset');

      expect(presetGroup).toBeDefined();

      const subcommands = (
        (presetGroup as { options?: Array<{ name: string }> })?.options ?? []
      ).map(s => s.name);
      expect(subcommands).toContain('browse');
      expect(subcommands).toContain('set');
      expect(subcommands).toContain('reset');
      expect(subcommands).toContain('default');
      expect(subcommands).toContain('clear-default');
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

    it('should have voices subcommand group with browse, delete, clear', () => {
      const json = data.toJSON();
      const options = json.options ?? [];

      const groups = options.filter((opt: { type: number }) => opt.type === 2);
      const voicesGroup = groups.find((g: { name: string }) => g.name === 'voices');

      expect(voicesGroup).toBeDefined();

      const subcommands = (
        (voicesGroup as { options?: Array<{ name: string }> })?.options ?? []
      ).map(s => s.name);
      expect(subcommands).toContain('browse');
      expect(subcommands).toContain('delete');
      expect(subcommands).toContain('clear');
    });

    it('should have componentPrefixes for user-defaults-settings', () => {
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

    describe('preset group', () => {
      it('should route to preset browse handler', async () => {
        const { handleBrowseOverrides } = await import('./preset/browse.js');
        const context = createMockContext('preset', 'browse');

        await execute(context);

        expect(handleBrowseOverrides).toHaveBeenCalledWith(context);
      });

      it('should route to preset set handler', async () => {
        const { handleSet } = await import('./preset/set.js');
        const context = createMockContext('preset', 'set');

        await execute(context);

        expect(handleSet).toHaveBeenCalledWith(context);
      });

      it('should route to preset reset handler', async () => {
        const { handleReset } = await import('./preset/reset.js');
        const context = createMockContext('preset', 'reset');

        await execute(context);

        expect(handleReset).toHaveBeenCalledWith(context);
      });

      it('should route to preset default handler', async () => {
        const { handleDefault } = await import('./preset/default.js');
        const context = createMockContext('preset', 'default');

        await execute(context);

        expect(handleDefault).toHaveBeenCalledWith(context);
      });

      it('should route to preset clear-default handler', async () => {
        const { handleClearDefault } = await import('./preset/clear-default.js');
        const context = createMockContext('preset', 'clear-default');

        await execute(context);

        expect(handleClearDefault).toHaveBeenCalledWith(context);
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

    describe('voices group', () => {
      it('should route to voices browse handler', async () => {
        const { handleBrowseVoices } = await import('./voices/browse.js');
        const context = createMockContext('voices', 'browse');

        await execute(context);

        expect(handleBrowseVoices).toHaveBeenCalledWith(context);
      });

      it('should route to voices delete handler', async () => {
        const { handleDeleteVoice } = await import('./voices/delete.js');
        const context = createMockContext('voices', 'delete');

        await execute(context);

        expect(handleDeleteVoice).toHaveBeenCalledWith(context);
      });

      it('should route to voices clear handler', async () => {
        const { handleClearVoices } = await import('./voices/clear.js');
        const context = createMockContext('voices', 'clear');

        await execute(context);

        expect(handleClearVoices).toHaveBeenCalledWith(context);
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

    it('should route voice-clear destructive buttons to voice handler', async () => {
      const { handleVoiceClearButton } = await import('./voices/clear.js');

      const interaction = {
        customId: 'settings::destructive::confirm_button::voice-clear::all',
      } as any;

      await handleButton(interaction);

      expect(handleVoiceClearButton).toHaveBeenCalledWith(interaction);
    });

    it('should log warning for unknown button custom ID', async () => {
      const interaction = {
        customId: 'unknown-entity::action::id',
      } as any;

      // Should not throw
      await handleButton(interaction);
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

    it('should log warning for unknown select menu custom ID', async () => {
      const interaction = {
        customId: 'unknown-entity::select::id',
      } as any;

      // Should not throw
      await handleSelectMenu(interaction);
    });
  });

  describe('handleModal - voice-clear routing', () => {
    it('should route voice-clear destructive modals to voice handler', async () => {
      const { handleVoiceClearModal } = await import('./voices/clear.js');

      const interaction = {
        customId: 'settings::destructive::modal_submit::voice-clear::all',
      } as any;

      await handleModal(interaction);

      expect(handleVoiceClearModal).toHaveBeenCalledWith(interaction);
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

    it('should route preset autocomplete to preset handler', async () => {
      const { handleAutocomplete: handlePresetAutocomplete } =
        await import('./preset/autocomplete.js');

      const interaction = {
        options: {
          getFocused: () => ({ name: 'personality', value: '' }),
          getSubcommandGroup: () => 'preset',
        },
      } as any;

      await autocomplete(interaction);

      expect(handlePresetAutocomplete).toHaveBeenCalledWith(interaction);
    });

    it('should route voice autocomplete to voice handler', async () => {
      const { handleVoiceAutocomplete } = await import('./voices/delete.js');

      const interaction = {
        options: {
          getFocused: () => ({ name: 'voice', value: 'ali' }),
          getSubcommandGroup: () => 'voices',
        },
      } as any;

      await autocomplete(interaction);

      expect(handleVoiceAutocomplete).toHaveBeenCalledWith(interaction);
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
