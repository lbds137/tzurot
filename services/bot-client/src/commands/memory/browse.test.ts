/**
 * Tests for memory browse handler.
 *
 * Covers:
 * - handleBrowse: fetches first page, saves session, builds embed + components
 * - handleBrowsePagination: reads session, fetches page, updates message
 * - handleBrowseSelect: delegates to detail view with list context
 * - refreshBrowseList: handles empty-page-after-delete edge case
 * - handleBrowseDetailAction: delegates to detail router with refresh callback
 * - isMemoryBrowsePagination: custom ID guard
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockCallGatewayApi,
  mockResolveOptionalPersonality,
  mockHandleMemorySelect,
  mockHandleMemoryDetailAction,
  mockSaveMemoryListSession,
  mockFindMemoryListSessionByMessage,
  mockUpdateMemoryListSessionPage,
} = vi.hoisted(() => ({
  mockCallGatewayApi: vi.fn(),
  mockResolveOptionalPersonality: vi.fn(),
  mockHandleMemorySelect: vi.fn(),
  mockHandleMemoryDetailAction: vi.fn(),
  mockSaveMemoryListSession: vi.fn(),
  mockFindMemoryListSessionByMessage: vi.fn(),
  mockUpdateMemoryListSessionPage: vi.fn(),
}));

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    memoryBrowseOptions: (interaction: { options?: { getString: (name: string) => string } }) => ({
      personality: () => interaction.options?.getString('personality') ?? null,
    }),
    formatDateShort: (d: string | Date) => String(d),
  };
});

vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
  toGatewayUser: (user: { id?: string; username?: string; globalName?: string | null }) => ({
    discordId: user.id ?? 'test-user-id',
    username: user.username ?? 'testuser',
    displayName: user.globalName ?? user.username ?? 'testuser',
  }),
}));

vi.mock('./resolveHelpers.js', () => ({
  resolveOptionalPersonality: (...args: unknown[]) => mockResolveOptionalPersonality(...args),
}));

vi.mock('./detail.js', () => ({
  // buildMemoryActionId is a pure string-builder used by browse.ts to
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
    MEMORY_BROWSE_ENTITY_TYPE: 'memory-browse',
  };
});

import {
  handleBrowse,
  handleBrowsePagination,
  handleBrowseSelect,
  handleBrowseDetailAction,
  refreshBrowseList,
  isMemoryBrowsePagination,
  browseHelpers,
} from './browse.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';

// Test fixtures
const TEST_USER_ID = 'user-123';
const TEST_MESSAGE_ID = 'msg-456';
const TEST_CHANNEL_ID = 'ch-789';
const TEST_PERSONALITY_ID = '00000000-0000-0000-0000-000000000001';

const sampleMemory = {
  id: 'mem-1',
  content: 'Test memory content',
  personalityName: 'Test Personality',
  isLocked: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const sampleResponse = {
  memories: [sampleMemory],
  total: 1,
  limit: 10,
  offset: 0,
  hasMore: false,
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

function createDeferredContext(): MockDeferredContext {
  return {
    interaction: {
      options: {
        getString: vi.fn((name: string) => (name === 'personality' ? null : null)),
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

describe('handleBrowse', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockResolveOptionalPersonality.mockResolvedValue(TEST_PERSONALITY_ID);
    mockCallGatewayApi.mockResolvedValue({ ok: true, data: sampleResponse });
  });

  it('fetches memories and saves a browse session', async () => {
    const context = createDeferredContext();

    await handleBrowse(context as unknown as DeferredCommandContext);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      expect.stringContaining('/user/memory/list'),
      expect.objectContaining({
        method: 'GET',
        user: expect.objectContaining({ discordId: TEST_USER_ID }),
      })
    );
    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array), components: expect.any(Array) })
    );
    expect(mockSaveMemoryListSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: TEST_USER_ID,
        messageId: TEST_MESSAGE_ID,
        data: expect.objectContaining({
          kind: 'browse',
          personalityId: TEST_PERSONALITY_ID,
          currentPage: 0,
        }),
      })
    );
  });

  it('aborts early when personality resolution returns null (helper handles the error reply)', async () => {
    // resolveOptionalPersonality is contracted to reply with the error itself
    // when it returns null, so handleBrowse just returns without calling editReply
    mockResolveOptionalPersonality.mockResolvedValue(null);
    const context = createDeferredContext();

    await handleBrowse(context as unknown as DeferredCommandContext);

    expect(mockCallGatewayApi).not.toHaveBeenCalled();
    expect(mockSaveMemoryListSession).not.toHaveBeenCalled();
    // handleBrowse should NOT double-reply — the helper already did
    expect(context.editReply).not.toHaveBeenCalled();
  });

  it('shows error when API call fails', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: false, error: 'Server error' });
    const context = createDeferredContext();

    await handleBrowse(context as unknown as DeferredCommandContext);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Failed to load') })
    );
    expect(mockSaveMemoryListSession).not.toHaveBeenCalled();
  });

  it('handles unexpected errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('network'));
    const context = createDeferredContext();

    await handleBrowse(context as unknown as DeferredCommandContext);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('unexpected error') })
    );
  });
});

describe('handleBrowsePagination', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('fetches new page and updates message when session exists', async () => {
    mockFindMemoryListSessionByMessage.mockResolvedValue({
      data: { kind: 'browse', personalityId: TEST_PERSONALITY_ID, currentPage: 0 },
    });
    // Need a large enough total for page 1 to be valid (itemsPerPage=10)
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { memories: [sampleMemory], total: 25, limit: 10, offset: 10, hasMore: true },
    });

    const customId = browseHelpers.build(1, 'all', 'date', null);
    const interaction = createButtonInteraction(customId);

    await handleBrowsePagination(interaction as unknown as ButtonInteraction);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      expect.stringContaining('offset=10'),
      expect.any(Object)
    );
    expect(interaction.editReply).toHaveBeenCalled();
    expect(mockUpdateMemoryListSessionPage).toHaveBeenCalledWith(
      expect.objectContaining({ newPage: 1, kind: 'browse' })
    );
  });

  it('defers immediately and shows expired message via followUp when session is missing', async () => {
    mockFindMemoryListSessionByMessage.mockResolvedValue(null);
    const interaction = createButtonInteraction(browseHelpers.build(2, 'all', 'date', null));

    await handleBrowsePagination(interaction as unknown as ButtonInteraction);

    // Acknowledgment must happen BEFORE session lookup so we stay inside
    // Discord's 3-second interaction window regardless of Redis latency.
    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('expired') })
    );
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('ignores interactions with non-browse custom IDs', async () => {
    const interaction = createButtonInteraction('other::foo');

    await handleBrowsePagination(interaction as unknown as ButtonInteraction);

    expect(mockFindMemoryListSessionByMessage).not.toHaveBeenCalled();
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('does not update session when session kind is search', async () => {
    mockFindMemoryListSessionByMessage.mockResolvedValue({
      data: { kind: 'search', personalityId: TEST_PERSONALITY_ID, currentPage: 0 },
    });
    const interaction = createButtonInteraction(browseHelpers.build(1, 'all', 'date', null));

    await handleBrowsePagination(interaction as unknown as ButtonInteraction);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('expired') })
    );
  });
});

describe('handleBrowseSelect', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('forwards to handleMemorySelect without any session lookup', async () => {
    // Post-migration, handleBrowseSelect is a thin pass-through. No session
    // lookup happens — back navigation from the detail view reads the session
    // via messageId inside refreshBrowseList. Thinning this wrapper removed
    // a dead Redis call that previously ran before deferUpdate (violating
    // the 3-second rule added in 04-discord.md).
    const interaction = createSelectInteraction('memory-detail::select');

    await handleBrowseSelect(interaction as unknown as StringSelectMenuInteraction);

    expect(mockFindMemoryListSessionByMessage).not.toHaveBeenCalled();
    expect(mockHandleMemorySelect).toHaveBeenCalledWith(interaction);
    // handleMemorySelect is called with exactly one argument now — no context.
    expect(mockHandleMemorySelect).toHaveBeenCalledTimes(1);
    const [, ...extras] = mockHandleMemorySelect.mock.calls[0] as [unknown, ...unknown[]];
    expect(extras).toEqual([]);
  });
});

describe('refreshBrowseList', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('re-fetches and updates message on refresh', async () => {
    mockFindMemoryListSessionByMessage.mockResolvedValue({
      data: { kind: 'browse', personalityId: TEST_PERSONALITY_ID, currentPage: 1 },
    });
    mockCallGatewayApi.mockResolvedValue({ ok: true, data: sampleResponse });

    const interaction = createButtonInteraction('memory-detail::back');

    await refreshBrowseList(interaction as unknown as ButtonInteraction);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      expect.stringContaining('offset=10'),
      expect.any(Object)
    );
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it('steps back one page when current page is empty after delete', async () => {
    mockFindMemoryListSessionByMessage.mockResolvedValue({
      data: { kind: 'browse', personalityId: TEST_PERSONALITY_ID, currentPage: 2 },
    });
    mockCallGatewayApi
      .mockResolvedValueOnce({
        ok: true,
        data: { memories: [], total: 0, limit: 10, offset: 20, hasMore: false },
      })
      .mockResolvedValueOnce({ ok: true, data: sampleResponse });

    const interaction = createButtonInteraction('memory-detail::back');

    await refreshBrowseList(interaction as unknown as ButtonInteraction);

    expect(mockCallGatewayApi).toHaveBeenCalledTimes(2);
    expect(mockUpdateMemoryListSessionPage).toHaveBeenCalledWith(
      expect.objectContaining({ newPage: 1 })
    );
  });

  it('no-ops when session is missing', async () => {
    mockFindMemoryListSessionByMessage.mockResolvedValue(null);
    const interaction = createButtonInteraction('memory-detail::back');

    await refreshBrowseList(interaction as unknown as ButtonInteraction);

    expect(mockCallGatewayApi).not.toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('no-ops when session kind is search', async () => {
    mockFindMemoryListSessionByMessage.mockResolvedValue({
      data: { kind: 'search', currentPage: 0, searchQuery: 'x' },
    });
    const interaction = createButtonInteraction('memory-detail::back');

    await refreshBrowseList(interaction as unknown as ButtonInteraction);

    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });
});

describe('handleBrowseDetailAction', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('delegates to handleMemoryDetailAction with a refresh callback', async () => {
    mockHandleMemoryDetailAction.mockResolvedValue(true);
    const interaction = createButtonInteraction('memory-detail::lock::mem-1');

    const handled = await handleBrowseDetailAction(interaction as unknown as ButtonInteraction);

    expect(handled).toBe(true);
    expect(mockHandleMemoryDetailAction).toHaveBeenCalledWith(interaction, expect.any(Function));
  });

  it('returns false when detail router does not handle the action', async () => {
    mockHandleMemoryDetailAction.mockResolvedValue(false);
    const interaction = createButtonInteraction('unrelated::action');

    const handled = await handleBrowseDetailAction(interaction as unknown as ButtonInteraction);

    expect(handled).toBe(false);
  });
});

describe('isMemoryBrowsePagination', () => {
  it('recognizes browse pagination buttons', () => {
    expect(isMemoryBrowsePagination(browseHelpers.build(0, 'all', 'date', null))).toBe(true);
  });

  it('deliberately does NOT match browse select menus', () => {
    // Selects are routed via handleSelectMenu using browseHelpers.isBrowseSelect
    // directly. handleButton should never claim select customIds, so this
    // guard intentionally returns false for them — keeps the name honest.
    expect(isMemoryBrowsePagination(browseHelpers.buildSelect(0, 'all', 'date', null))).toBe(false);
  });

  it('rejects unrelated custom IDs', () => {
    expect(isMemoryBrowsePagination('memory-detail::edit::mem-1')).toBe(false);
    expect(isMemoryBrowsePagination('memory-search::browse::0::all::')).toBe(false);
  });
});
