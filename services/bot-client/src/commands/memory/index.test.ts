/**
 * Tests for Memory Command Router
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { data, execute, autocomplete, category } from './index.js';
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
  });

  describe('execute', () => {
    function createMockInteraction(
      subcommandGroup: string | null,
      subcommand: string
    ): ChatInputCommandInteraction {
      return {
        options: {
          getSubcommandGroup: () => subcommandGroup,
          getSubcommand: () => subcommand,
        },
      } as unknown as ChatInputCommandInteraction;
    }

    it('should route /memory stats to handleStats', async () => {
      const interaction = createMockInteraction(null, 'stats');

      await execute(interaction);

      expect(mockHandleStats).toHaveBeenCalledWith(interaction);
    });

    it('should route /memory focus enable to handleFocusEnable', async () => {
      const interaction = createMockInteraction('focus', 'enable');

      await execute(interaction);

      expect(mockHandleFocusEnable).toHaveBeenCalledWith(interaction);
    });

    it('should route /memory focus disable to handleFocusDisable', async () => {
      const interaction = createMockInteraction('focus', 'disable');

      await execute(interaction);

      expect(mockHandleFocusDisable).toHaveBeenCalledWith(interaction);
    });

    it('should route /memory focus status to handleFocusStatus', async () => {
      const interaction = createMockInteraction('focus', 'status');

      await execute(interaction);

      expect(mockHandleFocusStatus).toHaveBeenCalledWith(interaction);
    });

    it('should handle unknown subcommand gracefully', async () => {
      const interaction = createMockInteraction(null, 'unknown');

      // Should not throw
      await expect(execute(interaction)).resolves.not.toThrow();
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

  describe('category', () => {
    it('should be Memory', () => {
      expect(category).toBe('Memory');
    });
  });
});
