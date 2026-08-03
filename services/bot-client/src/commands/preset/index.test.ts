/**
 * Tests for Preset Command Group
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import presetCommand from './index.js';

// Destructure from default export
const { data, execute } = presetCommand;

// Mock common-types
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

// Mock requireBotOwnerContext from factories
const mockRequireBotOwnerContext = vi.fn();
vi.mock('../../utils/commandContext/factories.js', () => ({
  requireBotOwnerContext: (...args: unknown[]) => mockRequireBotOwnerContext(...args),
}));

// Mock subcommand handlers
vi.mock('./browse.js', () => ({
  handleBrowse: vi.fn(),
  handleBrowsePagination: vi.fn(),
  isPresetBrowseInteraction: vi.fn(),
}));
vi.mock('./create.js', () => ({ handleCreate: vi.fn(), buildPresetSeedModal: vi.fn() }));
const presetRetryHandle = vi.hoisted(() => vi.fn());
vi.mock('../../utils/modal/retry.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../utils/modal/retry.js')>();
  return { ...actual, handleModalRetry: presetRetryHandle };
});
// Note: delete is now handled via the dashboard, not a standalone command

// Mock global subcommand handlers
vi.mock('./global/default.js', () => ({ handleGlobalSetDefault: vi.fn() }));
vi.mock('./global/free-default.js', () => ({ handleGlobalSetFreeDefault: vi.fn() }));

// Mock override subcommand handlers (moved from /settings preset)
vi.mock('./override/browse.js', () => ({
  handlePresetBrowse: vi.fn(),
  handlePresetBrowseSelect: vi.fn(),
  handlePresetBrowseButton: vi.fn(),
  isPresetOverrideInteraction: vi.fn(() => false),
  PRESET_OVERRIDE_PREFIX: 'settings-preset-override',
}));
vi.mock('./override/set.js', () => ({ handleSet: vi.fn() }));
vi.mock('./override/clear.js', () => ({ handleClear: vi.fn() }));
vi.mock('./default/set.js', () => ({ handleDefaultSet: vi.fn() }));
vi.mock('./default/clear.js', () => ({ handleDefaultClear: vi.fn() }));
vi.mock('./override/autocomplete.js', () => ({ handleAutocomplete: vi.fn() }));

import { handleBrowse, isPresetBrowseInteraction } from './browse.js';
import { buildPresetSeedModal } from './create.js';
import { buildModalRetryRow } from '../../utils/modal/retry.js';
import { handleCreate } from './create.js';
import { handleGlobalSetDefault } from './global/default.js';
import { handleGlobalSetFreeDefault } from './global/free-default.js';
import {
  handlePresetBrowse as handleOverrideBrowse,
  handlePresetBrowseSelect as handleOverrideBrowseSelect,
  handlePresetBrowseButton as handleOverrideBrowseButton,
  isPresetOverrideInteraction,
} from './override/browse.js';
import { handleSet as handleOverrideSet } from './override/set.js';
import { handleClear as handleOverrideClear } from './override/clear.js';
import { handleDefaultSet } from './default/set.js';
import { handleDefaultClear } from './default/clear.js';
import { handleAutocomplete as handleOverrideAutocomplete } from './override/autocomplete.js';

describe('Preset Command', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockReply = vi.fn();

  function createMockContext(subcommand: string, subcommandGroup: string | null = null) {
    return {
      user: { id: '123456789' },
      interaction: {
        options: {
          getSubcommand: () => subcommand,
          getSubcommandGroup: () => subcommandGroup,
        },
      },
      getSubcommand: () => subcommand,
      getSubcommandGroup: () => subcommandGroup,
      editReply: mockEditReply,
      reply: mockReply,
    } as unknown as Parameters<typeof execute>[0];
  }

  describe('command data', () => {
    it('should have correct command name and description', () => {
      expect(data.name).toBe('preset');
      expect(data.description).toBe('Manage your model presets');
    });

    it('should have global subcommand group', () => {
      const json = data.toJSON();
      const options = json.options ?? [];

      // Find subcommand groups (type 2)
      const groups = options.filter((opt: { type: number }) => opt.type === 2);
      const globalGroup = groups.find((g: { name: string }) => g.name === 'global');

      expect(globalGroup).toBeDefined();

      // Check global group has expected subcommands
      const globalSubcommands = (
        (globalGroup as { options?: { name: string }[] })?.options ?? []
      ).map((s: { name: string }) => s.name);
      expect(globalSubcommands).toContain('default');
      expect(globalSubcommands).toContain('free-default');
      // Note: 'create' was removed - global presets are created via /preset create + toggle
      // Note: 'edit' was removed - global presets can be edited via /preset edit
    });

    it('should have override subcommand group with symmetric browse/set/clear', () => {
      const json = data.toJSON();
      const options = json.options ?? [];

      const groups = options.filter((opt: { type: number }) => opt.type === 2);
      const overrideGroup = groups.find((g: { name: string }) => g.name === 'override');

      expect(overrideGroup).toBeDefined();

      const subcommands = ((overrideGroup as { options?: { name: string }[] })?.options ?? []).map(
        s => s.name
      );
      // The override group is per-character only; the account default lives in
      // its own `default` group — a default is a baseline, not an override.
      expect(subcommands).toEqual(['browse', 'set', 'clear']);
    });

    it('exposes the account default as a `default` group, not root verb-suffix subcommands', () => {
      const json = presetCommand.data.toJSON();
      const options = json.options ?? [];

      const rootSubNames = options.filter(opt => opt.type === 1).map(opt => opt.name);
      expect(rootSubNames).not.toContain('set-default');
      expect(rootSubNames).not.toContain('clear-default');

      const defaultGroup = options
        .filter((opt: { type: number }) => opt.type === 2)
        .find((g: { name: string }) => g.name === 'default');
      expect(defaultGroup).toBeDefined();

      const defaultSubcommands = (
        (defaultGroup as { options?: { name: string }[] })?.options ?? []
      ).map(s => s.name);
      expect(defaultSubcommands).toEqual(['set', 'clear']);
    });

    it('keeps the historical override componentPrefix for in-flight components', () => {
      // The string predates the /settings preset → /preset override move —
      // renaming it would dead-end components on pre-rename messages.
      expect(presetCommand.componentPrefixes).toEqual(['settings-preset-override']);
    });
  });

  describe('user preset routing', () => {
    it('should route "browse" to handleBrowse', async () => {
      const context = createMockContext('browse');
      await execute(context);
      expect(handleBrowse).toHaveBeenCalledWith(context);
    });

    it('should route "create" to handleCreate', async () => {
      const context = createMockContext('create');
      await execute(context);
      expect(handleCreate).toHaveBeenCalledWith(context);
    });

    // Note: delete is now handled via the dashboard, not a standalone command

    it('should reply with error for unknown subcommand', async () => {
      const context = createMockContext('unknown');
      await execute(context);
      // Mixed mode router uses reply() for unknown subcommands since context isn't deferred
      expect(mockReply).toHaveBeenCalledWith({
        content: '❌ Unknown subcommand',
      });
    });
  });

  describe('global preset routing (owner only)', () => {
    it('should check owner permission for global subcommands', async () => {
      mockRequireBotOwnerContext.mockResolvedValue(false);
      const context = createMockContext('default', 'global');

      await execute(context);

      expect(mockRequireBotOwnerContext).toHaveBeenCalledWith(context);
      expect(handleGlobalSetDefault).not.toHaveBeenCalled();
    });

    it('should route to handleGlobalSetDefault when owner check passes', async () => {
      mockRequireBotOwnerContext.mockResolvedValue(true);
      const context = createMockContext('default', 'global');

      await execute(context);

      expect(handleGlobalSetDefault).toHaveBeenCalledWith(context);
    });

    it('should route to handleGlobalSetFreeDefault when owner check passes', async () => {
      mockRequireBotOwnerContext.mockResolvedValue(true);
      const context = createMockContext('free-default', 'global');

      await execute(context);

      expect(handleGlobalSetFreeDefault).toHaveBeenCalledWith(context);
    });
  });

  describe('override group routing (moved from /settings preset)', () => {
    it.each([
      ['browse', handleOverrideBrowse],
      ['set', handleOverrideSet],
      ['clear', handleOverrideClear],
    ])('routes override %s to its handler', async (subcommand, handler) => {
      const context = createMockContext(subcommand as string, 'override');
      await execute(context);
      expect(handler).toHaveBeenCalledWith(context);
    });

    it.each([
      ['set', handleDefaultSet],
      ['clear', handleDefaultClear],
    ])('routes default %s to the account-default handler', async (subcommand, handler) => {
      const context = createMockContext(subcommand as string, 'default');
      await execute(context);
      expect(handler).toHaveBeenCalledWith(context);
    });

    it('does NOT owner-gate the override group', async () => {
      const context = createMockContext('browse', 'override');
      await execute(context);
      expect(mockRequireBotOwnerContext).not.toHaveBeenCalled();
    });
  });

  describe('autocomplete routing', () => {
    it('routes override-group autocomplete to the override handler', async () => {
      const interaction = {
        options: {
          getFocused: () => ({ name: 'preset', value: '' }),
          getSubcommandGroup: () => 'override',
        },
      } as never;

      await presetCommand.autocomplete?.(interaction);

      expect(handleOverrideAutocomplete).toHaveBeenCalledWith(interaction);
    });

    it('routes `default set` autocomplete to the ASSIGNABLE pool handler', async () => {
      // `default set` assigns a preset like `override set` does, so it shares the
      // override autocomplete (assignable configs + guest-mode upsell) rather
      // than the base pool of your editable presets.
      const interaction = {
        options: {
          getFocused: () => ({ name: 'preset', value: '' }),
          getSubcommandGroup: () => 'default',
          getSubcommand: () => 'set',
        },
      } as never;

      await presetCommand.autocomplete?.(interaction);

      expect(handleOverrideAutocomplete).toHaveBeenCalledWith(interaction);
    });
  });
});

describe('button dispatch', () => {
  it('routes override-browse buttons and selects via the historical prefix', async () => {
    vi.mocked(isPresetOverrideInteraction).mockImplementation((id: string) =>
      id.startsWith('settings-preset-override::')
    );

    const button = { customId: 'settings-preset-override::clear::p1::text' } as never;
    await presetCommand.handleButton?.(button);
    expect(handleOverrideBrowseButton).toHaveBeenCalledWith(button);

    const select = { customId: 'settings-preset-override::select::0' } as never;
    await presetCommand.handleSelectMenu?.(select);
    expect(handleOverrideBrowseSelect).toHaveBeenCalledWith(select);
  });

  it('routes the REAL retry-button customId to handleModalRetry (builder↔guard drift pin)', async () => {
    vi.mocked(isPresetOverrideInteraction).mockReturnValue(false);
    vi.mocked(isPresetBrowseInteraction).mockReturnValue(false);
    const row = buildModalRetryRow('preset').toJSON() as { components: { custom_id: string }[] };
    const interaction = { customId: row.components[0].custom_id } as never;

    await presetCommand.handleButton?.(interaction);

    expect(presetRetryHandle).toHaveBeenCalled();

    // Seam: exercise the captured rebuild closure — 'seed' must hit THIS
    // command's builder with the stashed values; unknown kinds return null.
    const rebuild = presetRetryHandle.mock.calls[0][1] as (
      kind: string,
      values: Record<string, string>
    ) => unknown;
    rebuild('seed', { model: 'anthropic/claude-sonnet-4' });
    expect(vi.mocked(buildPresetSeedModal)).toHaveBeenCalledWith({
      model: 'anthropic/claude-sonnet-4',
    });
    expect(rebuild('retired-kind', {})).toBeNull();
  });
});
