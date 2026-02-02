/**
 * Tests for Persona Command Index
 * Tests command routing, modal handling, and button/select interactions
 *
 * Architecture Note:
 * Command name 'persona' matches dashboard entityType 'persona', so
 * NO componentPrefixes are needed (unlike /me which needs 'profile').
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import personaCommand from './index.js';

// Destructure from default export
const { data, execute, autocomplete, handleModal, handleButton, handleSelectMenu } = personaCommand;

// Mock all handler modules
vi.mock('./view.js', () => ({
  handleViewPersona: vi.fn().mockResolvedValue(undefined),
  handleExpandContent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./create.js', () => ({
  handleCreatePersona: vi.fn().mockResolvedValue(undefined),
  handleCreateModalSubmit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./default.js', () => ({
  handleSetDefaultPersona: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./share-ltm.js', () => ({
  handleShareLtmSetting: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./override/set.js', () => ({
  handleOverrideSet: vi.fn().mockResolvedValue(undefined),
  handleOverrideCreateModalSubmit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./override/clear.js', () => ({
  handleOverrideClear: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./autocomplete.js', () => ({
  handlePersonalityAutocomplete: vi.fn().mockResolvedValue(undefined),
  handlePersonaAutocomplete: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./edit.js', () => ({
  handleEditPersona: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./browse.js', () => ({
  handleBrowse: vi.fn().mockResolvedValue(undefined),
  handleBrowsePagination: vi.fn().mockResolvedValue(undefined),
  handleBrowseSelect: vi.fn().mockResolvedValue(undefined),
  isPersonaBrowseInteraction: vi
    .fn()
    .mockImplementation((customId: string) => customId.includes('::browse::')),
  isPersonaBrowseSelectInteraction: vi
    .fn()
    .mockImplementation((customId: string) => customId.includes('::browse-select::')),
}));

vi.mock('./dashboard.js', () => ({
  handleButton: vi.fn().mockResolvedValue(undefined),
  handleSelectMenu: vi.fn().mockResolvedValue(undefined),
  handleModalSubmit: vi.fn().mockResolvedValue(undefined),
  isPersonaDashboardInteraction: vi
    .fn()
    .mockImplementation(
      (customId: string) =>
        customId.startsWith('persona::') &&
        (customId.includes('::menu::') ||
          customId.includes('::modal::') ||
          customId.includes('::close::') ||
          customId.includes('::refresh::') ||
          customId.includes('::delete::'))
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

describe('Persona Command Index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command data', () => {
    it('should have correct name and description', () => {
      expect(data.name).toBe('persona');
      expect(data.description).toBe('Manage your AI personas');
    });

    it('should have expected top-level subcommands', () => {
      const json = data.toJSON();
      const options = json.options ?? [];

      // Find subcommands (type 1)
      const subcommands = options.filter((opt: { type: number }) => opt.type === 1);
      const subcommandNames = subcommands.map((s: { name: string }) => s.name);

      expect(subcommandNames).toContain('view');
      expect(subcommandNames).toContain('edit');
      expect(subcommandNames).toContain('create');
      expect(subcommandNames).toContain('browse');
      expect(subcommandNames).toContain('default');
      expect(subcommandNames).toContain('share-ltm');
    });

    it('should have override subcommand group with set and clear', () => {
      const json = data.toJSON();
      const options = json.options ?? [];

      // Find subcommand groups (type 2)
      const groups = options.filter((opt: { type: number }) => opt.type === 2);
      const overrideGroup = groups.find((g: { name: string }) => g.name === 'override');

      expect(overrideGroup).toBeDefined();

      // Check override group has expected subcommands
      const overrideSubcommands = (
        (overrideGroup as { options?: { name: string }[] })?.options ?? []
      ).map((s: { name: string }) => s.name);
      expect(overrideSubcommands).toContain('set');
      expect(overrideSubcommands).toContain('clear');
    });

    it('should NOT have componentPrefixes (command name = entityType)', () => {
      // This is the key architectural difference from /me
      // Command name 'persona' matches entityType 'persona', so no componentPrefixes needed
      expect((personaCommand as { componentPrefixes?: unknown }).componentPrefixes).toBeUndefined();
    });
  });

  describe('execute - subcommand routing', () => {
    /**
     * Create a mock SafeCommandContext for routing tests
     */
    function createMockContext(
      subcommand: string,
      group: string | null = null,
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

    it('should route to view handler for /persona view', async () => {
      const { handleViewPersona } = await import('./view.js');
      const context = createMockContext('view');

      await execute(context);

      expect(handleViewPersona).toHaveBeenCalledWith(context);
    });

    it('should route to edit handler for /persona edit', async () => {
      const { handleEditPersona } = await import('./edit.js');
      const context = createMockContext('edit');

      await execute(context);

      expect(handleEditPersona).toHaveBeenCalledWith(context, null);
    });

    it('should pass persona ID to edit handler when specified', async () => {
      const { handleEditPersona } = await import('./edit.js');
      const context = createMockContext('edit', null, {
        getString: () => 'persona-123',
      });

      await execute(context);

      expect(handleEditPersona).toHaveBeenCalledWith(context, 'persona-123');
    });

    it('should route to create handler for /persona create', async () => {
      const { handleCreatePersona } = await import('./create.js');
      const context = createMockContext('create');

      await execute(context);

      expect(handleCreatePersona).toHaveBeenCalledWith(context);
    });

    it('should route to browse handler for /persona browse', async () => {
      const { handleBrowse } = await import('./browse.js');
      const context = createMockContext('browse');

      await execute(context);

      expect(handleBrowse).toHaveBeenCalledWith(context);
    });

    it('should route to default handler for /persona default', async () => {
      const { handleSetDefaultPersona } = await import('./default.js');
      const context = createMockContext('default');

      await execute(context);

      expect(handleSetDefaultPersona).toHaveBeenCalledWith(context);
    });

    it('should route to share-ltm handler for /persona share-ltm', async () => {
      const { handleShareLtmSetting } = await import('./share-ltm.js');
      const context = createMockContext('share-ltm');

      await execute(context);

      expect(handleShareLtmSetting).toHaveBeenCalledWith(context);
    });

    it('should route to override set handler for /persona override set', async () => {
      const { handleOverrideSet } = await import('./override/set.js');
      const context = createMockContext('set', 'override');

      await execute(context);

      expect(handleOverrideSet).toHaveBeenCalledWith(context);
    });

    it('should route to override clear handler for /persona override clear', async () => {
      const { handleOverrideClear } = await import('./override/clear.js');
      const context = createMockContext('clear', 'override');

      await execute(context);

      expect(handleOverrideClear).toHaveBeenCalledWith(context);
    });
  });

  describe('handleModal - modal routing', () => {
    it('should route persona::create modal to create handler', async () => {
      const { handleCreateModalSubmit } = await import('./create.js');

      const interaction = {
        customId: 'persona::create',
      } as any;

      await handleModal(interaction);

      expect(handleCreateModalSubmit).toHaveBeenCalledWith(interaction);
    });

    it('should route persona dashboard modals to dashboard handler', async () => {
      const { handleModalSubmit: handleDashboardModalSubmit } = await import('./dashboard.js');

      // Persona dashboard modals have format: persona::modal::{entityId}::{sectionId}
      const interaction = {
        customId: 'persona::modal::a1b2c3d4-e5f6-7890-abcd-ef1234567890::identity',
      } as any;

      await handleModal(interaction);

      expect(handleDashboardModalSubmit).toHaveBeenCalledWith(interaction);
    });

    it('should route persona::override-create modal to override create handler', async () => {
      const { handleOverrideCreateModalSubmit } = await import('./override/set.js');

      const interaction = {
        customId: 'persona::override-create::a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      } as any;

      await handleModal(interaction);

      expect(handleOverrideCreateModalSubmit).toHaveBeenCalledWith(
        interaction,
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      );
    });
  });

  describe('handleButton - button routing', () => {
    it('should route browse pagination buttons to browse handler', async () => {
      const { handleBrowsePagination } = await import('./browse.js');

      const interaction = {
        customId: 'persona::browse::1::name',
      } as any;

      await handleButton(interaction);

      expect(handleBrowsePagination).toHaveBeenCalledWith(interaction);
    });

    it('should route dashboard buttons to dashboard handler', async () => {
      const { handleButton: handleDashboardButton } = await import('./dashboard.js');

      const interaction = {
        customId: 'persona::close::a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      } as any;

      await handleButton(interaction);

      expect(handleDashboardButton).toHaveBeenCalledWith(interaction);
    });

    it('should route expand buttons to expand handler', async () => {
      const { handleExpandContent } = await import('./view.js');

      const interaction = {
        customId: 'persona::expand::persona-123::backstory',
      } as any;

      await handleButton(interaction);

      expect(handleExpandContent).toHaveBeenCalledWith(interaction, 'persona-123', 'backstory');
    });
  });

  describe('handleSelectMenu - select menu routing', () => {
    it('should route browse select to browse select handler', async () => {
      const { handleBrowseSelect } = await import('./browse.js');

      const interaction = {
        customId: 'persona::browse-select::0::name',
      } as any;

      await handleSelectMenu(interaction);

      expect(handleBrowseSelect).toHaveBeenCalledWith(interaction);
    });

    it('should route dashboard select to dashboard handler', async () => {
      const { handleSelectMenu: handleDashboardSelectMenu } = await import('./dashboard.js');

      const interaction = {
        customId: 'persona::menu::a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      } as any;

      await handleSelectMenu(interaction);

      expect(handleDashboardSelectMenu).toHaveBeenCalledWith(interaction);
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

    it('should route persona option to persona autocomplete without create option', async () => {
      const { handlePersonaAutocomplete } = await import('./autocomplete.js');

      const interaction = {
        options: {
          getFocused: () => ({ name: 'persona', value: '' }),
          getSubcommandGroup: () => null,
          getSubcommand: () => 'edit',
        },
      } as any;

      await autocomplete(interaction);

      expect(handlePersonaAutocomplete).toHaveBeenCalledWith(interaction, false);
    });

    it('should route persona option in override set to autocomplete with create option', async () => {
      const { handlePersonaAutocomplete } = await import('./autocomplete.js');

      const interaction = {
        options: {
          getFocused: () => ({ name: 'persona', value: '' }),
          getSubcommandGroup: () => 'override',
          getSubcommand: () => 'set',
        },
      } as any;

      await autocomplete(interaction);

      expect(handlePersonaAutocomplete).toHaveBeenCalledWith(interaction, true);
    });

    it('should return empty array for unknown options', async () => {
      const interaction = {
        options: {
          getFocused: () => ({ name: 'unknown', value: '' }),
          getSubcommandGroup: () => null,
          getSubcommand: () => 'view',
        },
        respond: vi.fn(),
      } as any;

      await autocomplete(interaction);

      expect(interaction.respond).toHaveBeenCalledWith([]);
    });
  });
});
