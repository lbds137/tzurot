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
  mockIsFactBrowsePagination,
  mockFactBrowseHelpers,
  mockHandleFactsPagination,
  mockRefreshFactsList,
  mockParseFactActionId,
  mockHandleFactSelect,
  mockHandleCorrectButton,
  mockHandleCorrectModalSubmit,
  mockHandleFactLockButton,
  mockHandleForgetButton,
  mockHandleForgetConfirm,
  mockHandleBatchSelectEntry,
  mockHandleBatchPick,
  mockHandleBatchConfirm,
  mockHandleMemoryBatchSelectEntry,
  mockHandleMemoryBatchPick,
  mockHandleMemoryBatchConfirm,
  mockBuildRefreshedBrowseView,
  mockBuildRefreshedSearchView,
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
  mockIsFactBrowsePagination: vi.fn(),
  mockFactBrowseHelpers: { isBrowseSelect: vi.fn() },
  mockHandleFactsPagination: vi.fn(),
  mockRefreshFactsList: vi.fn(),
  mockParseFactActionId: vi.fn(),
  mockHandleFactSelect: vi.fn(),
  mockHandleCorrectButton: vi.fn(),
  mockHandleCorrectModalSubmit: vi.fn(),
  mockHandleFactLockButton: vi.fn(),
  mockHandleForgetButton: vi.fn(),
  mockHandleForgetConfirm: vi.fn(),
  mockHandleBatchSelectEntry: vi.fn(),
  mockHandleBatchPick: vi.fn(),
  mockHandleBatchConfirm: vi.fn(),
  mockHandleMemoryBatchSelectEntry: vi.fn(),
  mockHandleMemoryBatchPick: vi.fn(),
  mockHandleMemoryBatchConfirm: vi.fn(),
  mockBuildRefreshedBrowseView: vi.fn(),
  mockBuildRefreshedSearchView: vi.fn(),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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
  buildRefreshedBrowseView: (...args: unknown[]) => mockBuildRefreshedBrowseView(...args),
}));

vi.mock('./search.js', () => ({
  searchHelpers: mockSearchHelpers,
  handleSearchPagination: (...args: unknown[]) => mockHandleSearchPagination(...args),
  handleSearchSelect: (...args: unknown[]) => mockHandleSearchSelect(...args),
  handleSearchDetailAction: (...args: unknown[]) => mockHandleSearchDetailAction(...args),
  isMemorySearchPagination: (...args: unknown[]) => mockIsMemorySearchPagination(...args),
  buildRefreshedSearchView: (...args: unknown[]) => mockBuildRefreshedSearchView(...args),
}));

vi.mock('./factsBrowse.js', () => ({
  factBrowseHelpers: mockFactBrowseHelpers,
  isFactBrowsePagination: (...args: unknown[]) => mockIsFactBrowsePagination(...args),
  handleFactsPagination: (...args: unknown[]) => mockHandleFactsPagination(...args),
  refreshFactsList: (...args: unknown[]) => mockRefreshFactsList(...args),
}));

vi.mock('./factsDetail.js', () => ({
  parseFactActionId: (...args: unknown[]) => mockParseFactActionId(...args),
  handleFactSelect: (...args: unknown[]) => mockHandleFactSelect(...args),
  handleCorrectButton: (...args: unknown[]) => mockHandleCorrectButton(...args),
  handleCorrectModalSubmit: (...args: unknown[]) => mockHandleCorrectModalSubmit(...args),
  handleFactLockButton: (...args: unknown[]) => mockHandleFactLockButton(...args),
  handleForgetButton: (...args: unknown[]) => mockHandleForgetButton(...args),
  handleForgetConfirm: (...args: unknown[]) => mockHandleForgetConfirm(...args),
}));

vi.mock('./factsBatch.js', () => ({
  handleBatchSelectEntry: (...args: unknown[]) => mockHandleBatchSelectEntry(...args),
  handleBatchPick: (...args: unknown[]) => mockHandleBatchPick(...args),
  handleBatchConfirm: (...args: unknown[]) => mockHandleBatchConfirm(...args),
}));

