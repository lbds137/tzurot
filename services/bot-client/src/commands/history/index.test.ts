/**
 * Tests for History Command Index
 * Tests command definition, routing, button/modal handlers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import historyCommand from './index.js';

// Destructure from default export (category is now injected by CommandHandler)
const { data, execute, autocomplete, handleButton, handleModal } = historyCommand;

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

// Mock subcommand handlers
const mockHandleClear = vi.fn();
const mockHandleUndo = vi.fn();
const mockHandleStats = vi.fn();
const mockHandlePurgeHistory = vi.fn();
const mockParsePurgeSlugFromFooter = vi.fn();
const mockHasChannelWidePurgePermission = vi.fn((..._args: unknown[]) => true);
vi.mock('./clear.js', () => ({
  handleClear: (...args: unknown[]) => mockHandleClear(...args),
}));
vi.mock('./undo.js', () => ({
  handleUndo: (...args: unknown[]) => mockHandleUndo(...args),
}));
vi.mock('./stats.js', () => ({
  handleStats: (...args: unknown[]) => mockHandleStats(...args),
}));
vi.mock('./purge.js', () => ({
  handlePurgeHistory: (...args: unknown[]) => mockHandlePurgeHistory(...args),
  parsePurgeSlugFromFooter: (...args: unknown[]) => mockParsePurgeSlugFromFooter(...args),
  // Real implementation kept — a plain-value mock returning a fixed answer
  // would defeat the routing tests below, which rely on it discriminating
  // 'history-purge' from 'history-purge-all' from anything else.
  purgeScopeForOperation: (operation: string) => {
    if (operation === 'history-purge') return 'own';
    if (operation === 'history-purge-all') return 'everyone';
    return null;
  },
  hasChannelWidePurgePermission: (...args: unknown[]) =>
    mockHasChannelWidePurgePermission(
      ...(args as Parameters<typeof mockHasChannelWidePurgePermission>)
    ),
  CHANNEL_WIDE_PURGE_ACTION: 'purge everyone’s conversation history in this channel',
}));

// Mock autocomplete handlers
const mockHandlePersonalityAutocomplete = vi.fn();
const mockHandlePersonaAutocomplete = vi.fn();
vi.mock('./autocomplete.js', () => ({
  handlePersonalityAutocomplete: (...args: unknown[]) => mockHandlePersonalityAutocomplete(...args),
  handlePersonaAutocomplete: (...args: unknown[]) => mockHandlePersonaAutocomplete(...args),
}));

// Mock subcommandContextRouter - use vi.hoisted to define mock before hoisting
const { mockRouter } = vi.hoisted(() => ({
  mockRouter: vi.fn(),
}));
vi.mock('../../utils/subcommandContextRouter.js', () => ({
  createSubcommandContextRouter: () => mockRouter,
}));

// Mock customIds - matches real format:
// {source}::destructive::{action}::{operation}::{entityId?}
vi.mock('../../utils/customIds.js', () => ({
  CUSTOM_ID_DELIMITER: '::',
  DestructiveCustomIds: {
    isDestructive: (id: string) => id.includes('::destructive::'),
    parse: (id: string) => {
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

// Mock the Tier-B destructive confirmation module
const mockHandleDestructiveCancel = vi.fn();
const mockHandleDestructiveConfirmButton = vi.fn();
const mockHandleDestructiveModalSubmit = vi.fn();
const mockHardDeleteModalDisplay = vi.fn((entityName: string) => ({
  modalTitle: 'Confirm Deletion',
  confirmationLabel: `Type: DELETE ${entityName.toUpperCase()}`,
  confirmationPhrase: `DELETE ${entityName.toUpperCase()}`,
  confirmationPlaceholder: `DELETE ${entityName.toUpperCase()}`,
}));
vi.mock('../../utils/confirmation/confirmDestructive.js', () => ({
  handleDestructiveCancel: (...args: unknown[]) =>
    mockHandleDestructiveCancel(...(args as Parameters<typeof mockHandleDestructiveCancel>)),
  handleDestructiveConfirmButton: (...args: unknown[]) =>
    mockHandleDestructiveConfirmButton(
      ...(args as Parameters<typeof mockHandleDestructiveConfirmButton>)
    ),
  handleDestructiveModalSubmit: (...args: unknown[]) =>
    mockHandleDestructiveModalSubmit(
      ...(args as Parameters<typeof mockHandleDestructiveModalSubmit>)
    ),
  hardDeleteModalDisplay: (...args: unknown[]) =>
    mockHardDeleteModalDisplay(...(args as Parameters<typeof mockHardDeleteModalDisplay>)),
}));

// Mock typed gateway clients
const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
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
    const clearSubcommand = json.options?.find((opt: { name: string }) => opt.name === 'clear') as
      { options?: Array<{ name: string; required?: boolean }> } | undefined;
    expect(clearSubcommand).toBeDefined();
    expect(clearSubcommand?.options).toHaveLength(2);
    expect(clearSubcommand?.options?.[0]?.name).toBe('character');
    expect(clearSubcommand?.options?.[0]?.required).toBe(true);
    expect(clearSubcommand?.options?.[1]?.name).toBe('persona');
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

  it('should have purge subcommand without profile option, plus a scope option', () => {
    const json = data.toJSON();
    const purgeSubcommand = json.options?.find((opt: { name: string }) => opt.name === 'purge') as
      { options?: Array<{ name: string; required?: boolean }> } | undefined;
    expect(purgeSubcommand).toBeDefined();
    expect(purgeSubcommand?.options).toHaveLength(2);
    expect(purgeSubcommand?.options?.[0]?.name).toBe('character');
    expect(purgeSubcommand?.options?.[1]?.name).toBe('scope');
    expect(purgeSubcommand?.options?.[1]?.required).toBe(false);
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

/** Parent warning message carrying the slug footer (the customId-overflow escape hatch). */
function purgeParentMessage(footerText: string | undefined = 'slug:lilith'): {
  embeds: Array<{ footer: { text: string } | null }>;
} {
  return { embeds: [{ footer: footerText === undefined ? null : { text: footerText } }] };
}

