/**
 * Tests for memory interaction handlers (the top-level router).
 *
 * Covers:
 * - Button routing: pagination → browse/search pagination handlers
 * - Button routing: detail actions → session-kind-based dispatch
 * - Select menu routing: browse-select, search-select, legacy memory-detail::select
 * - Modal routing: memory edit modals
 * - Session lookup for detail actions determines which refresh handler is called
 * - Expired interactions get a clean error
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockHandleBrowsePagination,
  mockHandleBrowseSelect,
  mockHandleBrowseDetailAction,
  mockIsMemoryBrowsePagination,
  mockBrowseHelpers,
  mockHandleSearchPagination,
  mockHandleSearchSelect,
  mockHandleSearchDetailAction,
  mockIsMemorySearchPagination,
  mockSearchHelpers,
  mockParseMemoryActionId,
  mockHandleMemorySelect,
  mockHandleEditModalSubmit,
  mockFindMemoryListSessionByMessage,
} = vi.hoisted(() => ({
  mockHandleBrowsePagination: vi.fn(),
  mockHandleBrowseSelect: vi.fn(),
  mockHandleBrowseDetailAction: vi.fn(),
  mockIsMemoryBrowsePagination: vi.fn(),
  mockBrowseHelpers: {
    isBrowseSelect: vi.fn(),
  },
  mockHandleSearchPagination: vi.fn(),
  mockHandleSearchSelect: vi.fn(),
  mockHandleSearchDetailAction: vi.fn(),
  mockIsMemorySearchPagination: vi.fn(),
  mockSearchHelpers: {
    isBrowseSelect: vi.fn(),
  },
  mockParseMemoryActionId: vi.fn(),
  mockHandleMemorySelect: vi.fn(),
  mockHandleEditModalSubmit: vi.fn(),
  mockFindMemoryListSessionByMessage: vi.fn(),
}));

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

vi.mock('./detail.js', () => ({
  parseMemoryActionId: (...args: unknown[]) => mockParseMemoryActionId(...args),
  handleMemorySelect: (...args: unknown[]) => mockHandleMemorySelect(...args),
}));

vi.mock('./detailModals.js', () => ({
  handleEditModalSubmit: (...args: unknown[]) => mockHandleEditModalSubmit(...args),
}));

vi.mock('./browseSession.js', () => ({
  findMemoryListSessionByMessage: (...args: unknown[]) =>
    mockFindMemoryListSessionByMessage(...args),
}));

vi.mock('./browse.js', () => ({
  browseHelpers: mockBrowseHelpers,
  handleBrowsePagination: (...args: unknown[]) => mockHandleBrowsePagination(...args),
  handleBrowseSelect: (...args: unknown[]) => mockHandleBrowseSelect(...args),
  handleBrowseDetailAction: (...args: unknown[]) => mockHandleBrowseDetailAction(...args),
  isMemoryBrowsePagination: (...args: unknown[]) => mockIsMemoryBrowsePagination(...args),
}));

vi.mock('./search.js', () => ({
  searchHelpers: mockSearchHelpers,
  handleSearchPagination: (...args: unknown[]) => mockHandleSearchPagination(...args),
  handleSearchSelect: (...args: unknown[]) => mockHandleSearchSelect(...args),
  handleSearchDetailAction: (...args: unknown[]) => mockHandleSearchDetailAction(...args),
  isMemorySearchPagination: (...args: unknown[]) => mockIsMemorySearchPagination(...args),
}));

import { handleButton, handleModal, handleSelectMenu } from './interactionHandlers.js';

const TEST_MESSAGE_ID = 'msg-123';

interface MockButtonInteraction {
  customId: string;
  message: { id: string };
  reply: ReturnType<typeof vi.fn>;
  replied: boolean;
  deferred: boolean;
}

interface MockSelectInteraction {
  customId: string;
  message: { id: string };
  reply: ReturnType<typeof vi.fn>;
}

function createButtonInteraction(customId: string): MockButtonInteraction {
  return {
    customId,
    message: { id: TEST_MESSAGE_ID },
    reply: vi.fn().mockResolvedValue(undefined),
    replied: false,
    deferred: false,
  };
}

function createSelectInteraction(customId: string): MockSelectInteraction {
  return {
    customId,
    message: { id: TEST_MESSAGE_ID },
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

interface MockModalInteraction {
  customId: string;
  reply: ReturnType<typeof vi.fn>;
}

function createModalInteraction(customId: string): MockModalInteraction {
  return {
    customId,
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('handleButton', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: all custom ID guards return false
    mockIsMemoryBrowsePagination.mockReturnValue(false);
    mockIsMemorySearchPagination.mockReturnValue(false);
    mockParseMemoryActionId.mockReturnValue(null);
  });

  it('routes to browse pagination when custom ID matches', async () => {
    mockIsMemoryBrowsePagination.mockReturnValue(true);
    const interaction = createButtonInteraction('memory-browse::browse::0::all::');

    await handleButton(interaction as never);

    expect(mockHandleBrowsePagination).toHaveBeenCalledWith(interaction);
    expect(mockHandleSearchPagination).not.toHaveBeenCalled();
  });

  it('routes to search pagination when custom ID matches', async () => {
    mockIsMemorySearchPagination.mockReturnValue(true);
    const interaction = createButtonInteraction('memory-search::browse::0::all::');

    await handleButton(interaction as never);

    expect(mockHandleSearchPagination).toHaveBeenCalledWith(interaction);
    expect(mockHandleBrowsePagination).not.toHaveBeenCalled();
  });

  it('routes session-independent actions (lock/edit/view-full/delete) without session lookup', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'lock', memoryId: 'mem-1' });
    mockHandleBrowseDetailAction.mockResolvedValue(true);

    const interaction = createButtonInteraction('memory-detail::lock::mem-1');

    await handleButton(interaction as never);

    expect(mockHandleBrowseDetailAction).toHaveBeenCalledWith(interaction);
    expect(mockFindMemoryListSessionByMessage).not.toHaveBeenCalled();
    expect(mockHandleSearchDetailAction).not.toHaveBeenCalled();
  });

  it('still routes lock/edit/view-full even when session has expired', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'edit', memoryId: 'mem-1' });
    mockFindMemoryListSessionByMessage.mockResolvedValue(null);

    const interaction = createButtonInteraction('memory-detail::edit::mem-1');

    await handleButton(interaction as never);

    // Expired session should NOT block session-independent actions
    expect(mockHandleBrowseDetailAction).toHaveBeenCalledWith(interaction);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('routes session-dependent "back" to browse refresh when session kind is browse', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'back' });
    mockFindMemoryListSessionByMessage.mockResolvedValue({ data: { kind: 'browse' } });
    mockHandleBrowseDetailAction.mockResolvedValue(true);

    const interaction = createButtonInteraction('memory-detail::back');

    await handleButton(interaction as never);

    expect(mockHandleBrowseDetailAction).toHaveBeenCalledWith(interaction);
    expect(mockHandleSearchDetailAction).not.toHaveBeenCalled();
  });

  it('routes session-dependent "back" to search refresh when session kind is search', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'back' });
    mockFindMemoryListSessionByMessage.mockResolvedValue({ data: { kind: 'search' } });
    mockHandleSearchDetailAction.mockResolvedValue(true);

    const interaction = createButtonInteraction('memory-detail::back');

    await handleButton(interaction as never);

    expect(mockHandleSearchDetailAction).toHaveBeenCalledWith(interaction);
    expect(mockHandleBrowseDetailAction).not.toHaveBeenCalled();
  });

  it('shows expired message when session-dependent action has no session', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'back' });
    mockFindMemoryListSessionByMessage.mockResolvedValue(null);

    const interaction = createButtonInteraction('memory-detail::back');

    await handleButton(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('expired') })
    );
    expect(mockHandleBrowseDetailAction).not.toHaveBeenCalled();
    expect(mockHandleSearchDetailAction).not.toHaveBeenCalled();
  });

  it('shows error for unknown button interactions', async () => {
    mockParseMemoryActionId.mockReturnValue(null);
    const interaction = createButtonInteraction('unrelated::button');

    await handleButton(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Unknown') })
    );
  });

  it('shows error when session-dependent detail handler returns false', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'back' });
    mockFindMemoryListSessionByMessage.mockResolvedValue({ data: { kind: 'browse' } });
    mockHandleBrowseDetailAction.mockResolvedValue(false);

    const interaction = createButtonInteraction('memory-detail::back');

    await handleButton(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Unknown action') })
    );
  });
});

describe('handleModal', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('routes edit modal to handleEditModalSubmit', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'edit', memoryId: 'mem-1' });
    const interaction = createModalInteraction('memory-detail::edit::mem-1');

    await handleModal(interaction as never);

    expect(mockHandleEditModalSubmit).toHaveBeenCalledWith(interaction, 'mem-1');
  });

  it('acknowledges non-edit modal submissions with an error reply', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'other' });
    const interaction = createModalInteraction('something::else');

    await handleModal(interaction as never);

    expect(mockHandleEditModalSubmit).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Unknown modal') })
    );
  });

  it('acknowledges modal submissions with no parseable custom ID', async () => {
    mockParseMemoryActionId.mockReturnValue(null);
    const interaction = createModalInteraction('unparseable');

    await handleModal(interaction as never);

    expect(mockHandleEditModalSubmit).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Unknown modal') })
    );
  });

  it('acknowledges edit modal with missing memoryId', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'edit', memoryId: undefined });
    const interaction = createModalInteraction('memory-detail::edit::');

    await handleModal(interaction as never);

    expect(mockHandleEditModalSubmit).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Malformed') })
    );
  });
});

describe('handleSelectMenu', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockBrowseHelpers.isBrowseSelect.mockReturnValue(false);
    mockSearchHelpers.isBrowseSelect.mockReturnValue(false);
    mockParseMemoryActionId.mockReturnValue(null);
  });

  it('routes browse select custom IDs to browse handler', async () => {
    mockBrowseHelpers.isBrowseSelect.mockReturnValue(true);
    const interaction = createSelectInteraction('memory-browse::browse-select::0::all::');

    await handleSelectMenu(interaction as never);

    expect(mockHandleBrowseSelect).toHaveBeenCalledWith(interaction);
    expect(mockHandleSearchSelect).not.toHaveBeenCalled();
  });

  it('routes search select custom IDs to search handler', async () => {
    mockSearchHelpers.isBrowseSelect.mockReturnValue(true);
    const interaction = createSelectInteraction('memory-search::browse-select::0::all::');

    await handleSelectMenu(interaction as never);

    expect(mockHandleSearchSelect).toHaveBeenCalledWith(interaction);
    expect(mockHandleBrowseSelect).not.toHaveBeenCalled();
  });

  it('routes memory-detail::select directly to handleMemorySelect without a session lookup', async () => {
    // Post-migration, both browse and search select menus open the same
    // detail view and rely on messageId-keyed session lookup inside
    // refreshBrowseList / refreshSearchList for back navigation. The old
    // kind-based branching here was dispatching two identical code paths,
    // so the session lookup itself was dead work — and it was running
    // BEFORE deferUpdate, violating the 3-second rule added in
    // 04-discord.md. The routing now forwards directly and the session
    // lookup is gone.
    mockParseMemoryActionId.mockReturnValue({ action: 'select' });
    const interaction = createSelectInteraction('memory-detail::select');

    await handleSelectMenu(interaction as never);

    expect(mockFindMemoryListSessionByMessage).not.toHaveBeenCalled();
    expect(mockHandleMemorySelect).toHaveBeenCalledWith(interaction);
    expect(mockHandleBrowseSelect).not.toHaveBeenCalled();
    expect(mockHandleSearchSelect).not.toHaveBeenCalled();
  });

  it('shows "unknown" message for unknown select custom IDs', async () => {
    mockParseMemoryActionId.mockReturnValue(null);
    const interaction = createSelectInteraction('unknown::select');

    await handleSelectMenu(interaction as never);

    // The session may still be valid for unknown customIds; the issue is the
    // ID itself, not session expiry. Don't mislead the user toward re-running.
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Unknown') })
    );
  });
});
