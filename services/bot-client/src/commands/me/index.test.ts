/**
 * Tests for Me Command Index
 * Tests command routing and modal handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import meCommand from './index.js';

// Destructure from default export
const { data, execute, autocomplete, handleModal } = meCommand;

// Mock all handler modules
vi.mock('./profile/view.js', () => ({
  handleViewPersona: vi.fn().mockResolvedValue(undefined),
  handleExpandContent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./profile/edit.js', () => ({
  handleEditPersona: vi.fn().mockResolvedValue(undefined),
  handleEditModalSubmit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./profile/create.js', () => ({
  handleCreatePersona: vi.fn().mockResolvedValue(undefined),
  handleCreateModalSubmit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./profile/list.js', () => ({
  handleListPersonas: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./profile/default.js', () => ({
  handleSetDefaultPersona: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./profile/share-ltm.js', () => ({
  handleShareLtmSetting: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./profile/override-set.js', () => ({
  handleOverrideSet: vi.fn().mockResolvedValue(undefined),
  handleOverrideCreateModalSubmit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./profile/override-clear.js', () => ({
  handleOverrideClear: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./timezone/set.js', () => ({
  handleTimezoneSet: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./timezone/get.js', () => ({
  handleTimezoneGet: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./autocomplete.js', () => ({
  handleMePersonalityAutocomplete: vi.fn().mockResolvedValue(undefined),
  handlePersonaAutocomplete: vi.fn().mockResolvedValue(undefined),
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

describe('Me Command Index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command data', () => {
    it('should have correct name and description', () => {
      expect(data.name).toBe('me');
      expect(data.description).toBe('Manage your personal settings and profile');
    });

    it('should have profile subcommand group with all subcommands', () => {
      const json = data.toJSON();
      const options = json.options ?? [];

      // Find subcommand groups (type 2)
      const groups = options.filter((opt: { type: number }) => opt.type === 2);
      const profileGroup = groups.find((g: { name: string }) => g.name === 'profile');

      expect(profileGroup).toBeDefined();

      // Check profile group has expected subcommands
      const profileSubcommands = (profileGroup?.options ?? []).map((s: { name: string }) => s.name);
      expect(profileSubcommands).toContain('view');
      expect(profileSubcommands).toContain('edit');
      expect(profileSubcommands).toContain('create');
      expect(profileSubcommands).toContain('list');
      expect(profileSubcommands).toContain('default');
    });

    it('should have profile, timezone, and preset subcommand groups (settings and override merged into profile)', () => {
      const json = data.toJSON();
      const options = json.options ?? [];

      // Find subcommand groups (type 2)
      const groups = options.filter((opt: { type: number }) => opt.type === 2);
      const groupNames = groups.map((g: { name: string }) => g.name);

      expect(groupNames).toContain('profile');
      expect(groupNames).toContain('timezone');
      expect(groupNames).toContain('preset');
      // settings and override groups were removed - their commands are now under profile
      expect(groupNames).not.toContain('settings');
      expect(groupNames).not.toContain('override');
    });

    it('should have share-ltm, override-set, and override-clear under profile group', () => {
      const json = data.toJSON();
      const options = json.options ?? [];

      const groups = options.filter((opt: { type: number }) => opt.type === 2);
      const profileGroup = groups.find((g: { name: string }) => g.name === 'profile');

      const profileSubcommands = (profileGroup?.options ?? []).map((s: { name: string }) => s.name);
      expect(profileSubcommands).toContain('share-ltm');
      expect(profileSubcommands).toContain('override-set');
      expect(profileSubcommands).toContain('override-clear');
    });
  });

  describe('execute - subcommand routing', () => {
    it('should route to view handler for /me profile view', async () => {
      const { handleViewPersona } = await import('./profile/view.js');

      const interaction = {
        isModalSubmit: () => false,
        options: {
          getSubcommandGroup: () => 'profile',
          getSubcommand: () => 'view',
        },
        user: { id: '123' },
      } as any;

      await execute(interaction);

      expect(handleViewPersona).toHaveBeenCalledWith(interaction);
    });

    it('should route to edit handler for /me profile edit', async () => {
      const { handleEditPersona } = await import('./profile/edit.js');

      const interaction = {
        isModalSubmit: () => false,
        options: {
          getSubcommandGroup: () => 'profile',
          getSubcommand: () => 'edit',
          getString: () => null, // No persona specified
        },
        user: { id: '123' },
      } as any;

      await execute(interaction);

      expect(handleEditPersona).toHaveBeenCalledWith(interaction, null);
    });

    it('should pass profile ID to edit handler when specified', async () => {
      const { handleEditPersona } = await import('./profile/edit.js');

      const interaction = {
        isModalSubmit: () => false,
        options: {
          getSubcommandGroup: () => 'profile',
          getSubcommand: () => 'edit',
          getString: () => 'persona-123',
        },
        user: { id: '123' },
      } as any;

      await execute(interaction);

      expect(handleEditPersona).toHaveBeenCalledWith(interaction, 'persona-123');
    });

    it('should route to create handler for /me profile create', async () => {
      const { handleCreatePersona } = await import('./profile/create.js');

      const interaction = {
        isModalSubmit: () => false,
        options: {
          getSubcommandGroup: () => 'profile',
          getSubcommand: () => 'create',
        },
        user: { id: '123' },
      } as any;

      await execute(interaction);

      expect(handleCreatePersona).toHaveBeenCalledWith(interaction);
    });

    it('should route to list handler for /me profile list', async () => {
      const { handleListPersonas } = await import('./profile/list.js');

      const interaction = {
        isModalSubmit: () => false,
        options: {
          getSubcommandGroup: () => 'profile',
          getSubcommand: () => 'list',
        },
        user: { id: '123' },
      } as any;

      await execute(interaction);

      expect(handleListPersonas).toHaveBeenCalledWith(interaction);
    });

    it('should route to default handler for /me profile default', async () => {
      const { handleSetDefaultPersona } = await import('./profile/default.js');

      const interaction = {
        isModalSubmit: () => false,
        options: {
          getSubcommandGroup: () => 'profile',
          getSubcommand: () => 'default',
        },
        user: { id: '123' },
      } as any;

      await execute(interaction);

      expect(handleSetDefaultPersona).toHaveBeenCalledWith(interaction);
    });

    it('should route to share-ltm handler for /me profile share-ltm', async () => {
      const { handleShareLtmSetting } = await import('./profile/share-ltm.js');

      const interaction = {
        isModalSubmit: () => false,
        options: {
          getSubcommandGroup: () => 'profile',
          getSubcommand: () => 'share-ltm',
        },
        user: { id: '123' },
      } as any;

      await execute(interaction);

      expect(handleShareLtmSetting).toHaveBeenCalledWith(interaction);
    });

    it('should route to override-set handler for /me profile override-set', async () => {
      const { handleOverrideSet } = await import('./profile/override-set.js');

      const interaction = {
        isModalSubmit: () => false,
        options: {
          getSubcommandGroup: () => 'profile',
          getSubcommand: () => 'override-set',
        },
        user: { id: '123' },
      } as any;

      await execute(interaction);

      expect(handleOverrideSet).toHaveBeenCalledWith(interaction);
    });

    it('should route to override-clear handler for /me profile override-clear', async () => {
      const { handleOverrideClear } = await import('./profile/override-clear.js');

      const interaction = {
        isModalSubmit: () => false,
        options: {
          getSubcommandGroup: () => 'profile',
          getSubcommand: () => 'override-clear',
        },
        user: { id: '123' },
      } as any;

      await execute(interaction);

      expect(handleOverrideClear).toHaveBeenCalledWith(interaction);
    });
  });

  describe('handleModal - modal routing', () => {
    it('should route me::profile::create modal to create handler', async () => {
      const { handleCreateModalSubmit } = await import('./profile/create.js');

      const interaction = {
        customId: 'me::profile::create',
      } as any;

      await handleModal(interaction);

      expect(handleCreateModalSubmit).toHaveBeenCalledWith(interaction);
    });

    it('should route me::profile::edit::new modal to edit handler', async () => {
      const { handleEditModalSubmit } = await import('./profile/edit.js');

      const interaction = {
        customId: 'me::profile::edit::new',
      } as any;

      await handleModal(interaction);

      expect(handleEditModalSubmit).toHaveBeenCalledWith(interaction, 'new');
    });

    it('should route me::profile::edit::{id} modal to edit handler with ID', async () => {
      const { handleEditModalSubmit } = await import('./profile/edit.js');

      // UUID can contain hyphens - the :: delimiter allows proper parsing
      const interaction = {
        customId: 'me::profile::edit::a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      } as any;

      await handleModal(interaction);

      expect(handleEditModalSubmit).toHaveBeenCalledWith(
        interaction,
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      );
    });

    it('should route me::override::create modal to override create handler', async () => {
      const { handleOverrideCreateModalSubmit } = await import('./profile/override-set.js');

      // UUID can contain hyphens - the :: delimiter allows proper parsing
      const interaction = {
        customId: 'me::override::create::a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      } as any;

      await handleModal(interaction);

      expect(handleOverrideCreateModalSubmit).toHaveBeenCalledWith(
        interaction,
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      );
    });
  });

  describe('autocomplete', () => {
    it('should route personality option to personality autocomplete', async () => {
      const { handleMePersonalityAutocomplete } = await import('./autocomplete.js');

      const interaction = {
        options: {
          getFocused: () => ({ name: 'personality', value: '' }),
          getSubcommandGroup: () => 'profile',
          getSubcommand: () => 'override-set',
        },
      } as any;

      await autocomplete(interaction);

      expect(handleMePersonalityAutocomplete).toHaveBeenCalledWith(interaction);
    });

    it('should route profile option to profile autocomplete without create option', async () => {
      const { handlePersonaAutocomplete } = await import('./autocomplete.js');

      const interaction = {
        options: {
          getFocused: () => ({ name: 'profile', value: '' }),
          getSubcommandGroup: () => 'profile',
          getSubcommand: () => 'edit',
        },
      } as any;

      await autocomplete(interaction);

      expect(handlePersonaAutocomplete).toHaveBeenCalledWith(interaction, false);
    });

    it('should route profile option in override-set to autocomplete with create option', async () => {
      const { handlePersonaAutocomplete } = await import('./autocomplete.js');

      const interaction = {
        options: {
          getFocused: () => ({ name: 'profile', value: '' }),
          getSubcommandGroup: () => 'profile',
          getSubcommand: () => 'override-set',
        },
      } as any;

      await autocomplete(interaction);

      expect(handlePersonaAutocomplete).toHaveBeenCalledWith(interaction, true);
    });
  });
});