describe('handleModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasChannelWidePurgePermission.mockReturnValue(true);
  });

  it('denies a history-purge-all modal submit without Manage Messages (stale-confirm re-check)', async () => {
    mockHasChannelWidePurgePermission.mockReturnValue(false);
    mockParsePurgeSlugFromFooter.mockReturnValue('lilith');
    // Wired so the handler COULD proceed: without it, dropping the gate makes
    // this test fail on an unmocked clientsFor throw rather than on its own
    // assertions, which would not prove the gate is what stops the delete.
    const hardDeleteHistory = vi.fn();
    clientsForMock.mockReturnValue({ userClient: { hardDeleteHistory } });

    const mockReply = vi.fn();
    const mockInteraction = {
      customId: 'history::destructive::modal_submit::history-purge-all::channel-123',
      user: { id: '123456789' },
      message: purgeParentMessage(),
      reply: mockReply,
    };

    await handleModal(mockInteraction as never);

    expect(mockReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('purge') })
    );
    expect(mockHandleDestructiveModalSubmit).not.toHaveBeenCalled();
    expect(hardDeleteHistory).not.toHaveBeenCalled();
  });

  it('routes a history-purge-all modal submit with Manage Messages to hardDeleteHistory with scope: everyone', async () => {
    mockHasChannelWidePurgePermission.mockReturnValue(true);
    mockParsePurgeSlugFromFooter.mockReturnValue('lilith');
    const hardDeleteHistory = vi.fn().mockResolvedValue({
      ok: true,
      data: { success: true, deletedCount: 3, message: 'Deleted' },
    });
    clientsForMock.mockReturnValue({ userClient: { hardDeleteHistory } });

    const mockInteraction = {
      customId: 'history::destructive::modal_submit::history-purge-all::channel-123',
      user: { id: '123456789' },
      message: purgeParentMessage(),
      reply: vi.fn(),
    };

    await handleModal(mockInteraction as never);

    expect(mockHandleDestructiveModalSubmit).toHaveBeenCalled();
    const callback = mockHandleDestructiveModalSubmit.mock.calls[0][2] as () => Promise<unknown>;
    await callback();

    expect(hardDeleteHistory).toHaveBeenCalledWith({
      personalitySlug: 'lilith',
      channelId: 'channel-123',
      scope: 'everyone',
    });
  });

  it('should handle modal submit for history purge', async () => {
    mockParsePurgeSlugFromFooter.mockReturnValue('lilith');
    clientsForMock.mockReturnValue({
      userClient: { hardDeleteHistory: vi.fn() },
    });

    const mockInteraction = {
      customId: 'history::destructive::modal_submit::history-purge::channel-123',
      user: { id: '123456789' },
      message: purgeParentMessage(),
      reply: vi.fn(),
    };

    await handleModal(mockInteraction as never);

    // The slug is read from the parent message's footer, not the customId.
    expect(mockParsePurgeSlugFromFooter).toHaveBeenCalledWith('slug:lilith');
    // Seam assertion: the appliedNotice copy must actually cross the mocked
    // boundary — the mock cannot distinguish dropped or wrong copy otherwise.
    expect(mockHandleDestructiveModalSubmit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.any(Function),
      expect.objectContaining({
        appliedNotice: {
          whatApplied: 'The history was deleted',
          verifySteer: 'Use /history stats to verify.',
        },
      })
    );
  });

  it('should reply with error when the slug footer is missing in modal', async () => {
    mockParsePurgeSlugFromFooter.mockReturnValue(null);

    const mockReply = vi.fn();
    const mockInteraction = {
      customId: 'history::destructive::modal_submit::history-purge::channel-123',
      user: { id: '123456789' },
      message: { embeds: [] },
      reply: mockReply,
    };

    await handleModal(mockInteraction as never);

    expect(mockReply).toHaveBeenCalledWith({
      content: 'Error: Invalid entity ID format.',
      ephemeral: true,
    });
  });

  it('should fail closed when the channelId is missing even with a valid footer', async () => {
    // The other half of the OR: never proceed on a partial identity — a
    // customId with no entityId segment must not purge, however valid the
    // slug footer is.
    mockParsePurgeSlugFromFooter.mockReturnValue('lilith');

    const mockReply = vi.fn();
    const mockInteraction = {
      customId: 'history::destructive::modal_submit::history-purge',
      user: { id: '123456789' },
      message: purgeParentMessage(),
      reply: mockReply,
    };

    await handleModal(mockInteraction as never);

    expect(mockHandleDestructiveModalSubmit).not.toHaveBeenCalled();
    expect(mockReply).toHaveBeenCalledWith({
      content: 'Error: Invalid entity ID format.',
      ephemeral: true,
    });
  });

  // Coverage for the closure built by `buildPurgeOperation`. The closure
  // is passed as the 3rd arg to `handleDestructiveModalSubmit` and stored for
  // the confirm-button click — exercising it here mirrors what production
  // would do on confirm, without the Discord button round-trip.
  describe('buildPurgeOperation callback', () => {
    async function setupAndExtractCallback(
      hardDeleteHistoryStub: ReturnType<typeof vi.fn>
    ): Promise<() => Promise<unknown>> {
      mockParsePurgeSlugFromFooter.mockReturnValue('lilith');
      clientsForMock.mockReturnValue({
        userClient: { hardDeleteHistory: hardDeleteHistoryStub },
      });

      await handleModal({
        customId: 'history::destructive::modal_submit::history-purge::channel-123',
        user: { id: '123456789' },
        message: purgeParentMessage(),
        reply: vi.fn(),
      } as never);

      expect(mockHandleDestructiveModalSubmit).toHaveBeenCalled();
      return mockHandleDestructiveModalSubmit.mock.calls[0][2] as () => Promise<unknown>;
    }

    it('returns success with deleted count on a successful hardDeleteHistory', async () => {
      const hardDeleteHistory = vi.fn().mockResolvedValue({
        ok: true,
        data: { success: true, deletedCount: 5, message: 'Deleted 5 messages' },
      });
      const callback = await setupAndExtractCallback(hardDeleteHistory);

      const result = (await callback()) as { success: boolean; successEmbed?: unknown };

      expect(hardDeleteHistory).toHaveBeenCalledWith({
        personalitySlug: 'lilith',
        channelId: 'channel-123',
        scope: 'own',
      });
      expect(result.success).toBe(true);
      expect(result.successEmbed).toBeDefined();
    });

    it('returns the 404 personality-not-found message on status 404', async () => {
      const hardDeleteHistory = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        error: 'Personality not found',
      });
      const callback = await setupAndExtractCallback(hardDeleteHistory);

      const result = (await callback()) as { success: boolean; errorMessage?: string };

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('Character "lilith" not found');
    });

    it('returns the generic failure message on other error statuses', async () => {
      const hardDeleteHistory = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        error: 'Internal error',
      });
      const callback = await setupAndExtractCallback(hardDeleteHistory);

      const result = (await callback()) as { success: boolean; errorMessage?: string };

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('Failed to delete history');
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
        getFocused: () => ({ name: 'character', value: 'lil' }),
      },
    };

    await autocomplete(mockInteraction as never);

    expect(mockHandlePersonalityAutocomplete).toHaveBeenCalledWith(mockInteraction);
  });

  it('should delegate to handlePersonaAutocomplete for persona option', async () => {
    const mockInteraction = {
      options: {
        getFocused: () => ({ name: 'persona', value: 'my' }),
      },
    };

    await autocomplete(mockInteraction as never);

    expect(mockHandlePersonaAutocomplete).toHaveBeenCalledWith(mockInteraction);
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
      customId: 'history::destructive::cancel_button::history-purge::lilith_channel-123',
    };

    await handleButton(mockInteraction as never);

    expect(mockHandleDestructiveCancel).toHaveBeenCalledWith(
      mockInteraction,
      'History purge cancelled.'
    );
  });

  it('should handle confirm button and show modal', async () => {
    mockParsePurgeSlugFromFooter.mockReturnValue('lilith');

    const mockInteraction = {
      customId: 'history::destructive::confirm_button::history-purge::channel-123',
      message: purgeParentMessage(),
    };

    await handleButton(mockInteraction as never);

    // The slug rides the footer; display derives from it.
    expect(mockParsePurgeSlugFromFooter).toHaveBeenCalledWith('slug:lilith');
    expect(mockHardDeleteModalDisplay).toHaveBeenCalledWith('lilith');
    expect(mockHandleDestructiveConfirmButton).toHaveBeenCalledWith(
      mockInteraction,
      expect.objectContaining({ confirmationPhrase: 'DELETE LILITH' })
    );
  });

  it('should update with error when the slug footer is missing on confirm', async () => {
    mockParsePurgeSlugFromFooter.mockReturnValue(null);

    const mockUpdate = vi.fn();
    const mockInteraction = {
      customId: 'history::destructive::confirm_button::history-purge::channel-123',
      message: { embeds: [] },
      update: mockUpdate,
    };

    await handleButton(mockInteraction as never);

    expect(mockUpdate).toHaveBeenCalledWith({
      content: 'Error: Invalid entity ID format.',
      embeds: [],
      components: [],
    });
  });

  it('should fail closed on confirm when the channelId is missing even with a valid footer', async () => {
    // The other half of the OR — partial identity never proceeds.
    mockParsePurgeSlugFromFooter.mockReturnValue('lilith');

    const mockUpdate = vi.fn();
    const mockInteraction = {
      customId: 'history::destructive::confirm_button::history-purge',
      message: purgeParentMessage(),
      update: mockUpdate,
    };

    await handleButton(mockInteraction as never);

    expect(mockHandleDestructiveConfirmButton).not.toHaveBeenCalled();
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

  it('routes the history-purge-all cancel button', async () => {
    const mockInteraction = {
      customId: 'history::destructive::cancel_button::history-purge-all::channel-123',
    };

    await handleButton(mockInteraction as never);

    expect(mockHandleDestructiveCancel).toHaveBeenCalledWith(
      mockInteraction,
      'History purge cancelled.'
    );
  });

  it('routes the history-purge-all confirm button', async () => {
    mockParsePurgeSlugFromFooter.mockReturnValue('lilith');

    const mockInteraction = {
      customId: 'history::destructive::confirm_button::history-purge-all::channel-123',
      message: purgeParentMessage(),
    };

    await handleButton(mockInteraction as never);

    expect(mockHandleDestructiveConfirmButton).toHaveBeenCalledWith(
      mockInteraction,
      expect.objectContaining({ confirmationPhrase: 'DELETE LILITH' })
    );
  });
});