vi.mock('./memoriesBatch.js', () => ({
  handleMemoryBatchSelectEntry: (...args: unknown[]) => mockHandleMemoryBatchSelectEntry(...args),
  handleMemoryBatchPick: (...args: unknown[]) => mockHandleMemoryBatchPick(...args),
}));

vi.mock('./memoriesBatchConfirm.js', () => ({
  handleMemoryBatchConfirm: (...args: unknown[]) => mockHandleMemoryBatchConfirm(...args),
}));

import { handleButton, handleModal, handleSelectMenu } from './interactionHandlers.js';
import { PAGE_FETCH_FAILED_COPY } from '../../utils/browse/multiSelectBatch.js';

const TEST_MESSAGE_ID = 'msg-123';

interface MockButtonInteraction {
  customId: string;
  message: { id: string };
  reply: ReturnType<typeof vi.fn>;
  deferUpdate: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
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
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
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
    mockParseFactActionId.mockReturnValue(null);
    mockIsFactBrowsePagination.mockReturnValue(false);
    mockFactBrowseHelpers.isBrowseSelect.mockReturnValue(false);
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

  it('routes session-independent actions (lock/edit/view-full/reasoning/delete) without session lookup', async () => {
    for (const action of ['lock', 'edit', 'view-full', 'reasoning', 'delete']) {
      mockParseMemoryActionId.mockReturnValue({ action, memoryId: 'mem-1' });
      mockHandleBrowseDetailAction.mockResolvedValue(true);

      const interaction = createButtonInteraction(`memory-detail::${action}::mem-1`);

      await handleButton(interaction as never);

      expect(mockHandleBrowseDetailAction).toHaveBeenCalledWith(interaction);
      expect(mockFindMemoryListSessionByMessage).not.toHaveBeenCalled();
      expect(mockHandleSearchDetailAction).not.toHaveBeenCalled();
    }
  });

  it('still routes lock/edit/view-full/reasoning even when session has expired', async () => {
    for (const action of ['lock', 'edit', 'view-full', 'reasoning'] as const) {
      vi.clearAllMocks();
      mockParseMemoryActionId.mockReturnValue({ action, memoryId: 'mem-1' });
      mockFindMemoryListSessionByMessage.mockResolvedValue(null);

      const interaction = createButtonInteraction(`memory-detail::${action}::mem-1`);

      await handleButton(interaction as never);

      // Expired session should NOT block session-independent actions
      expect(mockHandleBrowseDetailAction).toHaveBeenCalledWith(interaction);
      expect(interaction.reply).not.toHaveBeenCalled();
    }
  });

