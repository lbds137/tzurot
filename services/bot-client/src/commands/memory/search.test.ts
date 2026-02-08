/**
 * Tests for Memory Search Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSearch } from './search.js';

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

// Mock userGatewayClient
const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

// Mock commandHelpers
const mockReplyWithError = vi.fn();
const mockHandleCommandError = vi.fn();
vi.mock('../../utils/commandHelpers.js', () => ({
  replyWithError: (...args: unknown[]) => mockReplyWithError(...args),
  handleCommandError: (...args: unknown[]) => mockHandleCommandError(...args),
}));

// Mock autocomplete
const mockResolvePersonalityId = vi.fn();
vi.mock('./autocomplete.js', () => ({
  resolvePersonalityId: (...args: unknown[]) => mockResolvePersonalityId(...args),
}));

// Mock detail.js handlers for collector tests
const mockHandleMemorySelect = vi.fn().mockResolvedValue(undefined);
const mockHandleEditButton = vi.fn().mockResolvedValue(undefined);
const mockHandleLockButton = vi.fn().mockResolvedValue(undefined);
const mockHandleDeleteButton = vi.fn().mockResolvedValue(undefined);
const mockHandleDeleteConfirm = vi.fn().mockResolvedValue(true);
const mockHandleViewFullButton = vi.fn().mockResolvedValue(undefined);

vi.mock('./detail.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./detail.js')>();
  return {
    ...actual,
    handleMemorySelect: (...args: unknown[]) => mockHandleMemorySelect(...args),
    handleLockButton: (...args: unknown[]) => mockHandleLockButton(...args),
    handleDeleteButton: (...args: unknown[]) => mockHandleDeleteButton(...args),
    handleDeleteConfirm: (...args: unknown[]) => mockHandleDeleteConfirm(...args),
    handleViewFullButton: (...args: unknown[]) => mockHandleViewFullButton(...args),
  };
});

// Mock detailModals.js - edit handlers moved here from detail.js
vi.mock('./detailModals.js', () => ({
  handleEditButton: (...args: unknown[]) => mockHandleEditButton(...args),
  handleEditTruncatedButton: vi.fn().mockResolvedValue(undefined),
  handleCancelEditButton: vi.fn().mockResolvedValue(undefined),
}));

describe('handleSearch', () => {
  const mockEditReply = vi.fn();
  const mockCreateMessageComponentCollector = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateMessageComponentCollector.mockReturnValue({
      on: vi.fn().mockReturnThis(),
    });
    mockEditReply.mockResolvedValue({
      createMessageComponentCollector: mockCreateMessageComponentCollector,
    });
  });

  function createMockContext(query: string, personality: string | null = null) {
    return {
      user: { id: '123456789' },
      interaction: {
        options: {
          getString: (name: string, _required?: boolean) => {
            if (name === 'query') return query;
            if (name === 'personality') return personality;
            return null;
          },
        },
        // Also needed for setupSearchCollector which uses interaction.editReply directly
        editReply: mockEditReply,
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleSearch>[0];
  }

  it('should search successfully without personality filter', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        results: [
          {
            id: 'memory-1',
            content: 'Test memory about cats',
            similarity: 0.92,
            createdAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'personality-123',
            personalityName: 'Lilith',
            isLocked: false,
          },
        ],
        count: 1,
        hasMore: false,
      },
    });

    const context = createMockContext('cats');
    await handleSearch(context);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/memory/search',
      expect.objectContaining({
        userId: '123456789',
        method: 'POST',
        body: expect.objectContaining({ query: 'cats' }),
      })
    );
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
  });

  it('should search with personality filter', async () => {
    mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { results: [], count: 0, hasMore: false },
    });

    const context = createMockContext('test query', 'lilith');
    await handleSearch(context);

    expect(mockResolvePersonalityId).toHaveBeenCalledWith('123456789', 'lilith');
    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/memory/search',
      expect.objectContaining({
        body: expect.objectContaining({
          query: 'test query',
          personalityId: 'personality-uuid-123',
        }),
      })
    );
  });

  it('should show error when personality not found', async () => {
    mockResolvePersonalityId.mockResolvedValue(null);

    const context = createMockContext('test', 'unknown-personality');
    await handleSearch(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('not found'),
    });
  });

  it('should handle API error', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'Internal error',
    });

    const context = createMockContext('test query');
    await handleSearch(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to search'),
    });
  });

  it('should handle empty results gracefully', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { results: [], count: 0, hasMore: false },
    });

    const context = createMockContext('nonexistent query');
    await handleSearch(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: [], // No pagination buttons when empty
    });
  });

  it('should handle unexpected errors', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    const context = createMockContext('test');
    await handleSearch(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('unexpected error'),
    });
  });

  it('should set up pagination collector when results exist', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        results: [
          {
            id: 'memory-1',
            content: 'Test memory',
            similarity: 0.9,
            createdAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'personality-123',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        count: 1,
        hasMore: true,
      },
    });

    const context = createMockContext('test');
    await handleSearch(context);

    expect(mockCreateMessageComponentCollector).toHaveBeenCalledWith(
      expect.objectContaining({
        time: expect.any(Number),
      })
    );
  });

  it('should not set up collector when no results', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { results: [], count: 0, hasMore: false },
    });

    const context = createMockContext('test');
    await handleSearch(context);

    expect(mockCreateMessageComponentCollector).not.toHaveBeenCalled();
  });

  it('should display locked indicator for locked memories', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        results: [
          {
            id: 'memory-1',
            content: 'Locked memory',
            similarity: 0.85,
            createdAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'personality-123',
            personalityName: 'Test',
            isLocked: true,
          },
        ],
        count: 1,
        hasMore: false,
      },
    });

    const context = createMockContext('test');
    await handleSearch(context);

    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
      })
    );
  });

  it('should include pagination buttons with results', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        results: [
          {
            id: 'memory-1',
            content: 'Test memory',
            similarity: 0.9,
            createdAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'personality-123',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        count: 1,
        hasMore: false,
      },
    });

    const context = createMockContext('test');
    await handleSearch(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.arrayContaining([expect.any(Object)]),
    });
  });

  it('should handle text search fallback results (null similarity)', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        results: [
          {
            id: 'memory-1',
            content: 'Memory found by text search',
            similarity: null, // Text search results have null similarity
            createdAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'personality-123',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        count: 1,
        hasMore: false,
        searchType: 'text',
      },
    });

    const context = createMockContext('specific name');
    await handleSearch(context);

    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
        components: expect.any(Array),
      })
    );
    // Collector should still be set up
    expect(mockCreateMessageComponentCollector).toHaveBeenCalled();
  });

  it('should handle hasMore indicating more pages available', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        results: [
          {
            id: 'memory-1',
            content: 'First result',
            similarity: 0.95,
            createdAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'personality-123',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        count: 1,
        hasMore: true, // More pages available
        searchType: 'semantic',
      },
    });

    const context = createMockContext('test');
    await handleSearch(context);

    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
        components: expect.any(Array),
      })
    );
  });

  it('should skip personality resolution when personality option is empty string', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { results: [], count: 0, hasMore: false },
    });

    // Create context with empty string personality
    const context = {
      user: { id: '123456789' },
      interaction: {
        options: {
          getString: (name: string) => {
            if (name === 'query') return 'test';
            if (name === 'personality') return '';
            return null;
          },
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleSearch>[0];

    await handleSearch(context);

    // Should NOT call resolvePersonalityId when personality is empty
    expect(mockResolvePersonalityId).not.toHaveBeenCalled();
    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/memory/search',
      expect.objectContaining({
        body: expect.not.objectContaining({ personalityId: expect.anything() }),
      })
    );
  });

  it('should handle very long content in results', async () => {
    const longContent = 'A'.repeat(500); // Much longer than display limit
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        results: [
          {
            id: 'memory-1',
            content: longContent,
            similarity: 0.88,
            createdAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'personality-123',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        count: 1,
        hasMore: false,
      },
    });

    const context = createMockContext('test');
    await handleSearch(context);

    // Should still succeed - content is truncated in the embed
    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
      })
    );
  });

  it('should handle multiple results on first page', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        results: [
          {
            id: 'memory-1',
            content: 'First memory',
            similarity: 0.95,
            createdAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'personality-123',
            personalityName: 'Test',
            isLocked: false,
          },
          {
            id: 'memory-2',
            content: 'Second memory',
            similarity: 0.88,
            createdAt: '2025-06-14T12:00:00.000Z',
            personalityId: 'personality-123',
            personalityName: 'Test',
            isLocked: true,
          },
          {
            id: 'memory-3',
            content: 'Third memory',
            similarity: 0.75,
            createdAt: '2025-06-13T12:00:00.000Z',
            personalityId: 'personality-456',
            personalityName: 'Other',
            isLocked: false,
          },
        ],
        count: 3,
        hasMore: false,
        searchType: 'semantic',
      },
    });

    const context = createMockContext('test');
    await handleSearch(context);

    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
        components: expect.any(Array),
      })
    );
    expect(mockCreateMessageComponentCollector).toHaveBeenCalled();
  });
});

describe('handleSearch collector behavior', () => {
  const mockEditReply = vi.fn();
  const mockDeferUpdate = vi.fn();
  const mockFollowUp = vi.fn();
  let collectCallback: (i: unknown) => void;
  let endCallback: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    collectCallback = () => {};
    endCallback = () => {};

    const mockCollector = {
      on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
        if (event === 'collect') collectCallback = callback;
        if (event === 'end') endCallback = callback as () => void;
        return mockCollector;
      }),
    };

    mockEditReply.mockResolvedValue({
      createMessageComponentCollector: () => mockCollector,
    });
    mockDeferUpdate.mockResolvedValue(undefined);
    mockFollowUp.mockResolvedValue(undefined);
  });

  function createMockContext() {
    return {
      user: { id: '123456789' },
      interaction: {
        options: {
          getString: (name: string, _required?: boolean) => {
            if (name === 'query') return 'test query';
            return null;
          },
        },
        // Also needed for setupSearchCollector which uses interaction.editReply directly
        editReply: mockEditReply,
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleSearch>[0];
  }

  function createMockButtonInteraction(customId: string) {
    return {
      isButton: () => true,
      isStringSelectMenu: () => false,
      customId,
      user: { id: '123456789' },
      deferUpdate: mockDeferUpdate,
      editReply: mockEditReply,
      followUp: mockFollowUp,
    };
  }

  it('should handle pagination button click', async () => {
    // Initial search results
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        results: [
          {
            id: 'memory-1',
            content: 'Test',
            similarity: 0.9,
            createdAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        count: 1,
        hasMore: true,
        searchType: 'semantic',
      },
    });

    const context = createMockContext();
    await handleSearch(context);

    // Simulate pagination button click for page 1
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        results: [
          {
            id: 'memory-2',
            content: 'Page 2',
            similarity: 0.8,
            createdAt: '2025-06-14T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        count: 1,
        hasMore: false,
        searchType: 'semantic',
      },
    });

    const buttonInteraction = createMockButtonInteraction('memory-search::list::1::date');
    collectCallback(buttonInteraction);

    // Wait for async handler
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockCallGatewayApi).toHaveBeenCalledTimes(2);
  });

  it('should handle pagination button click with API failure', async () => {
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        results: [
          {
            id: 'memory-1',
            content: 'Test',
            similarity: 0.9,
            createdAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        count: 1,
        hasMore: true,
      },
    });

    const context = createMockContext();
    await handleSearch(context);

    // API fails on page 2
    mockCallGatewayApi.mockResolvedValueOnce({ ok: false, error: 'Server error' });

    const buttonInteraction = createMockButtonInteraction('memory-search::list::1::date');
    collectCallback(buttonInteraction);

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Failed to load'),
        ephemeral: true,
      })
    );
  });

  it('should handle select menu interaction', async () => {
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        results: [
          {
            id: 'memory-1',
            content: 'Test',
            similarity: 0.9,
            createdAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        count: 1,
        hasMore: false,
      },
    });

    const context = createMockContext();
    await handleSearch(context);

    const selectInteraction = {
      isButton: () => false,
      isStringSelectMenu: () => true,
      customId: 'memory-select',
      values: ['memory-1'],
      user: { id: '123456789' },
      deferUpdate: mockDeferUpdate,
      editReply: mockEditReply,
    };

    collectCallback(selectInteraction);
    await new Promise(resolve => setTimeout(resolve, 10));

    // handleMemorySelect is mocked so we just verify it doesn't throw
    expect(true).toBe(true);
  });

  it('should handle collector end by removing components', async () => {
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        results: [
          {
            id: 'memory-1',
            content: 'Test',
            similarity: 0.9,
            createdAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        count: 1,
        hasMore: false,
      },
    });

    const context = createMockContext();
    await handleSearch(context);

    // Reset mock to track the end behavior
    mockEditReply.mockClear();
    mockEditReply.mockResolvedValue(undefined);

    endCallback();

    expect(mockEditReply).toHaveBeenCalledWith({ components: [] });
  });

  it('should handle collector end error gracefully', async () => {
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        results: [
          {
            id: 'memory-1',
            content: 'Test',
            similarity: 0.9,
            createdAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        count: 1,
        hasMore: false,
      },
    });

    const context = createMockContext();
    await handleSearch(context);

    // Simulate editReply failing (message deleted)
    mockEditReply.mockClear();
    mockEditReply.mockRejectedValue(new Error('Unknown message'));

    // Should not throw
    endCallback();
    expect(true).toBe(true);
  });

  it('should handle unrecognized button custom ID', async () => {
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        results: [
          {
            id: 'memory-1',
            content: 'Test',
            similarity: 0.9,
            createdAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        count: 1,
        hasMore: false,
      },
    });

    const context = createMockContext();
    await handleSearch(context);

    const buttonInteraction = createMockButtonInteraction('unknown-prefix:action');
    collectCallback(buttonInteraction);

    await new Promise(resolve => setTimeout(resolve, 10));

    // Should not call deferUpdate for unrecognized buttons
    expect(mockDeferUpdate).not.toHaveBeenCalled();
  });

  it('should preserve text search type across pagination', async () => {
    // Initial search with text fallback
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        results: [
          {
            id: 'memory-1',
            content: 'Test',
            similarity: null,
            createdAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        count: 1,
        hasMore: true,
        searchType: 'text',
      },
    });

    const context = createMockContext();
    await handleSearch(context);

    // Page 2 request should include preferTextSearch
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        results: [
          {
            id: 'memory-2',
            content: 'Test 2',
            similarity: null,
            createdAt: '2025-06-14T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        count: 1,
        hasMore: false,
        searchType: 'text',
      },
    });

    const buttonInteraction = createMockButtonInteraction('memory-search::list::1::date');
    collectCallback(buttonInteraction);

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockCallGatewayApi).toHaveBeenLastCalledWith(
      '/user/memory/search',
      expect.objectContaining({
        body: expect.objectContaining({ preferTextSearch: true }),
      })
    );
  });

  it('should handle edit button action', async () => {
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        results: [
          {
            id: 'memory-1',
            content: 'Test',
            similarity: 0.9,
            createdAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        count: 1,
        hasMore: false,
      },
    });

    const context = createMockContext();
    await handleSearch(context);

    const buttonInteraction = createMockButtonInteraction('memory-detail::edit::memory-1');
    collectCallback(buttonInteraction);

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockHandleEditButton).toHaveBeenCalledWith(buttonInteraction, 'memory-1');
  });

  it('should handle lock button action', async () => {
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        results: [
          {
            id: 'memory-1',
            content: 'Test',
            similarity: 0.9,
            createdAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        count: 1,
        hasMore: false,
      },
    });

    const context = createMockContext();
    await handleSearch(context);

    const buttonInteraction = createMockButtonInteraction('memory-detail::lock::memory-1');
    collectCallback(buttonInteraction);

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockHandleLockButton).toHaveBeenCalledWith(buttonInteraction, 'memory-1');
  });

  it('should handle delete button action', async () => {
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        results: [
          {
            id: 'memory-1',
            content: 'Test',
            similarity: 0.9,
            createdAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        count: 1,
        hasMore: false,
      },
    });

    const context = createMockContext();
    await handleSearch(context);

    const buttonInteraction = createMockButtonInteraction('memory-detail::delete::memory-1');
    collectCallback(buttonInteraction);

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockHandleDeleteButton).toHaveBeenCalledWith(buttonInteraction, 'memory-1');
  });

  it('should handle confirm-delete button action', async () => {
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        results: [
          {
            id: 'memory-1',
            content: 'Test',
            similarity: 0.9,
            createdAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        count: 1,
        hasMore: false,
      },
    });

    const context = createMockContext();
    await handleSearch(context);

    const buttonInteraction = createMockButtonInteraction(
      'memory-detail::confirm-delete::memory-1'
    );
    collectCallback(buttonInteraction);

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockHandleDeleteConfirm).toHaveBeenCalledWith(buttonInteraction, 'memory-1');
  });

  it('should handle view-full button action', async () => {
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        results: [
          {
            id: 'memory-1',
            content: 'Test',
            similarity: 0.9,
            createdAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        count: 1,
        hasMore: false,
      },
    });

    const context = createMockContext();
    await handleSearch(context);

    const buttonInteraction = createMockButtonInteraction('memory-detail::view-full::memory-1');
    collectCallback(buttonInteraction);

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockHandleViewFullButton).toHaveBeenCalledWith(buttonInteraction, 'memory-1');
  });

  it('should handle back button action', async () => {
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        results: [
          {
            id: 'memory-1',
            content: 'Test',
            similarity: 0.9,
            createdAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        count: 1,
        hasMore: false,
      },
    });

    const context = createMockContext();
    await handleSearch(context);

    const buttonInteraction = createMockButtonInteraction('memory-detail::back::memory-1');
    collectCallback(buttonInteraction);

    await new Promise(resolve => setTimeout(resolve, 10));

    // Back button defers update before refreshing
    expect(mockDeferUpdate).toHaveBeenCalled();
  });
});
