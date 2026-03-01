/**
 * Tests for /character command group
 *
 * Tests command definition, subcommand routing, and component interaction
 * routing (buttons, select menus, modals) to the correct handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  AutocompleteInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import type { SafeCommandContext } from '../../utils/commandContext/types.js';

// Mock all subcommand handlers
vi.mock('./autocomplete.js', () => ({
  handleAutocomplete: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./import.js', () => ({
  handleImport: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./export.js', () => ({
  handleExport: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./template.js', () => ({
  handleTemplate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./view.js', () => ({
  handleView: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./create.js', () => ({
  handleCreate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./edit.js', () => ({
  handleEdit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./avatar.js', () => ({
  handleAvatar: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./browse.js', () => ({
  handleBrowse: vi.fn().mockResolvedValue(undefined),
  handleBrowsePagination: vi.fn().mockResolvedValue(undefined),
  handleBrowseSelect: vi.fn().mockResolvedValue(undefined),
  isCharacterBrowseInteraction: vi.fn().mockReturnValue(false),
  isCharacterBrowseSelectInteraction: vi.fn().mockReturnValue(false),
}));
vi.mock('./chat.js', () => ({
  handleChat: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./settings.js', () => ({
  handleSettings: vi.fn().mockResolvedValue(undefined),
  handleCharacterSettingsSelectMenu: vi.fn().mockResolvedValue(undefined),
  handleCharacterSettingsButton: vi.fn().mockResolvedValue(undefined),
  handleCharacterSettingsModal: vi.fn().mockResolvedValue(undefined),
  isCharacterSettingsInteraction: vi.fn().mockReturnValue(false),
}));
vi.mock('./overrides.js', () => ({
  handleOverrides: vi.fn().mockResolvedValue(undefined),
  handleCharacterOverridesSelectMenu: vi.fn().mockResolvedValue(undefined),
  handleCharacterOverridesButton: vi.fn().mockResolvedValue(undefined),
  handleCharacterOverridesModal: vi.fn().mockResolvedValue(undefined),
  isCharacterOverridesInteraction: vi.fn().mockReturnValue(false),
}));
vi.mock('./dashboard.js', () => ({
  handleModalSubmit: vi.fn().mockResolvedValue(undefined),
  handleSelectMenu: vi.fn().mockResolvedValue(undefined),
  handleButton: vi.fn().mockResolvedValue(undefined),
}));

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

import characterCommand from './index.js';
import { handleSettings } from './settings.js';
import { handleOverrides } from './overrides.js';
import {
  handleCharacterOverridesSelectMenu,
  handleCharacterOverridesButton,
  handleCharacterOverridesModal,
  isCharacterOverridesInteraction,
} from './overrides.js';
import {
  handleCharacterSettingsSelectMenu,
  handleCharacterSettingsButton,
  handleCharacterSettingsModal,
  isCharacterSettingsInteraction,
} from './settings.js';
import { handleAutocomplete } from './autocomplete.js';

const { data, execute, autocomplete, handleSelectMenu, handleButton, handleModal, deferralMode } =
  characterCommand;

describe('/character command group', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset routing mocks to defaults — clearAllMocks doesn't reset mockReturnValue
    vi.mocked(isCharacterSettingsInteraction).mockReturnValue(false);
    vi.mocked(isCharacterOverridesInteraction).mockReturnValue(false);
  });

  describe('command definition', () => {
    it('should have correct command name', () => {
      expect(data.name).toBe('character');
    });

    it('should have deferralMode set to ephemeral', () => {
      expect(deferralMode).toBe('ephemeral');
    });

    it('should have overrides subcommand', () => {
      const json = data.toJSON();
      const overridesSub = json.options?.find((opt: { name: string }) => opt.name === 'overrides');
      expect(overridesSub).toBeDefined();
    });

    it('should have settings subcommand', () => {
      const json = data.toJSON();
      const settingsSub = json.options?.find((opt: { name: string }) => opt.name === 'settings');
      expect(settingsSub).toBeDefined();
    });

    it('should include character-overrides in componentPrefixes', () => {
      expect(characterCommand.componentPrefixes).toContain('character-overrides');
      expect(characterCommand.componentPrefixes).toContain('character-settings');
    });
  });

  describe('execute', () => {
    function createMockContext(subcommand: string): SafeCommandContext {
      return {
        interaction: {},
        user: { id: 'user-123' },
        guild: null,
        member: null,
        channel: null,
        channelId: 'channel-123',
        guildId: 'guild-123',
        commandName: 'character',
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

    it('should route to settings handler', async () => {
      const context = createMockContext('settings');
      await execute(context);
      expect(handleSettings).toHaveBeenCalled();
    });

    it('should route to overrides handler', async () => {
      const context = createMockContext('overrides');
      await execute(context);
      expect(handleOverrides).toHaveBeenCalled();
    });
  });

  describe('autocomplete', () => {
    it('should call handleAutocomplete', async () => {
      const interaction = {
        options: { getSubcommand: vi.fn().mockReturnValue('settings') },
        user: { id: 'user-123' },
      } as unknown as AutocompleteInteraction;

      await autocomplete!(interaction);

      expect(handleAutocomplete).toHaveBeenCalledWith(interaction);
    });
  });

  describe('handleSelectMenu', () => {
    it('should route overrides interactions to overrides handler', async () => {
      vi.mocked(isCharacterOverridesInteraction).mockReturnValue(true);

      const interaction = {
        customId: 'character-overrides::select::aurora--pid',
        user: { id: 'user-456' },
      } as unknown as StringSelectMenuInteraction;

      await handleSelectMenu!(interaction);

      expect(handleCharacterOverridesSelectMenu).toHaveBeenCalledWith(interaction);
    });

    it('should route settings interactions to settings handler', async () => {
      vi.mocked(isCharacterSettingsInteraction).mockReturnValue(true);

      const interaction = {
        customId: 'character-settings::select::aurora--pid',
        user: { id: 'user-456' },
      } as unknown as StringSelectMenuInteraction;

      await handleSelectMenu!(interaction);

      expect(handleCharacterSettingsSelectMenu).toHaveBeenCalledWith(interaction);
    });
  });

  describe('handleButton', () => {
    it('should route overrides interactions to overrides handler', async () => {
      vi.mocked(isCharacterOverridesInteraction).mockReturnValue(true);

      const interaction = {
        customId: 'character-overrides::set::aurora--pid::maxMessages:auto',
        user: { id: 'user-456' },
      } as unknown as ButtonInteraction;

      await handleButton!(interaction);

      expect(handleCharacterOverridesButton).toHaveBeenCalledWith(interaction);
    });

    it('should route settings interactions to settings handler', async () => {
      vi.mocked(isCharacterSettingsInteraction).mockReturnValue(true);

      const interaction = {
        customId: 'character-settings::set::aurora--pid::maxMessages:auto',
        user: { id: 'user-456' },
      } as unknown as ButtonInteraction;

      await handleButton!(interaction);

      expect(handleCharacterSettingsButton).toHaveBeenCalledWith(interaction);
    });
  });

  describe('handleModal', () => {
    it('should route overrides interactions to overrides handler', async () => {
      vi.mocked(isCharacterOverridesInteraction).mockReturnValue(true);

      const interaction = {
        customId: 'character-overrides::modal::aurora--pid::maxMessages',
        user: { id: 'user-456' },
      } as unknown as ModalSubmitInteraction;

      await handleModal!(interaction);

      expect(handleCharacterOverridesModal).toHaveBeenCalledWith(interaction);
    });

    it('should route settings interactions to settings handler', async () => {
      vi.mocked(isCharacterSettingsInteraction).mockReturnValue(true);

      const interaction = {
        customId: 'character-settings::modal::aurora--pid::maxMessages',
        user: { id: 'user-456' },
      } as unknown as ModalSubmitInteraction;

      await handleModal!(interaction);

      expect(handleCharacterSettingsModal).toHaveBeenCalledWith(interaction);
    });
  });
});