  it('SESSION_INDEPENDENT_ACTIONS invariant: lock on a search-opened memory never touches the search handler', async () => {
    // Regression scenario: a memory is opened from a search result, so
    // the dashboard session for this message is kind='search'. When the
    // user clicks lock (or any SESSION_INDEPENDENT_ACTIONS entry), the
    // router MUST bypass the session lookup entirely and route through
    // handleBrowseDetailAction without calling handleSearchDetailAction.
    //
    // This test protects the invariant by name so a future contributor
    // who adds an onRefresh call to the lock case in detailActionRouter
    // will see this test fail and understand WHY — the JSDoc comments
    // in interactionHandlers.ts and detailActionRouter.ts warn about it,
    // but tests are the enforcement mechanism.
    mockParseMemoryActionId.mockReturnValue({ action: 'lock', memoryId: 'mem-1' });
    mockHandleBrowseDetailAction.mockResolvedValue(true);
    // Arrange a search session on this message; the test asserts the
    // router does NOT consult it.
    mockFindMemoryListSessionByMessage.mockResolvedValue({
      data: { kind: 'search', searchQuery: 'love', currentPage: 0, pageSize: 5 },
    });

    const interaction = createButtonInteraction('memory-detail::lock::mem-1');

    await handleButton(interaction as never);

    // The session is NEVER looked up for SESSION_INDEPENDENT_ACTIONS, so
    // its kind is irrelevant to routing.
    expect(mockFindMemoryListSessionByMessage).not.toHaveBeenCalled();
    // Route goes through the browse detail action unconditionally.
    expect(mockHandleBrowseDetailAction).toHaveBeenCalledWith(interaction);
    // Critical: the search handler is NEVER called for these actions.
    // If this assertion ever fails, something added onRefresh to a
    // session-independent action — move it to the session-dependent
    // path instead, or memories opened from search will silently stop
    // refreshing.
    expect(mockHandleSearchDetailAction).not.toHaveBeenCalled();
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

  it('defers immediately and shows expired message via followUp when session-dependent action has no session', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'back' });
    mockFindMemoryListSessionByMessage.mockResolvedValue(null);

    const interaction = createButtonInteraction('memory-detail::back');

    await handleButton(interaction as never);

    // Ack must happen BEFORE the session lookup to stay inside Discord's
    // 3-second interaction window (04-discord.md). After deferUpdate, the
    // expired-session path uses followUp, not reply.
    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('expired') })
    );
    expect(mockHandleBrowseDetailAction).not.toHaveBeenCalled();
    expect(mockHandleSearchDetailAction).not.toHaveBeenCalled();
  });

  it('shows error for unknown button interactions', async () => {
    mockParseMemoryActionId.mockReturnValue(null);
    mockParseFactActionId.mockReturnValue(null);
    mockIsFactBrowsePagination.mockReturnValue(false);
    mockFactBrowseHelpers.isBrowseSelect.mockReturnValue(false);
    const interaction = createButtonInteraction('unrelated::button');

    await handleButton(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Unknown') })
    );
  });

  it('shows error via followUp when session-dependent detail handler returns false', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'back' });
    mockFindMemoryListSessionByMessage.mockResolvedValue({ data: { kind: 'browse' } });
    mockHandleBrowseDetailAction.mockResolvedValue(false);

    const interaction = createButtonInteraction('memory-detail::back');

    await handleButton(interaction as never);

    // Interaction is already deferred at this point (ack-first), so the
    // unknown-action error must use followUp rather than reply.
    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Unknown action') })
    );
    expect(interaction.reply).not.toHaveBeenCalled();
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
    mockParseFactActionId.mockReturnValue(null);
    mockIsFactBrowsePagination.mockReturnValue(false);
    mockFactBrowseHelpers.isBrowseSelect.mockReturnValue(false);
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
    mockParseFactActionId.mockReturnValue(null);
    mockIsFactBrowsePagination.mockReturnValue(false);
    mockFactBrowseHelpers.isBrowseSelect.mockReturnValue(false);
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
    mockParseFactActionId.mockReturnValue(null);
    mockIsFactBrowsePagination.mockReturnValue(false);
    mockFactBrowseHelpers.isBrowseSelect.mockReturnValue(false);
    const interaction = createSelectInteraction('unknown::select');

    await handleSelectMenu(interaction as never);

    // The session may still be valid for unknown customIds; the issue is the
    // ID itself, not session expiry. Don't mislead the user toward re-running.
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Unknown') })
    );
  });
});

