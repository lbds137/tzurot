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

const {
  mockCallGatewayApi,
  mockResolveOptionalPersonality,
  mockHandleMemorySelect,
  mockHandleMemoryDetailAction,
  mockBuildMemorySelectMenu,
  mockSaveMemoryListSession,
  mockFindMemoryListSessionByMessage,
  mockUpdateMemoryListSessionPage,
} = vi.hoisted(() => ({
  mockCallGatewayApi: vi.fn(),
  mockResolveOptionalPersonality: vi.fn(),
  mockHandleMemorySelect: vi.fn(),
  mockHandleMemoryDetailAction: vi.fn(),
  mockBuildMemorySelectMenu: vi.fn((..._args: unknown[]) => ({ components: [] })),
  mockSaveMemoryListSession: vi.fn(),
  mockFindMemoryListSessionByMessage: vi.fn(),
  mockUpdateMemoryListSessionPage: vi.fn(),
}));

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    memorySearchOptions: (interaction: { options?: { getString: (name: string) => string } }) => ({
      query: () => interaction.options?.getString('query') ?? 'test query',
      personality: () => interaction.options?.getString('personality') ?? null,
    }),
    formatDateShort: (d: string | Date) => String(d),
  };
});

vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

vi.mock('./resolveHelpers.js', () => ({
  resolveOptionalPersonality: (...args: unknown[]) => mockResolveOptionalPersonality(...args),
}));

vi.mock('./detail.js', () => ({
  buildMemorySelectMenu: (...args: unknown[]) => mockBuildMemorySelectMenu(...args),
  handleMemorySelect: (...args: unknown[]) => mockHandleMemorySelect(...args),
}));

vi.mock('./detailActionRouter.js', () => ({
  handleMemoryDetailAction: (...args: unknown[]) => mockHandleMemoryDetailAction(...args),
}));

vi.mock('./browseSession.js', () => ({
  saveMemoryListSession: (...args: unknown[]) => mockSaveMemoryListSession(...args),
  findMemoryListSessionByMessage: (...args: unknown[]) =>
    mockFindMemoryListSessionByMessage(...args),
  updateMemoryListSessionPage: (...args: unknown[]) => mockUpdateMemoryListSessionPage(...args),
  MEMORY_SEARCH_ENTITY_TYPE: 'memory-search',
}));

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

interface MockDeferredContext {
  interaction: { options: { getString: ReturnType<typeof vi.fn> } };
  user: { id: string };
  editReply: ReturnType<typeof vi.fn>;
}

interface MockButtonInteraction {
  customId: string;
  message: { id: string };
  user: { id: string };
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

function createDeferredContext(query = TEST_QUERY): MockDeferredContext {
  return {
    interaction: {
      options: {
        getString: vi.fn((name: string) =>
          name === 'query' ? query : name === 'personality' ? null : null
        ),
      },
    },
    user: { id: TEST_USER_ID },
    editReply: vi.fn().mockResolvedValue({ id: TEST_MESSAGE_ID, channelId: TEST_CHANNEL_ID }),
  };
}

function createButtonInteraction(customId: string): MockButtonInteraction {
  return {
    customId,
    message: { id: TEST_MESSAGE_ID },
    user: { id: TEST_USER_ID },
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
    mockResolveOptionalPersonality.mockResolvedValue(TEST_PERSONALITY_ID);
    mockCallGatewayApi.mockResolvedValue({ ok: true, data: sampleSemanticResponse });
  });

