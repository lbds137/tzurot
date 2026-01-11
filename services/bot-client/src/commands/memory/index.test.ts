/**
 * Tests for Memory Command Router
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import {
  data,
  execute,
  autocomplete,
  category,
  handleButton,
  handleModalSubmit,
  componentPrefixes,
} from './index.js';
import type {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
} from 'discord.js';

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

// Mock detail.js handlers
const mockHandleEditButton = vi.fn();
const mockHandleEditModalSubmit = vi.fn();
const mockHandleLockButton = vi.fn();
const mockHandleDeleteButton = vi.fn();
const mockHandleDeleteConfirm = vi.fn();
vi.mock('./detail.js', () => ({
  MEMORY_DETAIL_PREFIX: 'mem-detail',
  parseMemoryActionId: (customId: string) => {
    if (!customId.startsWith('mem-detail:')) return null;
    const parts = customId.split(':');
    const memoryId = parts[2];
    return { action: parts[1], memoryId: memoryId.length > 0 ? memoryId : undefined };
  },
  handleEditButton: (...args: unknown[]) => mockHandleEditButton(...args),
  handleEditModalSubmit: (...args: unknown[]) => mockHandleEditModalSubmit(...args),
  handleLockButton: (...args: unknown[]) => mockHandleLockButton(...args),
  handleDeleteButton: (...args: unknown[]) => mockHandleDeleteButton(...args),
  handleDeleteConfirm: (...args: unknown[]) => mockHandleDeleteConfirm(...args),
}));

// Mock list and search pagination configs
vi.mock('./list.js', () => ({
  handleList: vi.fn(),
  LIST_PAGINATION_CONFIG: { prefix: 'memory-list' },
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

  describe('componentPrefixes', () => {
    it('should include list and search pagination prefixes', () => {
      expect(componentPrefixes).toContain('memory-list');
      expect(componentPrefixes).toContain('memory-search');
      expect(componentPrefixes).toContain('mem-detail');
    });
  });

  describe('handleButton', () => {
    function createMockButtonInteraction(customId: string): ButtonInteraction {
      const mockReply = vi.fn();
      const mockEditReply = vi.fn();
      return {
        customId,
        reply: mockReply,
        editReply: mockEditReply,
      } as unknown as ButtonInteraction;
    }

    it('should handle expired pagination (non-memory-detail prefix)', async () => {
      const interaction = createMockButtonInteraction('memory-list:page:0:date');

      await handleButton(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('expired'),
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should route edit action to handleEditButton', async () => {
      const interaction = createMockButtonInteraction('mem-detail:edit:memory-123');

      await handleButton(interaction);

      expect(mockHandleEditButton).toHaveBeenCalledWith(interaction, 'memory-123');
    });

    it('should route lock action to handleLockButton', async () => {
      const interaction = createMockButtonInteraction('mem-detail:lock:memory-456');

      await handleButton(interaction);

      expect(mockHandleLockButton).toHaveBeenCalledWith(interaction, 'memory-456');
    });

    it('should route delete action to handleDeleteButton', async () => {
      const interaction = createMockButtonInteraction('mem-detail:delete:memory-789');

      await handleButton(interaction);

      expect(mockHandleDeleteButton).toHaveBeenCalledWith(interaction, 'memory-789');
    });

    it('should route confirm-delete action and show success on true', async () => {
      mockHandleDeleteConfirm.mockResolvedValue(true);
      const interaction = createMockButtonInteraction('mem-detail:confirm-delete:memory-abc');

      await handleButton(interaction);

      expect(mockHandleDeleteConfirm).toHaveBeenCalledWith(interaction, 'memory-abc');
      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [],
        components: [],
        content: expect.stringContaining('deleted successfully'),
      });
    });

    it('should route confirm-delete action and not show success on false', async () => {
      mockHandleDeleteConfirm.mockResolvedValue(false);
      const interaction = createMockButtonInteraction('mem-detail:confirm-delete:memory-abc');

      await handleButton(interaction);

      expect(mockHandleDeleteConfirm).toHaveBeenCalledWith(interaction, 'memory-abc');
      expect(interaction.editReply).not.toHaveBeenCalled();
    });

    it('should show expired message for back action', async () => {
      const interaction = createMockButtonInteraction('mem-detail:back:memory-xyz');

      await handleButton(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('expired'),
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should show error for unknown action', async () => {
      const interaction = createMockButtonInteraction('mem-detail:unknown:memory-xyz');

      await handleButton(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('Unknown action'),
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should not call handler when memoryId is undefined for edit', async () => {
      // Create interaction with action but no memoryId
      const interaction = {
        customId: 'mem-detail:edit:',
        reply: vi.fn(),
      } as unknown as ButtonInteraction;

      await handleButton(interaction);

      expect(mockHandleEditButton).not.toHaveBeenCalled();
    });
  });

  describe('handleModalSubmit', () => {
    function createMockModalSubmitInteraction(customId: string): ModalSubmitInteraction {
      return {
        customId,
      } as unknown as ModalSubmitInteraction;
    }

    it('should route edit modal to handleEditModalSubmit', async () => {
      const interaction = createMockModalSubmitInteraction('mem-detail:edit:memory-123');

      await handleModalSubmit(interaction);

      expect(mockHandleEditModalSubmit).toHaveBeenCalledWith(interaction, 'memory-123');
    });

    it('should ignore non-edit modal actions', async () => {
      const interaction = createMockModalSubmitInteraction('mem-detail:other:memory-123');

      await handleModalSubmit(interaction);

      expect(mockHandleEditModalSubmit).not.toHaveBeenCalled();
    });

    it('should ignore modals with unrecognized prefix', async () => {
      const interaction = createMockModalSubmitInteraction('unknown:edit:memory-123');

      await handleModalSubmit(interaction);

      expect(mockHandleEditModalSubmit).not.toHaveBeenCalled();
    });

    it('should not call handler when memoryId is undefined', async () => {
      const interaction = createMockModalSubmitInteraction('mem-detail:edit:');

      await handleModalSubmit(interaction);

      expect(mockHandleEditModalSubmit).not.toHaveBeenCalled();
    });
  });
});
