/**
 * Tests for Profile Command Index
 * Tests command routing and modal handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { data, execute, autocomplete } from './index.js';

// Mock all handler modules
vi.mock('./view.js', () => ({
  handleViewPersona: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./edit.js', () => ({
  handleEditPersona: vi.fn().mockResolvedValue(undefined),
  handleEditModalSubmit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./create.js', () => ({
  handleCreatePersona: vi.fn().mockResolvedValue(undefined),
  handleCreateModalSubmit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./list.js', () => ({
  handleListPersonas: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./default.js', () => ({
  handleSetDefaultPersona: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./settings.js', () => ({
  handleShareLtmSetting: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./override.js', () => ({
  handleOverrideSet: vi.fn().mockResolvedValue(undefined),
  handleOverrideClear: vi.fn().mockResolvedValue(undefined),
  handleOverrideCreateModalSubmit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./autocomplete.js', () => ({
  handlePersonalityAutocomplete: vi.fn().mockResolvedValue(undefined),
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

describe('Profile Command Index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command data', () => {
    it('should have correct name and description', () => {
      expect(data.name).toBe('profile');
      expect(data.description).toBe('Manage your profiles for AI interactions');
    });

    it('should have all subcommands', () => {
      const json = data.toJSON();
      const options = json.options ?? [];

      // Find subcommands (type 1)
      const subcommands = options.filter((opt: { type: number }) => opt.type === 1);
      const subcommandNames = subcommands.map((s: { name: string }) => s.name);

      expect(subcommandNames).toContain('view');
      expect(subcommandNames).toContain('edit');
      expect(subcommandNames).toContain('create');
      expect(subcommandNames).toContain('list');
      expect(subcommandNames).toContain('default');
    });

    it('should have settings and override subcommand groups', () => {
      const json = data.toJSON();
      const options = json.options ?? [];

      // Find subcommand groups (type 2)
      const groups = options.filter((opt: { type: number }) => opt.type === 2);
      const groupNames = groups.map((g: { name: string }) => g.name);

      expect(groupNames).toContain('settings');
      expect(groupNames).toContain('override');
    });
  });

  describe('execute - subcommand routing', () => {
    it('should route to view handler for /profile view', async () => {
      const { handleViewPersona } = await import('./view.js');

      const interaction = {
        isModalSubmit: () => false,
        options: {
          getSubcommandGroup: () => null,
          getSubcommand: () => 'view',
        },
        user: { id: '123' },
      } as any;

      await execute(interaction);

      expect(handleViewPersona).toHaveBeenCalledWith(interaction);
    });

    it('should route to edit handler for /profile edit', async () => {
      const { handleEditPersona } = await import('./edit.js');

      const interaction = {
        isModalSubmit: () => false,
        options: {
          getSubcommandGroup: () => null,
          getSubcommand: () => 'edit',
          getString: () => null, // No persona specified
        },
        user: { id: '123' },
      } as any;

      await execute(interaction);

      expect(handleEditPersona).toHaveBeenCalledWith(interaction, null);
    });

    it('should pass profile ID to edit handler when specified', async () => {
      const { handleEditPersona } = await import('./edit.js');

      const interaction = {
        isModalSubmit: () => false,
        options: {
          getSubcommandGroup: () => null,
          getSubcommand: () => 'edit',
          getString: () => 'persona-123',
        },
        user: { id: '123' },
      } as any;

      await execute(interaction);

      expect(handleEditPersona).toHaveBeenCalledWith(interaction, 'persona-123');
    });

    it('should route to create handler for /profile create', async () => {
      const { handleCreatePersona } = await import('./create.js');

      const interaction = {
        isModalSubmit: () => false,
        options: {
          getSubcommandGroup: () => null,
          getSubcommand: () => 'create',
        },
        user: { id: '123' },
      } as any;

      await execute(interaction);

      expect(handleCreatePersona).toHaveBeenCalledWith(interaction);
    });

    it('should route to list handler for /profile list', async () => {
      const { handleListPersonas } = await import('./list.js');

      const interaction = {
        isModalSubmit: () => false,
        options: {
          getSubcommandGroup: () => null,
          getSubcommand: () => 'list',
        },
        user: { id: '123' },
      } as any;

      await execute(interaction);

      expect(handleListPersonas).toHaveBeenCalledWith(interaction);
    });

    it('should route to default handler for /profile default', async () => {
      const { handleSetDefaultPersona } = await import('./default.js');

      const interaction = {
        isModalSubmit: () => false,
        options: {
          getSubcommandGroup: () => null,
          getSubcommand: () => 'default',
        },
        user: { id: '123' },
      } as any;

      await execute(interaction);

      expect(handleSetDefaultPersona).toHaveBeenCalledWith(interaction);
    });

    it('should route to settings handler for /profile settings share-ltm', async () => {
      const { handleShareLtmSetting } = await import('./settings.js');

      const interaction = {
        isModalSubmit: () => false,
        options: {
          getSubcommandGroup: () => 'settings',
          getSubcommand: () => 'share-ltm',
        },
        user: { id: '123' },
      } as any;

      await execute(interaction);

      expect(handleShareLtmSetting).toHaveBeenCalledWith(interaction);
    });

    it('should route to override set handler for /profile override set', async () => {
      const { handleOverrideSet } = await import('./override.js');

      const interaction = {
        isModalSubmit: () => false,
        options: {
          getSubcommandGroup: () => 'override',
          getSubcommand: () => 'set',
        },
        user: { id: '123' },
      } as any;

      await execute(interaction);

      expect(handleOverrideSet).toHaveBeenCalledWith(interaction);
    });

    it('should route to override clear handler for /profile override clear', async () => {
      const { handleOverrideClear } = await import('./override.js');

      const interaction = {
        isModalSubmit: () => false,
        options: {
          getSubcommandGroup: () => 'override',
          getSubcommand: () => 'clear',
        },
        user: { id: '123' },
      } as any;

      await execute(interaction);

      expect(handleOverrideClear).toHaveBeenCalledWith(interaction);
    });
  });

  describe('execute - modal routing', () => {
    it('should route profile-create modal to create handler', async () => {
      const { handleCreateModalSubmit } = await import('./create.js');

      const interaction = {
        isModalSubmit: () => true,
        customId: 'profile-create',
      } as any;

      await execute(interaction);

      expect(handleCreateModalSubmit).toHaveBeenCalledWith(interaction);
    });

    it('should route profile-edit-new modal to edit handler', async () => {
      const { handleEditModalSubmit } = await import('./edit.js');

      const interaction = {
        isModalSubmit: () => true,
        customId: 'profile-edit-new',
      } as any;

      await execute(interaction);

      expect(handleEditModalSubmit).toHaveBeenCalledWith(interaction, 'new');
    });

    it('should route profile-edit-{id} modal to edit handler with ID', async () => {
      const { handleEditModalSubmit } = await import('./edit.js');

      const interaction = {
        isModalSubmit: () => true,
        customId: 'profile-edit-persona-uuid-123',
      } as any;

      await execute(interaction);

      expect(handleEditModalSubmit).toHaveBeenCalledWith(interaction, 'persona-uuid-123');
    });

    it('should route profile-override-create modal to override create handler', async () => {
      const { handleOverrideCreateModalSubmit } = await import('./override.js');

      const interaction = {
        isModalSubmit: () => true,
        customId: 'profile-override-create-personality-uuid-123',
      } as any;

      await execute(interaction);

      expect(handleOverrideCreateModalSubmit).toHaveBeenCalledWith(
        interaction,
        'personality-uuid-123'
      );
    });
  });

  describe('autocomplete', () => {
    it('should route personality option to personality autocomplete', async () => {
      const { handlePersonalityAutocomplete } = await import('./autocomplete.js');

      const interaction = {
        options: {
          getFocused: () => ({ name: 'personality', value: '' }),
          getSubcommandGroup: () => 'override',
          getSubcommand: () => 'set',
        },
      } as any;

      await autocomplete(interaction);

      expect(handlePersonalityAutocomplete).toHaveBeenCalledWith(interaction);
    });

    it('should route profile option to profile autocomplete without create option', async () => {
      const { handlePersonaAutocomplete } = await import('./autocomplete.js');

      const interaction = {
        options: {
          getFocused: () => ({ name: 'profile', value: '' }),
          getSubcommandGroup: () => null,
          getSubcommand: () => 'edit',
        },
      } as any;

      await autocomplete(interaction);

      expect(handlePersonaAutocomplete).toHaveBeenCalledWith(interaction, false);
    });

    it('should route profile option in override set to autocomplete with create option', async () => {
      const { handlePersonaAutocomplete } = await import('./autocomplete.js');

      const interaction = {
        options: {
          getFocused: () => ({ name: 'profile', value: '' }),
          getSubcommandGroup: () => 'override',
          getSubcommand: () => 'set',
        },
      } as any;

      await autocomplete(interaction);

      expect(handlePersonaAutocomplete).toHaveBeenCalledWith(interaction, true);
    });
  });
});
