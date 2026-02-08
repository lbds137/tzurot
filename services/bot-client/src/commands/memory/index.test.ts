/**
 * Tests for Memory Command Router
 *
 * Tests command definition, execute routing, and autocomplete.
 * Button/modal/select menu handler tests are in interactionHandlers.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import memoryCommand from './index.js';

// Destructure from default export
const { data, execute, autocomplete, componentPrefixes } = memoryCommand;
import type { ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';

// Mock common-types
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
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

// Mock handlers
const mockHandleStats = vi.fn();
vi.mock('./stats.js', () => ({
  handleStats: (...args: unknown[]) => mockHandleStats(...args),
}));

const mockHandleFocusEnable = vi.fn();
const mockHandleFocusDisable = vi.fn();
const mockHandleFocusStatus = vi.fn();
vi.mock('./focus.js', () => ({
  handleFocusEnable: (...args: unknown[]) => mockHandleFocusEnable(...args),
  handleFocusDisable: (...args: unknown[]) => mockHandleFocusDisable(...args),
  handleFocusStatus: (...args: unknown[]) => mockHandleFocusStatus(...args),
}));

const mockHandleIncognitoEnable = vi.fn();
const mockHandleIncognitoDisable = vi.fn();
const mockHandleIncognitoStatus = vi.fn();
const mockHandleIncognitoForget = vi.fn();
vi.mock('./incognito.js', () => ({
  handleIncognitoEnable: (...args: unknown[]) => mockHandleIncognitoEnable(...args),
  handleIncognitoDisable: (...args: unknown[]) => mockHandleIncognitoDisable(...args),
  handleIncognitoStatus: (...args: unknown[]) => mockHandleIncognitoStatus(...args),
  handleIncognitoForget: (...args: unknown[]) => mockHandleIncognitoForget(...args),
}));

// Mock autocomplete
const mockHandlePersonalityAutocomplete = vi.fn();
vi.mock('./autocomplete.js', () => ({
  handlePersonalityAutocomplete: (...args: unknown[]) => mockHandlePersonalityAutocomplete(...args),
}));

// Mock subcommand router to pass through to actual handlers
vi.mock('../../utils/subcommandRouter.js', () => ({
  createSubcommandRouter: (handlers: Record<string, (...args: unknown[]) => Promise<void>>) => {
    return async (interaction: ChatInputCommandInteraction) => {
      const subcommand = interaction.options.getSubcommand();
      const handler = handlers[subcommand];
      if (handler !== undefined) {
        await handler(interaction);
      }
    };
  },
  createTypedSubcommandRouter: <T>(handlers: Record<string, (context: T) => Promise<void>>) => {
    return async (context: T & { interaction: { options: { getSubcommand: () => string } } }) => {
      const subcommand = context.interaction.options.getSubcommand();
      const handler = handlers[subcommand];
      if (handler !== undefined) {
        await handler(context);
      }
    };
  },
}));

// Mock detail.js
vi.mock('./detail.js', () => ({
  MEMORY_DETAIL_PREFIX: 'mem-detail',
  parseMemoryActionId: vi.fn(),
  handleLockButton: vi.fn(),
  handleDeleteButton: vi.fn(),
  handleDeleteConfirm: vi.fn(),
  handleViewFullButton: vi.fn(),
}));

// Mock detailModals.js
vi.mock('./detailModals.js', () => ({
  handleEditButton: vi.fn(),
  handleEditTruncatedButton: vi.fn(),
  handleCancelEditButton: vi.fn(),
  handleEditModalSubmit: vi.fn(),
}));

// Mock interaction handlers (extracted to interactionHandlers.ts)
vi.mock('./interactionHandlers.js', () => ({
  handleButton: vi.fn(),
  handleModal: vi.fn(),
  handleSelectMenu: vi.fn(),
}));

// Mock browse and search pagination configs
vi.mock('./browse.js', () => ({
  handleBrowse: vi.fn(),
  BROWSE_PAGINATION_CONFIG: { prefix: 'memory-browse' },
}));

vi.mock('./search.js', () => ({
  handleSearch: vi.fn(),
  SEARCH_PAGINATION_CONFIG: { prefix: 'memory-search' },
}));

describe('Memory Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('data (command definition)', () => {
    it('should have correct name', () => {
      expect(data.name).toBe('memory');
    });

    it('should have correct description', () => {
      const json = data.toJSON();
      expect(json.description).toBe('Manage your long-term memories');
    });

    it('should have stats subcommand', () => {
      const json = data.toJSON();
      const statsSubcommand = json.options?.find((opt: { name: string }) => opt.name === 'stats');
      expect(statsSubcommand).toBeDefined();
    });

    it('should have focus subcommand group with enable/disable/status', () => {
      const json = data.toJSON();
      const focusGroup = json.options?.find((opt: { name: string }) => opt.name === 'focus');
      expect(focusGroup).toBeDefined();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const focusOptions = (focusGroup as any)?.options ?? [];
      const subcommandNames = focusOptions.map((s: { name: string }) => s.name);
      expect(subcommandNames).toContain('enable');
      expect(subcommandNames).toContain('disable');
      expect(subcommandNames).toContain('status');
    });

    it('should have incognito subcommand group with enable/disable/status/forget', () => {
      const json = data.toJSON();
      const incognitoGroup = json.options?.find(
        (opt: { name: string }) => opt.name === 'incognito'
      );
      expect(incognitoGroup).toBeDefined();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const incognitoOptions = (incognitoGroup as any)?.options ?? [];
      const subcommandNames = incognitoOptions.map((s: { name: string }) => s.name);
      expect(subcommandNames).toContain('enable');
      expect(subcommandNames).toContain('disable');
      expect(subcommandNames).toContain('status');
      expect(subcommandNames).toContain('forget');
    });
  });

  describe('execute', () => {
    function createMockContext(subcommandGroup: string | null, subcommand: string) {
      return {
        getSubcommandGroup: () => subcommandGroup,
        getSubcommand: () => subcommand,
        interaction: {
          options: {
            getSubcommandGroup: () => subcommandGroup,
            getSubcommand: () => subcommand,
          },
        },
      };
    }

    it('should route /memory stats to handleStats', async () => {
      const context = createMockContext(null, 'stats');

      await execute(context as never);

      expect(mockHandleStats).toHaveBeenCalledWith(context);
    });

    it('should route /memory focus enable to handleFocusEnable', async () => {
      const context = createMockContext('focus', 'enable');

      await execute(context as never);

      expect(mockHandleFocusEnable).toHaveBeenCalledWith(context);
    });

    it('should route /memory focus disable to handleFocusDisable', async () => {
      const context = createMockContext('focus', 'disable');

      await execute(context as never);

      expect(mockHandleFocusDisable).toHaveBeenCalledWith(context);
    });

    it('should route /memory focus status to handleFocusStatus', async () => {
      const context = createMockContext('focus', 'status');

      await execute(context as never);

      expect(mockHandleFocusStatus).toHaveBeenCalledWith(context);
    });

    it('should route /memory incognito enable to handleIncognitoEnable', async () => {
      const context = createMockContext('incognito', 'enable');

      await execute(context as never);

      expect(mockHandleIncognitoEnable).toHaveBeenCalledWith(context);
    });

    it('should route /memory incognito disable to handleIncognitoDisable', async () => {
      const context = createMockContext('incognito', 'disable');

      await execute(context as never);

      expect(mockHandleIncognitoDisable).toHaveBeenCalledWith(context);
    });

    it('should route /memory incognito status to handleIncognitoStatus', async () => {
      const context = createMockContext('incognito', 'status');

      await execute(context as never);

      expect(mockHandleIncognitoStatus).toHaveBeenCalledWith(context);
    });

    it('should route /memory incognito forget to handleIncognitoForget', async () => {
      const context = createMockContext('incognito', 'forget');

      await execute(context as never);

      expect(mockHandleIncognitoForget).toHaveBeenCalledWith(context);
    });

    it('should handle unknown subcommand gracefully', async () => {
      const context = createMockContext(null, 'unknown');

      // Should not throw
      await expect(execute(context as never)).resolves.not.toThrow();
    });
  });

  describe('autocomplete', () => {
    function createMockAutocompleteInteraction(focusedOptionName: string): AutocompleteInteraction {
      const mockRespond = vi.fn();
      return {
        options: {
          getFocused: (returnNameAndValue: boolean) => {
            if (returnNameAndValue) {
              return { name: focusedOptionName, value: '' };
            }
            return '';
          },
        },
        respond: mockRespond,
      } as unknown as AutocompleteInteraction;
    }

    it('should delegate personality autocomplete to handler', async () => {
      const interaction = createMockAutocompleteInteraction('personality');

      await autocomplete(interaction);

      expect(mockHandlePersonalityAutocomplete).toHaveBeenCalledWith(interaction);
    });

    it('should respond with empty array for unknown option', async () => {
      const interaction = createMockAutocompleteInteraction('unknown');
      const mockRespond = vi.fn();
      (interaction as unknown as { respond: typeof mockRespond }).respond = mockRespond;

      await autocomplete(interaction);

      expect(mockRespond).toHaveBeenCalledWith([]);
      expect(mockHandlePersonalityAutocomplete).not.toHaveBeenCalled();
    });
  });

  // Note: category is now injected by CommandHandler based on folder structure
  // It's no longer exported from the command module itself

  describe('componentPrefixes', () => {
    it('should include browse and search pagination prefixes', () => {
      expect(componentPrefixes).toContain('memory-browse');
      expect(componentPrefixes).toContain('memory-search');
      expect(componentPrefixes).toContain('mem-detail');
    });
  });
});