  it('fetches semantic results and saves a search session', async () => {
    const context = createDeferredContext();

    await handleSearch(context as unknown as DeferredCommandContext);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/memory/search',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({ query: TEST_QUERY, limit: 5, offset: 0 }),
      })
    );
    expect(mockSaveMemoryListSession).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'memory-search',
        data: expect.objectContaining({
          kind: 'search',
          personalityId: TEST_PERSONALITY_ID,
          currentPage: 0,
          searchQuery: TEST_QUERY,
        }),
      })
    );
  });

  it('handles text fallback searches', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { ...sampleSemanticResponse, searchType: 'text' as const },
    });
    const context = createDeferredContext();

    await handleSearch(context as unknown as DeferredCommandContext);

    expect(context.editReply).toHaveBeenCalled();
    expect(mockSaveMemoryListSession).toHaveBeenCalled();
  });

  it('shows error when personality resolution fails', async () => {
    mockResolveOptionalPersonality.mockResolvedValue(null);
    const context = createDeferredContext();

    await handleSearch(context as unknown as DeferredCommandContext);

    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('shows error when API call fails', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: false, error: 'Server error' });
    const context = createDeferredContext();

    await handleSearch(context as unknown as DeferredCommandContext);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Failed') })
    );
    expect(mockSaveMemoryListSession).not.toHaveBeenCalled();
  });

  it('handles unexpected errors', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('network'));
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
  });

  it('re-runs search with new page when session exists', async () => {
    mockFindMemoryListSessionByMessage.mockResolvedValue({
      data: {
        kind: 'search',
        personalityId: TEST_PERSONALITY_ID,
        currentPage: 0,
        searchQuery: TEST_QUERY,
      },
    });
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { ...sampleSemanticResponse, hasMore: true },
    });

    const interaction = createButtonInteraction(searchHelpers.build(1, 'all', 'date', null));

    await handleSearchPagination(interaction as unknown as ButtonInteraction);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/memory/search',
      expect.objectContaining({
        body: expect.objectContaining({ query: TEST_QUERY, offset: 5 }),
      })
    );
    expect(mockUpdateMemoryListSessionPage).toHaveBeenCalledWith(
      expect.objectContaining({ newPage: 1, entityType: 'memory-search' })
    );
  });

  it('shows expired message when session is missing', async () => {
    mockFindMemoryListSessionByMessage.mockResolvedValue(null);
    const interaction = createButtonInteraction(searchHelpers.build(2, 'all', 'date', null));

    await handleSearchPagination(interaction as unknown as ButtonInteraction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('expired') })
    );
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('shows expired message when session kind is browse', async () => {
    mockFindMemoryListSessionByMessage.mockResolvedValue({
      data: { kind: 'browse', personalityId: TEST_PERSONALITY_ID, currentPage: 0 },
    });
    const interaction = createButtonInteraction(searchHelpers.build(1, 'all', 'date', null));

    await handleSearchPagination(interaction as unknown as ButtonInteraction);

    expect(interaction.reply).toHaveBeenCalledWith(
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

  it('delegates to handleMemorySelect with search context from session', async () => {
    mockFindMemoryListSessionByMessage.mockResolvedValue({
      data: {
        kind: 'search',
        personalityId: TEST_PERSONALITY_ID,
        currentPage: 2,
        searchQuery: TEST_QUERY,
      },
    });
    const interaction = createSelectInteraction('memory-detail::select');

    await handleSearchSelect(interaction as unknown as StringSelectMenuInteraction);

    expect(mockHandleMemorySelect).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        source: 'search',
        page: 2,
        personalityId: TEST_PERSONALITY_ID,
        query: TEST_QUERY,
      })
    );
  });

  it('uses defaults when session is missing', async () => {
    mockFindMemoryListSessionByMessage.mockResolvedValue(null);
    const interaction = createSelectInteraction('memory-detail::select');

    await handleSearchSelect(interaction as unknown as StringSelectMenuInteraction);

    expect(mockHandleMemorySelect).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({ source: 'search', page: 0 })
    );
  });
});

describe('refreshSearchList', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('re-fetches and updates message using session state', async () => {
    mockFindMemoryListSessionByMessage.mockResolvedValue({
      data: {
        kind: 'search',
        personalityId: TEST_PERSONALITY_ID,
        currentPage: 1,
        searchQuery: TEST_QUERY,
      },
    });
    mockCallGatewayApi.mockResolvedValue({ ok: true, data: sampleSemanticResponse });

    const interaction = createButtonInteraction('memory-detail::back');

    await refreshSearchList(interaction as unknown as ButtonInteraction);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/memory/search',
      expect.objectContaining({
        body: expect.objectContaining({ query: TEST_QUERY, offset: 5 }),
      })
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
      },
    });
    mockCallGatewayApi
      .mockResolvedValueOnce({ ok: true, data: { results: [], count: 0, hasMore: false } })
      .mockResolvedValueOnce({ ok: true, data: sampleSemanticResponse });

    const interaction = createButtonInteraction('memory-detail::back');

    await refreshSearchList(interaction as unknown as ButtonInteraction);

    expect(mockCallGatewayApi).toHaveBeenCalledTimes(2);
    expect(mockUpdateMemoryListSessionPage).toHaveBeenCalledWith(
      expect.objectContaining({ newPage: 1 })
    );
  });

  it('no-ops when session is missing', async () => {
    mockFindMemoryListSessionByMessage.mockResolvedValue(null);
    const interaction = createButtonInteraction('memory-detail::back');

    await refreshSearchList(interaction as unknown as ButtonInteraction);

    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('no-ops when session kind is browse', async () => {
    mockFindMemoryListSessionByMessage.mockResolvedValue({
      data: { kind: 'browse', personalityId: TEST_PERSONALITY_ID, currentPage: 0 },
    });
    const interaction = createButtonInteraction('memory-detail::back');

    await refreshSearchList(interaction as unknown as ButtonInteraction);

    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('no-ops when session has no searchQuery', async () => {
    mockFindMemoryListSessionByMessage.mockResolvedValue({
      data: { kind: 'search', currentPage: 0 }, // Missing searchQuery
    });
    const interaction = createButtonInteraction('memory-detail::back');

    await refreshSearchList(interaction as unknown as ButtonInteraction);

    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });
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

  it('recognizes search select menus', () => {
    expect(isMemorySearchPagination(searchHelpers.buildSelect(0, 'all', 'date', null))).toBe(true);
  });

  it('rejects unrelated custom IDs', () => {
    expect(isMemorySearchPagination('memory-browse::browse::0::all::')).toBe(false);
    expect(isMemorySearchPagination('memory-detail::edit::mem-1')).toBe(false);
  });
});
