/**
 * Tests for memory search handler.
 *
 * Covers:
 * - handleSearch: fetches first page, saves session with query
 * - handleSearchPagination: reads session for query + personality, re-fetches
 * - handleSearchSelect: delegates to detail view with search context
 * - refreshSearchList: handles empty-page edge case
 * - handleSearchDetailAction: delegates to detail router
 * - isMemorySearchPagination: custom ID guard
 * - Text vs semantic search type handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';

const {
  clientsForMock,
  mockResolveOptionalPersonality,
  mockHandleMemorySelect,
  mockHandleMemoryDetailAction,
  mockSaveMemoryListSession,
  mockFindMemoryListSessionByMessage,
  mockUpdateMemoryListSessionPage,
} = vi.hoisted(() => ({
  clientsForMock: vi.fn(),
  mockResolveOptionalPersonality: vi.fn(),
  mockHandleMemorySelect: vi.fn(),
  mockHandleMemoryDetailAction: vi.fn(),
  mockSaveMemoryListSession: vi.fn(),
  mockFindMemoryListSessionByMessage: vi.fn(),
  mockUpdateMemoryListSessionPage: vi.fn(),
}));

vi.mock('@tzurot/common-types/generated/commandOptions', async () => {
  const actual = await vi.importActual<
    typeof import('@tzurot/common-types/generated/commandOptions')
  >('@tzurot/common-types/generated/commandOptions');
  return {
    ...actual,
    memorySearchOptions: (interaction: {
      options?: {
        getString: (name: string) => string;
        getInteger?: (name: string) => number | null;
      };
    }) => ({
      query: () => interaction.options?.getString('query') ?? 'test query',
      character: () => interaction.options?.getString('character') ?? null,
      limit: () => interaction.options?.getInteger?.('limit') ?? null,
    }),
  };
});

vi.mock('@tzurot/common-types/utils/dateFormatting', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/dateFormatting')>(
    '@tzurot/common-types/utils/dateFormatting'
  );
  return {
    ...actual,
    formatDateShort: (d: string | Date) => String(d),
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

vi.mock('./resolveHelpers.js', () => ({
  resolveOptionalPersonality: (...args: unknown[]) => mockResolveOptionalPersonality(...args),
}));

vi.mock('./detail.js', () => ({
  // buildMemoryActionId is a pure string-builder used by search.ts to
  // construct the select menu's customId. The factory accepts any
  // pre-built customId string, so we return a deterministic stub.
  buildMemoryActionId: (action: string, id?: string) =>
    id !== undefined ? `memory-detail::${action}::${id}` : `memory-detail::${action}`,
  handleMemorySelect: (...args: unknown[]) => mockHandleMemorySelect(...args),
}));

vi.mock('./detailActionRouter.js', () => ({
  handleMemoryDetailAction: (...args: unknown[]) => mockHandleMemoryDetailAction(...args),
}));

// Mock the session-manager-backed functions but keep the real
// fetchPageWithEmptyFallback helper — it's pure and we want the refresh
// tests to exercise the actual empty-page stepback logic, not a stub.
vi.mock('./browseSession.js', async () => {
  const actual = await vi.importActual<typeof import('./browseSession.js')>('./browseSession.js');
  return {
    ...actual,
    saveMemoryListSession: (...args: unknown[]) => mockSaveMemoryListSession(...args),
    findMemoryListSessionByMessage: (...args: unknown[]) =>
      mockFindMemoryListSessionByMessage(...args),
    updateMemoryListSessionPage: (...args: unknown[]) => mockUpdateMemoryListSessionPage(...args),
    MEMORY_SEARCH_ENTITY_TYPE: 'memory-search',
  };
});

import {
  handleSearch,
  handleSearchPagination,
  handleSearchSelect,
  handleSearchDetailAction,
  refreshSearchList,
  isMemorySearchPagination,
  searchHelpers,
} from './search.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';

const TEST_USER_ID = 'user-123';
const TEST_MESSAGE_ID = 'msg-456';
const TEST_CHANNEL_ID = 'ch-789';
const TEST_PERSONALITY_ID = '00000000-0000-0000-0000-000000000001';
const TEST_QUERY = 'love and loss';

const sampleResult = {
  id: 'mem-1',
  content: 'A memory about love',
  personalityId: TEST_PERSONALITY_ID,
  personalityName: 'Test',
  isLocked: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  similarity: 0.85,
};

const sampleSemanticResponse = {
  results: [sampleResult],
  count: 1,
  hasMore: false,
  searchType: 'semantic' as const,
};

interface MemoryClientStub {
  search: ReturnType<typeof vi.fn>;
}

function createStub(): MemoryClientStub {
  return { search: vi.fn() };
}

let stub: MemoryClientStub;

interface MockDeferredContext {
  interaction: {
    user: { id: string; username: string };
    options: {
      getString: ReturnType<typeof vi.fn>;
      getInteger: ReturnType<typeof vi.fn>;
    };
  };
  user: { id: string; username: string };
  editReply: ReturnType<typeof vi.fn>;
}

interface MockButtonInteraction {
  customId: string;
  message: { id: string };
  user: { id: string; username: string };
  deferUpdate: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
  reply: ReturnType<typeof vi.fn>;
  replied: boolean;
  deferred: boolean;
}

interface MockSelectInteraction {
  customId: string;
  values: string[];
  message: { id: string };
  user: { id: string };
}

function createDeferredContext(
  query = TEST_QUERY,
  limit: number | null = null
): MockDeferredContext {
  return {
    interaction: {
      user: { id: TEST_USER_ID, username: 'testuser' },
      options: {
        getString: vi.fn((name: string) =>
          name === 'query' ? query : name === 'character' ? null : null
        ),
        getInteger: vi.fn((name: string) => (name === 'limit' ? limit : null)),
      },
    },
    user: { id: TEST_USER_ID, username: 'testuser' },
    editReply: vi.fn().mockResolvedValue({ id: TEST_MESSAGE_ID, channelId: TEST_CHANNEL_ID }),
  };
}

function createButtonInteraction(customId: string): MockButtonInteraction {
  return {
    customId,
    message: { id: TEST_MESSAGE_ID },
    user: { id: TEST_USER_ID, username: 'testuser' },
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue({ id: TEST_MESSAGE_ID }),
    followUp: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    replied: false,
    deferred: false,
  };
}

function createSelectInteraction(customId: string): MockSelectInteraction {
  return {
    customId,
    values: ['mem-1'],
    message: { id: TEST_MESSAGE_ID },
    user: { id: TEST_USER_ID },
  };
}

describe('handleSearch', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
    mockResolveOptionalPersonality.mockResolvedValue(TEST_PERSONALITY_ID);
    stub.search.mockResolvedValue(makeOk(sampleSemanticResponse));
  });

  it('fetches semantic results and saves a search session', async () => {
    const context = createDeferredContext();

    await handleSearch(context as unknown as DeferredCommandContext);

    expect(stub.search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: TEST_QUERY,
        limit: 5,
        offset: 0,
        personalityId: TEST_PERSONALITY_ID,
      })
    );
    expect(mockSaveMemoryListSession).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'search',
          personalityId: TEST_PERSONALITY_ID,
          currentPage: 0,
          searchQuery: TEST_QUERY,
          pageSize: 5,
        }),
      })
    );
  });

  it('honors the limit slash option when provided', async () => {
    // Verifies that /memory search limit:8 actually fetches 8 results per page
    // and persists pageSize=8 in the session so pagination uses the same size.
    const context = createDeferredContext(TEST_QUERY, 8);

    await handleSearch(context as unknown as DeferredCommandContext);

    expect(stub.search).toHaveBeenCalledWith(expect.objectContaining({ limit: 8 }));
    expect(mockSaveMemoryListSession).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'search', pageSize: 8 }),
      })
    );
  });

  it('handles text fallback searches and persists searchType in session', async () => {
    stub.search.mockResolvedValue(
      makeOk({ ...sampleSemanticResponse, searchType: 'text' as const })
    );
    const context = createDeferredContext();

    await handleSearch(context as unknown as DeferredCommandContext);

    expect(context.editReply).toHaveBeenCalled();
    // searchType must round-trip into the session so subsequent pagination
    // can skip the semantic attempt — fixes the regression where text
    // fallback was lost across page navigation.
    expect(mockSaveMemoryListSession).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'search', searchType: 'text' }),
      })
    );
  });

  it('aborts early when personality resolution returns null (helper handles the error reply)', async () => {
    // resolveOptionalPersonality is contracted to reply with the error itself
    // when it returns null, so handleSearch just returns without calling editReply
    mockResolveOptionalPersonality.mockResolvedValue(null);
    const context = createDeferredContext();

    await handleSearch(context as unknown as DeferredCommandContext);

    expect(stub.search).not.toHaveBeenCalled();
    // handleSearch should NOT double-reply — the helper already did
    expect(context.editReply).not.toHaveBeenCalled();
  });

  it('shows error when API call fails', async () => {
    stub.search.mockResolvedValue(makeErr(500, 'Server error'));
    const context = createDeferredContext();

    await handleSearch(context as unknown as DeferredCommandContext);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Failed') })
    );
    expect(mockSaveMemoryListSession).not.toHaveBeenCalled();
  });

  it('handles unexpected errors', async () => {
    stub.search.mockRejectedValue(new Error('network'));
    const context = createDeferredContext();

    await handleSearch(context as unknown as DeferredCommandContext);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('unexpected error') })
    );
  });
});

describe('handleSearchPagination', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  it('re-runs search with new page when session exists', async () => {
    mockFindMemoryListSessionByMessage.mockResolvedValue({
      data: {
        kind: 'search',
        personalityId: TEST_PERSONALITY_ID,
        currentPage: 0,
        searchQuery: TEST_QUERY,
        pageSize: 5,
      },
    });
    stub.search.mockResolvedValue(makeOk({ ...sampleSemanticResponse, hasMore: true }));

    const interaction = createButtonInteraction(searchHelpers.build(1, 'all', 'date', null));

    await handleSearchPagination(interaction as unknown as ButtonInteraction);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(stub.search).toHaveBeenCalledWith(
      expect.objectContaining({ query: TEST_QUERY, offset: 5 })
    );
    expect(mockUpdateMemoryListSessionPage).toHaveBeenCalledWith(
      expect.objectContaining({ newPage: 1, kind: 'search' })
    );
  });

  it('uses session pageSize for pagination offset/limit, not the default', async () => {
    // Regression: paginating a non-default search must use the saved
    // pageSize, not revert to DEFAULT_RESULTS_PER_PAGE.
    mockFindMemoryListSessionByMessage.mockResolvedValue({
      data: {
        kind: 'search',
        personalityId: TEST_PERSONALITY_ID,
        currentPage: 0,
        searchQuery: TEST_QUERY,
        pageSize: 8,
      },
    });
    stub.search.mockResolvedValue(makeOk({ ...sampleSemanticResponse, hasMore: false }));

    const interaction = createButtonInteraction(searchHelpers.build(2, 'all', 'date', null));

    await handleSearchPagination(interaction as unknown as ButtonInteraction);

    expect(stub.search).toHaveBeenCalledWith(
      // Page 2 of 8-per-page → offset 16, limit 8
      expect.objectContaining({ offset: 16, limit: 8 })
    );
  });

  it('threads preferTextSearch=true when session searchType is text', async () => {
    // Regression: when the first page fell back to text search, every
    // paginated page should skip the semantic attempt to avoid an extra
    // embedding round-trip.
    mockFindMemoryListSessionByMessage.mockResolvedValue({
      data: {
        kind: 'search',
        personalityId: TEST_PERSONALITY_ID,
        currentPage: 0,
        searchQuery: TEST_QUERY,
        pageSize: 5,
        searchType: 'text',
      },
    });
    stub.search.mockResolvedValue(makeOk({ ...sampleSemanticResponse, hasMore: false }));

    const interaction = createButtonInteraction(searchHelpers.build(1, 'all', 'date', null));

    await handleSearchPagination(interaction as unknown as ButtonInteraction);

    expect(stub.search).toHaveBeenCalledWith(expect.objectContaining({ preferTextSearch: true }));
  });

  it('omits preferTextSearch when session searchType is semantic', async () => {
    mockFindMemoryListSessionByMessage.mockResolvedValue({
      data: {
        kind: 'search',
        personalityId: TEST_PERSONALITY_ID,
        currentPage: 0,
        searchQuery: TEST_QUERY,
        pageSize: 5,
        searchType: 'semantic',
      },
    });
    stub.search.mockResolvedValue(makeOk({ ...sampleSemanticResponse, hasMore: false }));

    const interaction = createButtonInteraction(searchHelpers.build(1, 'all', 'date', null));

    await handleSearchPagination(interaction as unknown as ButtonInteraction);

    // fetchSearchResults only sets preferTextSearch in the body when true,
    // so a semantic session must NOT include the field at all.
    const callArgs = stub.search.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty('preferTextSearch');
  });

  it('defers immediately and shows expired message via followUp when session is missing', async () => {
    mockFindMemoryListSessionByMessage.mockResolvedValue(null);
    const interaction = createButtonInteraction(searchHelpers.build(2, 'all', 'date', null));

    await handleSearchPagination(interaction as unknown as ButtonInteraction);

    // Acknowledgment must happen BEFORE session lookup so we stay inside
    // Discord's 3-second interaction window regardless of Redis latency.
    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('expired') })
    );
    expect(stub.search).not.toHaveBeenCalled();
  });

  it('shows expired message when session kind is browse', async () => {
    mockFindMemoryListSessionByMessage.mockResolvedValue({
      data: { kind: 'browse', personalityId: TEST_PERSONALITY_ID, currentPage: 0 },
    });
    const interaction = createButtonInteraction(searchHelpers.build(1, 'all', 'date', null));

    await handleSearchPagination(interaction as unknown as ButtonInteraction);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('expired') })
    );
  });

  it('ignores interactions with non-search custom IDs', async () => {
    const interaction = createButtonInteraction('other::foo');

    await handleSearchPagination(interaction as unknown as ButtonInteraction);

    expect(mockFindMemoryListSessionByMessage).not.toHaveBeenCalled();
  });
});

describe('handleSearchSelect', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('forwards to handleMemorySelect without any session lookup', async () => {
    // Post-migration, handleSearchSelect is a thin pass-through. No session
    // lookup happens — back navigation from the detail view reads the session
    // via messageId inside refreshSearchList. Thinning this wrapper removed
    // a dead Redis call that previously ran before deferUpdate (violating
    // the 3-second rule added in 04-discord.md).
    const interaction = createSelectInteraction('memory-detail::select');

    await handleSearchSelect(interaction as unknown as StringSelectMenuInteraction);

    expect(mockFindMemoryListSessionByMessage).not.toHaveBeenCalled();
    expect(mockHandleMemorySelect).toHaveBeenCalledWith(interaction);
    expect(mockHandleMemorySelect).toHaveBeenCalledTimes(1);
    const [, ...extras] = mockHandleMemorySelect.mock.calls[0] as [unknown, ...unknown[]];
    expect(extras).toEqual([]);
  });
});

describe('refreshSearchList', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  it('re-fetches and updates message using session state', async () => {
    mockFindMemoryListSessionByMessage.mockResolvedValue({
      data: {
        kind: 'search',
        personalityId: TEST_PERSONALITY_ID,
        currentPage: 1,
        searchQuery: TEST_QUERY,
        pageSize: 5,
      },
    });
    stub.search.mockResolvedValue(makeOk(sampleSemanticResponse));

    const interaction = createButtonInteraction('memory-detail::back');

    await refreshSearchList(interaction as unknown as ButtonInteraction);

    expect(stub.search).toHaveBeenCalledWith(
      expect.objectContaining({ query: TEST_QUERY, offset: 5 })
    );
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it('steps back one page when current page is empty after delete', async () => {
    mockFindMemoryListSessionByMessage.mockResolvedValue({
      data: {
        kind: 'search',
        personalityId: TEST_PERSONALITY_ID,
        currentPage: 2,
        searchQuery: TEST_QUERY,
        pageSize: 5,
      },
    });
    stub.search
      .mockResolvedValueOnce(makeOk({ results: [], count: 0, hasMore: false }))
      .mockResolvedValueOnce(makeOk(sampleSemanticResponse));

    const interaction = createButtonInteraction('memory-detail::back');

    await refreshSearchList(interaction as unknown as ButtonInteraction);

    expect(stub.search).toHaveBeenCalledTimes(2);
    expect(mockUpdateMemoryListSessionPage).toHaveBeenCalledWith(
      expect.objectContaining({ newPage: 1 })
    );
  });

  it('no-ops when session is missing', async () => {
    mockFindMemoryListSessionByMessage.mockResolvedValue(null);
    const interaction = createButtonInteraction('memory-detail::back');

    await refreshSearchList(interaction as unknown as ButtonInteraction);

    expect(stub.search).not.toHaveBeenCalled();
  });

  it('no-ops when session kind is browse', async () => {
    mockFindMemoryListSessionByMessage.mockResolvedValue({
      data: { kind: 'browse', personalityId: TEST_PERSONALITY_ID, currentPage: 0 },
    });
    const interaction = createButtonInteraction('memory-detail::back');

    await refreshSearchList(interaction as unknown as ButtonInteraction);

    expect(stub.search).not.toHaveBeenCalled();
  });

  // Note: a "search session without searchQuery" test was deleted along with
  // the corresponding runtime guard, because the discriminated union now makes
  // searchQuery a required field on the 'search' variant — that state can't
  // be constructed without `as never` casting.
});

describe('handleSearchDetailAction', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('delegates to handleMemoryDetailAction with a refresh callback', async () => {
    mockHandleMemoryDetailAction.mockResolvedValue(true);
    const interaction = createButtonInteraction('memory-detail::lock::mem-1');

    const handled = await handleSearchDetailAction(interaction as unknown as ButtonInteraction);

    expect(handled).toBe(true);
    expect(mockHandleMemoryDetailAction).toHaveBeenCalledWith(interaction, expect.any(Function));
  });

  it('returns false when detail router does not handle the action', async () => {
    mockHandleMemoryDetailAction.mockResolvedValue(false);
    const interaction = createButtonInteraction('unrelated');

    const handled = await handleSearchDetailAction(interaction as unknown as ButtonInteraction);

    expect(handled).toBe(false);
  });
});

describe('isMemorySearchPagination', () => {
  it('recognizes search pagination buttons', () => {
    expect(isMemorySearchPagination(searchHelpers.build(0, 'all', 'date', null))).toBe(true);
  });

  it('deliberately does NOT match search select menus', () => {
    // Same rationale as isMemoryBrowsePagination: handleButton never sees
    // select interactions, so this guard stays narrow to match its name.
    expect(isMemorySearchPagination(searchHelpers.buildSelect(0, 'all', 'date', null))).toBe(false);
  });

  it('rejects unrelated custom IDs', () => {
    expect(isMemorySearchPagination('memory-browse::browse::0::all::')).toBe(false);
    expect(isMemorySearchPagination('memory-detail::edit::mem-1')).toBe(false);
  });
});