describe('fact routing (correction slice)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockIsMemoryBrowsePagination.mockReturnValue(false);
    mockIsMemorySearchPagination.mockReturnValue(false);
    mockParseMemoryActionId.mockReturnValue(null);
    mockParseFactActionId.mockReturnValue(null);
    mockIsFactBrowsePagination.mockReturnValue(false);
    mockFactBrowseHelpers.isBrowseSelect.mockReturnValue(false);
    mockBrowseHelpers.isBrowseSelect.mockReturnValue(false);
    mockSearchHelpers.isBrowseSelect.mockReturnValue(false);
  });

  it('routes fact pagination buttons to handleFactsPagination', async () => {
    mockIsFactBrowsePagination.mockReturnValue(true);
    const interaction = createButtonInteraction('memory-fact-browse::browse::1::all');

    await handleButton(interaction as never);

    expect(mockHandleFactsPagination).toHaveBeenCalledWith(interaction);
    expect(mockParseFactActionId).not.toHaveBeenCalled();
  });

  it('routes the correct button WITHOUT deferring (showModal must be first response)', async () => {
    mockParseFactActionId.mockReturnValue({ action: 'correct', factId: 'fact-1' });
    const interaction = createButtonInteraction('memory-fact::correct::fact-1');

    await handleButton(interaction as never);

    expect(mockHandleCorrectButton).toHaveBeenCalledWith(interaction, 'fact-1');
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
  });

  it('routes lock with the decoded TARGET state from the extra slot', async () => {
    mockParseFactActionId.mockReturnValue({ action: 'lock', factId: 'fact-1', extra: '1' });
    const interaction = createButtonInteraction('memory-fact::lock::fact-1::1');

    await handleButton(interaction as never);

    expect(mockHandleFactLockButton).toHaveBeenCalledWith(interaction, 'fact-1', true);
  });

  it('routes forget to the confirmation view', async () => {
    mockParseFactActionId.mockReturnValue({ action: 'forget', factId: 'fact-1' });
    const interaction = createButtonInteraction('memory-fact::forget::fact-1');

    await handleButton(interaction as never);

    expect(mockHandleForgetButton).toHaveBeenCalledWith(interaction, 'fact-1');
  });

  it('back defers then refreshes the facts list', async () => {
    mockParseFactActionId.mockReturnValue({ action: 'back' });
    const interaction = createButtonInteraction('memory-fact::back');

    await handleButton(interaction as never);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(mockRefreshFactsList).toHaveBeenCalledWith(interaction);
    expect(vi.mocked(interaction.deferUpdate).mock.invocationCallOrder[0]).toBeLessThan(
      mockRefreshFactsList.mock.invocationCallOrder[0]
    );
  });

  it('confirm-forget refreshes the list ONLY when the forget succeeded', async () => {
    mockParseFactActionId.mockReturnValue({ action: 'confirm-forget', factId: 'fact-1' });
    mockHandleForgetConfirm.mockResolvedValue(true);
    const interaction = createButtonInteraction('memory-fact::confirm-forget::fact-1');

    await handleButton(interaction as never);

    expect(mockHandleForgetConfirm).toHaveBeenCalledWith(interaction, 'fact-1');
    expect(mockRefreshFactsList).toHaveBeenCalledWith(interaction);
    expect(vi.mocked(interaction.deferUpdate).mock.invocationCallOrder[0]).toBeLessThan(
      mockRefreshFactsList.mock.invocationCallOrder[0]
    );

    // Failure path: no refresh (the error was already surfaced via followUp).
    mockRefreshFactsList.mockClear();
    mockHandleForgetConfirm.mockResolvedValue(false);
    await handleButton(createButtonInteraction('memory-fact::confirm-forget::fact-1') as never);
    expect(mockRefreshFactsList).not.toHaveBeenCalled();
  });

  it('routes the batch-select toggle button and the multi-select by interaction kind', async () => {
    mockParseFactActionId.mockReturnValue({ action: 'batch-select' });

    const toggle = createButtonInteraction('memory-fact::batch-select');
    await handleButton(toggle as never);
    expect(mockHandleBatchSelectEntry).toHaveBeenCalledWith(toggle);
    expect(mockHandleBatchPick).not.toHaveBeenCalled();

    const pick = createSelectInteraction('memory-fact::batch-select');
    await handleSelectMenu(pick as never);
    expect(mockHandleBatchPick).toHaveBeenCalledWith(pick);
    expect(mockHandleBatchSelectEntry).toHaveBeenCalledTimes(1);
  });

  it('routes batch-cancel like back: defer then refresh the list', async () => {
    mockParseFactActionId.mockReturnValue({ action: 'batch-cancel' });
    const interaction = createButtonInteraction('memory-fact::batch-cancel');

    await handleButton(interaction as never);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(mockRefreshFactsList).toHaveBeenCalledWith(interaction);
    expect(vi.mocked(interaction.deferUpdate).mock.invocationCallOrder[0]).toBeLessThan(
      mockRefreshFactsList.mock.invocationCallOrder[0]
    );
  });

  it('routes batch-confirm with the decoded verb', async () => {
    mockParseFactActionId.mockReturnValue({ action: 'batch-confirm', factId: 'forget' });
    const interaction = createButtonInteraction('memory-fact::batch-confirm::forget');

    await handleButton(interaction as never);

    expect(mockHandleBatchConfirm).toHaveBeenCalledWith(interaction, 'forget');
  });

  it('rejects an unknown batch-confirm verb with the generic validation reply', async () => {
    // The verb rides the factId slot — a value that is neither forget nor lock
    // falls through to the unhandled-action reply, never to handleBatchConfirm.
    mockParseFactActionId.mockReturnValue({ action: 'batch-confirm', factId: 'delete' });
    const interaction = createButtonInteraction('memory-fact::batch-confirm::delete');

    await handleButton(interaction as never);

    expect(mockHandleBatchConfirm).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.any(String) })
    );
  });

  it('rejects an unknown fact action with a validation reply', async () => {
    mockParseFactActionId.mockReturnValue({ action: 'mystery', factId: 'fact-1' });
    const interaction = createButtonInteraction('memory-fact::mystery::fact-1');

    await handleButton(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.any(String) })
    );
  });

  it('routes the correct MODAL submit by fact customId', async () => {
    mockParseFactActionId.mockReturnValue({ action: 'correct', factId: 'fact-1' });
    const interaction = createModalInteraction('memory-fact::correct::fact-1');

    await handleModal(interaction as never);

    expect(mockHandleCorrectModalSubmit).toHaveBeenCalledWith(interaction, 'fact-1');
    expect(mockHandleEditModalSubmit).not.toHaveBeenCalled();
  });

  it('routes fact select menus (both the browse-select and detail select ids)', async () => {
    mockFactBrowseHelpers.isBrowseSelect.mockReturnValue(true);
    const browseSelect = createSelectInteraction('memory-fact-browse::browse-select');
    await handleSelectMenu(browseSelect as never);
    expect(mockHandleFactSelect).toHaveBeenCalledWith(browseSelect);

    mockHandleFactSelect.mockClear();
    mockFactBrowseHelpers.isBrowseSelect.mockReturnValue(false);
    mockParseFactActionId.mockReturnValue({ action: 'select' });
    const detailSelect = createSelectInteraction('memory-fact::select');
    await handleSelectMenu(detailSelect as never);
    expect(mockHandleFactSelect).toHaveBeenCalledWith(detailSelect);
  });
});

