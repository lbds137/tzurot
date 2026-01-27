/**
 * Tests for History Command Index
 * Tests command definition, routing, button/modal handlers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import historyCommand from './index.js';

// Destructure from default export (category is now injected by CommandHandler)
const { data, execute, autocomplete, handleButton, handleModal } = historyCommand;

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

// Mock subcommand handlers
const mockHandleClear = vi.fn();
const mockHandleUndo = vi.fn();
const mockHandleStats = vi.fn();
const mockHandleHardDelete = vi.fn();
const mockParseHardDeleteEntityId = vi.fn();
vi.mock('./clear.js', () => ({
  handleClear: (...args: unknown[]) => mockHandleClear(...args),
}));
vi.mock('./undo.js', () => ({
  handleUndo: (...args: unknown[]) => mockHandleUndo(...args),
}));
vi.mock('./stats.js', () => ({
  handleStats: (...args: unknown[]) => mockHandleStats(...args),
}));
vi.mock('./hard-delete.js', () => ({
  handleHardDelete: (...args: unknown[]) => mockHandleHardDelete(...args),
  parseHardDeleteEntityId: (...args: unknown[]) => mockParseHardDeleteEntityId(...args),
}));

// Mock autocomplete handlers
const mockHandlePersonalityAutocomplete = vi.fn();
const mockHandlePersonaProfileAutocomplete = vi.fn();
vi.mock('./autocomplete.js', () => ({
  handlePersonalityAutocomplete: (...args: unknown[]) => mockHandlePersonalityAutocomplete(...args),
  handlePersonaProfileAutocomplete: (...args: unknown[]) =>
    mockHandlePersonaProfileAutocomplete(...args),
}));

// Mock subcommandContextRouter - use vi.hoisted to define mock before hoisting
const { mockRouter } = vi.hoisted(() => ({
  mockRouter: vi.fn(),
}));
vi.mock('../../utils/subcommandContextRouter.js', () => ({
  createSubcommandContextRouter: () => mockRouter,
}));

// Mock customIds - matches real format: {source}::destructive::{action}::{operation}::{entityId}
vi.mock('../../utils/customIds.js', () => ({
  CUSTOM_ID_DELIMITER: '::',
  DestructiveCustomIds: {
    isDestructive: (id: string) => id.includes('::destructive::'),
    parse: (id: string) => {
      // Real format: {source}::destructive::{action}::{operation}::{entityId}
      const parts = id.split('::');
      if (parts.length < 4 || parts[1] !== 'destructive') return null;
      return {
        source: parts[0],
        action: parts[2],
        operation: parts[3],
        entityId: parts[4],
      };
    },
  },
}));

// Mock destructiveConfirmation
const mockHandleDestructiveCancel = vi.fn();
const mockHandleDestructiveConfirmButton = vi.fn();
const mockHandleDestructiveModalSubmit = vi.fn();
const mockCreateHardDeleteConfig = vi.fn(() => ({ type: 'config' }));
vi.mock('../../utils/destructiveConfirmation.js', () => ({
  handleDestructiveCancel: (...args: unknown[]) => mockHandleDestructiveCancel(...args),
  handleDestructiveConfirmButton: (...args: unknown[]) =>
    mockHandleDestructiveConfirmButton(...args),
  handleDestructiveModalSubmit: (...args: unknown[]) => mockHandleDestructiveModalSubmit(...args),
  createHardDeleteConfig: (...args: unknown[]) => mockCreateHardDeleteConfig(...args),
}));

// Mock userGatewayClient
const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

// Mock commandHelpers
vi.mock('../../utils/commandHelpers.js', () => ({
  createSuccessEmbed: vi.fn(() => ({ type: 'embed' })),
}));

describe('History Command Definition', () => {
  it('should have correct command name', () => {
    expect(data.name).toBe('history');
  });

  it('should have correct description', () => {
    expect(data.description).toBe('Manage your conversation history');
  });

  it('should have four subcommands', () => {
    const json = data.toJSON();
    expect(json.options).toHaveLength(4);
  });

  it('should have clear subcommand with correct options', () => {
    const json = data.toJSON();
    const clearSubcommand = json.options?.find((opt: { name: string }) => opt.name === 'clear');
    expect(clearSubcommand).toBeDefined();
    expect(clearSubcommand?.options).toHaveLength(2);
    expect(clearSubcommand?.options?.[0]?.name).toBe('personality');
    expect(clearSubcommand?.options?.[0]?.required).toBe(true);
    expect(clearSubcommand?.options?.[1]?.name).toBe('profile');
    expect(clearSubcommand?.options?.[1]?.required).toBe(false);
  });

  it('should have undo subcommand', () => {
    const json = data.toJSON();
    const undoSubcommand = json.options?.find((opt: { name: string }) => opt.name === 'undo');
    expect(undoSubcommand).toBeDefined();
  });

  it('should have stats subcommand', () => {
    const json = data.toJSON();
    const statsSubcommand = json.options?.find((opt: { name: string }) => opt.name === 'stats');
    expect(statsSubcommand).toBeDefined();
  });

  it('should have hard-delete subcommand without profile option', () => {
    const json = data.toJSON();
    const hardDeleteSubcommand = json.options?.find(
      (opt: { name: string }) => opt.name === 'hard-delete'
    );
    expect(hardDeleteSubcommand).toBeDefined();
    expect(hardDeleteSubcommand?.options).toHaveLength(1);
    expect(hardDeleteSubcommand?.options?.[0]?.name).toBe('personality');
  });

  // Note: category is now injected by CommandHandler based on folder structure
  // It's no longer exported from the command module itself
});

describe('execute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should route to subcommand context router', async () => {
    // Create a mock DeferredCommandContext
    const mockContext = {
      interaction: {},
      user: { id: '123456789' },
      guild: null,
      member: null,
      channel: null,
      channelId: '111111111111111111',
      guildId: null,
      commandName: 'history',
      isEphemeral: true,
      getOption: vi.fn(),
      getRequiredOption: vi.fn(),
      getSubcommand: vi.fn().mockReturnValue('clear'),
      getSubcommandGroup: vi.fn().mockReturnValue(null),
      editReply: vi.fn(),
      followUp: vi.fn(),
      deleteReply: vi.fn(),
    };

    await execute(mockContext as never);

    expect(mockRouter).toHaveBeenCalledWith(mockContext);
  });
});

describe('handleModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle modal submit for hard-delete', async () => {
    mockParseHardDeleteEntityId.mockReturnValue({
      personalitySlug: 'lilith',
      channelId: 'channel-123',
    });
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { success: true, deletedCount: 5, message: 'Deleted' },
    });

    const mockInteraction = {
      customId: 'history::destructive::modal_submit::hard-delete::lilith_channel-123',
      user: { id: '123456789' },
      reply: vi.fn(),
    };

    await handleModal(mockInteraction as never);

    expect(mockHandleDestructiveModalSubmit).toHaveBeenCalled();
  });

  it('should reply with error for invalid entityId in modal', async () => {
    mockParseHardDeleteEntityId.mockReturnValue(null);

    const mockReply = vi.fn();
    const mockInteraction = {
      customId: 'history::destructive::modal_submit::hard-delete::invalid',
      user: { id: '123456789' },
      reply: mockReply,
    };

    await handleModal(mockInteraction as never);

    expect(mockReply).toHaveBeenCalledWith({
      content: 'Error: Invalid entity ID format.',
      ephemeral: true,
    });
  });
});

describe('autocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should delegate to handlePersonalityAutocomplete for personality option', async () => {
    const mockInteraction = {
      options: {
        getFocused: () => ({ name: 'personality', value: 'lil' }),
      },
    };

    await autocomplete(mockInteraction as never);

    expect(mockHandlePersonalityAutocomplete).toHaveBeenCalledWith(mockInteraction);
  });

  it('should delegate to handlePersonaProfileAutocomplete for profile option', async () => {
    const mockInteraction = {
      options: {
        getFocused: () => ({ name: 'profile', value: 'my' }),
      },
    };

    await autocomplete(mockInteraction as never);

    expect(mockHandlePersonaProfileAutocomplete).toHaveBeenCalledWith(mockInteraction);
  });

  it('should respond with empty array for unknown option', async () => {
    const mockRespond = vi.fn();
    const mockInteraction = {
      options: {
        getFocused: () => ({ name: 'unknown', value: '' }),
      },
      respond: mockRespond,
    };

    await autocomplete(mockInteraction as never);

    expect(mockRespond).toHaveBeenCalledWith([]);
  });
});

describe('handleButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle cancel button', async () => {
    const mockInteraction = {
      customId: 'history::destructive::cancel_button::hard-delete::lilith_channel-123',
    };

    await handleButton(mockInteraction as never);

    expect(mockHandleDestructiveCancel).toHaveBeenCalledWith(
      mockInteraction,
      'Hard-delete cancelled.'
    );
  });

  it('should handle confirm button and show modal', async () => {
    mockParseHardDeleteEntityId.mockReturnValue({
      personalitySlug: 'lilith',
      channelId: 'channel-123',
    });

    const mockInteraction = {
      customId: 'history::destructive::confirm_button::hard-delete::lilith_channel-123',
    };

    await handleButton(mockInteraction as never);

    expect(mockCreateHardDeleteConfig).toHaveBeenCalledWith({
      entityType: 'conversation history',
      entityName: 'lilith',
      additionalWarning: '**This action is PERMANENT and cannot be undone!**',
      source: 'history',
      operation: 'hard-delete',
      entityId: 'lilith_channel-123',
    });
    expect(mockHandleDestructiveConfirmButton).toHaveBeenCalled();
  });

  it('should update with error for invalid entityId on confirm', async () => {
    mockParseHardDeleteEntityId.mockReturnValue(null);

    const mockUpdate = vi.fn();
    const mockInteraction = {
      customId: 'history::destructive::confirm_button::hard-delete::invalid',
      update: mockUpdate,
    };

    await handleButton(mockInteraction as never);

    expect(mockUpdate).toHaveBeenCalledWith({
      content: 'Error: Invalid entity ID format.',
      embeds: [],
      components: [],
    });
  });

  it('should ignore non-destructive button ids', async () => {
    const mockInteraction = {
      customId: 'some-other-button',
    };

    await handleButton(mockInteraction as never);

    expect(mockHandleDestructiveCancel).not.toHaveBeenCalled();
    expect(mockHandleDestructiveConfirmButton).not.toHaveBeenCalled();
  });

  it('should ignore destructive buttons with invalid customId parse', async () => {
    const mockInteraction = {
      customId: 'history::destructive::invalid', // Too few parts
    };

    await handleButton(mockInteraction as never);

    expect(mockHandleDestructiveCancel).not.toHaveBeenCalled();
    expect(mockHandleDestructiveConfirmButton).not.toHaveBeenCalled();
  });
});
