/**
 * Tests for Persona Command Index
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

vi.mock('./settings.js', () => ({
  handleShareLtmSetting: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./override.js', () => ({
  handleOverrideSet: vi.fn().mockResolvedValue(undefined),
  handleOverrideClear: vi.fn().mockResolvedValue(undefined),
  handleOverrideModalSubmit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./autocomplete.js', () => ({
  handlePersonalityAutocomplete: vi.fn().mockResolvedValue(undefined),
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

describe('Persona Command Index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command data', () => {
    it('should have correct name and description', () => {
      expect(data.name).toBe('persona');
      expect(data.description).toBe('Manage your persona for AI interactions');
    });

    it('should have view and edit subcommands', () => {
      const json = data.toJSON();
      const options = json.options ?? [];

      // Find subcommands (type 1)
      const subcommands = options.filter((opt: { type: number }) => opt.type === 1);
      const subcommandNames = subcommands.map((s: { name: string }) => s.name);

      expect(subcommandNames).toContain('view');
      expect(subcommandNames).toContain('edit');
    });

    it('should have settings subcommand group', () => {
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
    it('should route to view handler for /persona view', async () => {
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

    it('should route to edit handler for /persona edit', async () => {
      const { handleEditPersona } = await import('./edit.js');

      const interaction = {
        isModalSubmit: () => false,
        options: {
          getSubcommandGroup: () => null,
          getSubcommand: () => 'edit',
        },
        user: { id: '123' },
      } as any;

      await execute(interaction);

      expect(handleEditPersona).toHaveBeenCalledWith(interaction);
    });

    it('should route to settings handler for /persona settings share-ltm', async () => {
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

    it('should route to override set handler for /persona override set', async () => {
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

    it('should route to override clear handler for /persona override clear', async () => {
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
    it('should route persona-edit modal to edit handler', async () => {
      const { handleEditModalSubmit } = await import('./edit.js');

      const interaction = {
        isModalSubmit: () => true,
        customId: 'persona-edit',
      } as any;

      await execute(interaction);

      expect(handleEditModalSubmit).toHaveBeenCalledWith(interaction);
    });

    it('should route persona-override modal to override handler', async () => {
      const { handleOverrideModalSubmit } = await import('./override.js');

      const interaction = {
        isModalSubmit: () => true,
        customId: 'persona-override-personality-uuid-123',
      } as any;

      await execute(interaction);

      expect(handleOverrideModalSubmit).toHaveBeenCalledWith(interaction, 'personality-uuid-123');
    });
  });

  describe('autocomplete', () => {
    it('should route to personality autocomplete handler', async () => {
      const { handlePersonalityAutocomplete } = await import('./autocomplete.js');

      const interaction = {} as any;
      await autocomplete(interaction);

      expect(handlePersonalityAutocomplete).toHaveBeenCalledWith(interaction);
    });
  });
});