describe('memory batch routing (memoriesBatch)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockIsMemoryBrowsePagination.mockReturnValue(false);
    mockIsMemorySearchPagination.mockReturnValue(false);
    mockParseMemoryActionId.mockReturnValue(null);
    mockParseFactActionId.mockReturnValue(null);
    mockIsFactBrowsePagination.mockReturnValue(false);
    mockFactBrowseHelpers.isBrowseSelect.mockReturnValue(false);
    mockBrowseHelpers.isBrowseSelect.mockReturnValue(false);
    mockSearchHelpers.isBrowseSelect.mockReturnValue(false);
  });

  it('routes the batch-select toggle button and the multi-select by interaction kind', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'batch-select' });

    const toggle = createButtonInteraction('memory-detail::batch-select');
    await handleButton(toggle as never);
    expect(mockHandleMemoryBatchSelectEntry).toHaveBeenCalledWith(toggle);
    expect(mockHandleMemoryBatchPick).not.toHaveBeenCalled();

    const pick = createSelectInteraction('memory-detail::batch-select');
    await handleSelectMenu(pick as never);
    expect(mockHandleMemoryBatchPick).toHaveBeenCalledWith(pick);
    expect(mockHandleMemoryBatchSelectEntry).toHaveBeenCalledTimes(1);
  });

  it('routes batch-cancel with a kind-dispatched refresh: browse session edits the refreshed browse view', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'batch-cancel' });
    mockFindMemoryListSessionByMessage.mockResolvedValue({ data: { kind: 'browse' } });
    const view = { embed: { kind: 'browse-embed' }, components: [] };
    mockBuildRefreshedBrowseView.mockResolvedValue(view);
    const interaction = createButtonInteraction('memory-detail::batch-cancel');

    await handleButton(interaction as never);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(mockBuildRefreshedBrowseView).toHaveBeenCalledWith(interaction);
    expect(mockBuildRefreshedSearchView).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      embeds: [view.embed],
      components: view.components,
    });
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  it('routes batch-cancel with a kind-dispatched refresh: search session edits the refreshed search view', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'batch-cancel' });
    mockFindMemoryListSessionByMessage.mockResolvedValue({ data: { kind: 'search' } });
    const view = { embed: { kind: 'search-embed' }, components: [] };
    mockBuildRefreshedSearchView.mockResolvedValue(view);
    const interaction = createButtonInteraction('memory-detail::batch-cancel');

    await handleButton(interaction as never);

    expect(mockBuildRefreshedSearchView).toHaveBeenCalledWith(interaction);
    expect(mockBuildRefreshedBrowseView).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      embeds: [view.embed],
      components: view.components,
    });
  });

  it('sends the transient followUp when a live batch-cancel session fails its refresh', async () => {
    // Null view on a LIVE session = the refresh fetch failed — not a silent
    // no-op (the old refreshBrowseList shape): the user gets the transient copy.
    mockParseMemoryActionId.mockReturnValue({ action: 'batch-cancel' });
    mockFindMemoryListSessionByMessage.mockResolvedValue({ data: { kind: 'browse' } });
    mockBuildRefreshedBrowseView.mockResolvedValue(null);
    const interaction = createButtonInteraction('memory-detail::batch-cancel');

    await handleButton(interaction as never);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining(PAGE_FETCH_FAILED_COPY) })
    );
  });

  it('shows the expired message via followUp when batch-cancel has no session', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'batch-cancel' });
    mockFindMemoryListSessionByMessage.mockResolvedValue(null);
    const interaction = createButtonInteraction('memory-detail::batch-cancel');

    await handleButton(interaction as never);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('expired') })
    );
    expect(mockBuildRefreshedBrowseView).not.toHaveBeenCalled();
    expect(mockBuildRefreshedSearchView).not.toHaveBeenCalled();
  });

  it('routes batch-confirm with the decoded verb and the resolved session', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'batch-confirm', memoryId: 'delete' });
    const session = { data: { kind: 'browse' } };
    mockFindMemoryListSessionByMessage.mockResolvedValue(session);
    const del = createButtonInteraction('memory-detail::batch-confirm::delete');

    await handleButton(del as never);

    expect(mockHandleMemoryBatchConfirm).toHaveBeenCalledWith(del, 'delete', session);

    mockParseMemoryActionId.mockReturnValue({ action: 'batch-confirm', memoryId: 'lock' });
    const lock = createButtonInteraction('memory-detail::batch-confirm::lock');

    await handleButton(lock as never);

    expect(mockHandleMemoryBatchConfirm).toHaveBeenCalledWith(lock, 'lock', session);
  });

  it('never routes an unknown batch-confirm verb to the batch handler', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'batch-confirm', memoryId: 'mystery' });
    mockFindMemoryListSessionByMessage.mockResolvedValue({ data: { kind: 'browse' } });
    mockHandleBrowseDetailAction.mockResolvedValue(false);
    const interaction = createButtonInteraction('memory-detail::batch-confirm::mystery');

    await handleButton(interaction as never);

    expect(mockHandleMemoryBatchConfirm).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Unknown action') })
    );
  });

  it('batch-confirm is NOT session-independent: a gone session is refused before the handler', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'batch-confirm', memoryId: 'delete' });
    mockFindMemoryListSessionByMessage.mockResolvedValue(null);
    const interaction = createButtonInteraction('memory-detail::batch-confirm::delete');

    await handleButton(interaction as never);

    expect(mockFindMemoryListSessionByMessage).toHaveBeenCalled();
    expect(mockHandleMemoryBatchConfirm).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('expired') })
    );
  });
});
