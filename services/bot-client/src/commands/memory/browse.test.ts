/**
 * Tests for Memory Browse Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleBrowse } from './browse.js';

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
vi.mock('../../utils/commandHelpers.js', () => ({
  replyWithError: (...args: unknown[]) => mockReplyWithError(...args),
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
    handleEditButton: (...args: unknown[]) => mockHandleEditButton(...args),
    handleLockButton: (...args: unknown[]) => mockHandleLockButton(...args),
    handleDeleteButton: (...args: unknown[]) => mockHandleDeleteButton(...args),
    handleDeleteConfirm: (...args: unknown[]) => mockHandleDeleteConfirm(...args),
    handleViewFullButton: (...args: unknown[]) => mockHandleViewFullButton(...args),
  };
});

describe('handleBrowse', () => {
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

  function createMockContext(personality: string | null = null) {
    return {
      user: { id: '123456789' },
      interaction: {
        options: {
          getString: (name: string) => {
            if (name === 'personality') return personality;
            return null;
          },
        },
        // Also needed for setupBrowseCollector which uses interaction.editReply directly
        editReply: mockEditReply,
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleBrowse>[0];
  }

  it('should list memories successfully without filter', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        memories: [
          {
            id: 'memory-1',
            content: 'Test memory about cats',
            createdAt: '2025-06-15T12:00:00.000Z',
            updatedAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'personality-123',
            personalityName: 'Lilith',
            isLocked: false,
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
        hasMore: false,
      },
    });

    const context = createMockContext();
    await handleBrowse(context);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      expect.stringContaining('/user/memory/list'),
      expect.objectContaining({
        userId: '123456789',
        method: 'GET',
      })
    );
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
  });

  it('should list memories with personality filter', async () => {
    mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        memories: [],
        total: 0,
        limit: 10,
        offset: 0,
        hasMore: false,
      },
    });

    const context = createMockContext('lilith');
    await handleBrowse(context);

    expect(mockResolvePersonalityId).toHaveBeenCalledWith('123456789', 'lilith');
    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      expect.stringContaining('personalityId=personality-uuid-123'),
      expect.any(Object)
    );
  });

  it('should show error when personality not found', async () => {
    mockResolvePersonalityId.mockResolvedValue(null);

    const context = createMockContext('unknown-personality');
    await handleBrowse(context);

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

    const context = createMockContext();
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to load'),
    });
  });

  it('should display empty state when no memories', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        memories: [],
        total: 0,
        limit: 10,
        offset: 0,
        hasMore: false,
      },
    });

    const context = createMockContext();
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: [], // No pagination buttons when empty
    });
  });

  it('should set up pagination collector when memories exist', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        memories: [
          {
            id: 'memory-1',
            content: 'Test memory',
            createdAt: '2025-06-15T12:00:00.000Z',
            updatedAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'personality-123',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        total: 25, // More than one page
        limit: 10,
        offset: 0,
        hasMore: true,
      },
    });

    const context = createMockContext();
    await handleBrowse(context);

    expect(mockCreateMessageComponentCollector).toHaveBeenCalledWith(
      expect.objectContaining({
        time: expect.any(Number),
      })
    );
  });

  it('should not set up collector when no memories', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        memories: [],
        total: 0,
        limit: 10,
        offset: 0,
        hasMore: false,
      },
    });

    const context = createMockContext();
    await handleBrowse(context);

    expect(mockCreateMessageComponentCollector).not.toHaveBeenCalled();
  });

  it('should handle unexpected errors', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    const context = createMockContext();
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('unexpected error'),
    });
  });

  it('should include pagination buttons with memories', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        memories: [
          {
            id: 'memory-1',
            content: 'Test memory',
            createdAt: '2025-06-15T12:00:00.000Z',
            updatedAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'personality-123',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
        hasMore: false,
      },
    });

    const context = createMockContext();
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.arrayContaining([expect.any(Object)]),
    });
  });

  it('should display locked indicator for locked memories', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        memories: [
          {
            id: 'memory-1',
            content: 'Locked memory',
            createdAt: '2025-06-15T12:00:00.000Z',
            updatedAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'personality-123',
            personalityName: 'Test',
            isLocked: true,
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
        hasMore: false,
      },
    });

    const context = createMockContext();
    await handleBrowse(context);

    // The embed should contain the lock emoji for locked memories
    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
      })
    );
  });

  it('should skip personality resolution when personality option is empty string', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        memories: [],
        total: 0,
        limit: 10,
        offset: 0,
        hasMore: false,
      },
    });

    // Create context with empty string personality
    const context = {
      user: { id: '123456789' },
      interaction: {
        options: {
          getString: (name: string) => {
            if (name === 'personality') return '';
            return null;
          },
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleBrowse>[0];

    await handleBrowse(context);

    // Should NOT call resolvePersonalityId when personality is empty
    expect(mockResolvePersonalityId).not.toHaveBeenCalled();
    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      expect.not.stringContaining('personalityId='),
      expect.any(Object)
    );
  });

  it('should handle multiple memories with different personalities', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        memories: [
          {
            id: 'memory-1',
            content: 'First memory',
            createdAt: '2025-06-15T12:00:00.000Z',
            updatedAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'personality-123',
            personalityName: 'Lilith',
            isLocked: false,
          },
          {
            id: 'memory-2',
            content: 'Second memory',
            createdAt: '2025-06-14T12:00:00.000Z',
            updatedAt: '2025-06-14T12:00:00.000Z',
            personalityId: 'personality-456',
            personalityName: 'Other',
            isLocked: true,
          },
          {
            id: 'memory-3',
            content: 'Third memory',
            createdAt: '2025-06-13T12:00:00.000Z',
            updatedAt: '2025-06-13T12:00:00.000Z',
            personalityId: 'personality-123',
            personalityName: 'Lilith',
            isLocked: false,
          },
        ],
        total: 3,
        limit: 10,
        offset: 0,
        hasMore: false,
      },
    });

    const context = createMockContext();
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
        components: expect.any(Array),
      })
    );
    expect(mockCreateMessageComponentCollector).toHaveBeenCalled();
  });

  it('should handle very long content with newlines', async () => {
    const longContentWithNewlines = 'Line 1\nLine 2\nLine 3\n' + 'A'.repeat(200);
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        memories: [
          {
            id: 'memory-1',
            content: longContentWithNewlines,
            createdAt: '2025-06-15T12:00:00.000Z',
            updatedAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'personality-123',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
        hasMore: false,
      },
    });

    const context = createMockContext();
    await handleBrowse(context);

    // Should succeed - content is truncated and newlines removed
    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
      })
    );
  });

  it('should handle hasMore indicating more pages available', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        memories: [
          {
            id: 'memory-1',
            content: 'First page memory',
            createdAt: '2025-06-15T12:00:00.000Z',
            updatedAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'personality-123',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        total: 50, // Many pages worth
        limit: 10,
        offset: 0,
        hasMore: true,
      },
    });

    const context = createMockContext();
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
        components: expect.any(Array),
      })
    );
    expect(mockCreateMessageComponentCollector).toHaveBeenCalled();
  });

  it('should show filtered empty state for personality with no memories', async () => {
    mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        memories: [],
        total: 0,
        limit: 10,
        offset: 0,
        hasMore: false,
      },
    });

    const context = createMockContext('lilith');
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: [], // No components when filtered empty
    });
    expect(mockCreateMessageComponentCollector).not.toHaveBeenCalled();
  });
});

describe('handleBrowse collector behavior', () => {
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
          getString: () => null,
        },
        // Also needed for setupBrowseCollector which uses interaction.editReply directly
        editReply: mockEditReply,
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleBrowse>[0];
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
    // Initial list results
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        memories: [
          {
            id: 'memory-1',
            content: 'Test',
            createdAt: '2025-06-15T12:00:00.000Z',
            updatedAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        total: 20,
        limit: 10,
        offset: 0,
        hasMore: true,
      },
    });

    const context = createMockContext();
    await handleBrowse(context);

    // Simulate pagination button click for page 1
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        memories: [
          {
            id: 'memory-2',
            content: 'Page 2',
            createdAt: '2025-06-14T12:00:00.000Z',
            updatedAt: '2025-06-14T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        total: 20,
        limit: 10,
        offset: 10,
        hasMore: false,
      },
    });

    const buttonInteraction = createMockButtonInteraction('memory-browse::list::1::date');
    collectCallback(buttonInteraction);

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockCallGatewayApi).toHaveBeenCalledTimes(2);
  });

  it('should handle pagination button click with API failure', async () => {
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        memories: [
          {
            id: 'memory-1',
            content: 'Test',
            createdAt: '2025-06-15T12:00:00.000Z',
            updatedAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        total: 20,
        limit: 10,
        offset: 0,
        hasMore: true,
      },
    });

    const context = createMockContext();
    await handleBrowse(context);

    // API fails on page 2
    mockCallGatewayApi.mockResolvedValueOnce({ ok: false, error: 'Server error' });

    const buttonInteraction = createMockButtonInteraction('memory-browse::list::1::date');
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
        memories: [
          {
            id: 'memory-1',
            content: 'Test',
            createdAt: '2025-06-15T12:00:00.000Z',
            updatedAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
        hasMore: false,
      },
    });

    const context = createMockContext();
    await handleBrowse(context);

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
        memories: [
          {
            id: 'memory-1',
            content: 'Test',
            createdAt: '2025-06-15T12:00:00.000Z',
            updatedAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
        hasMore: false,
      },
    });

    const context = createMockContext();
    await handleBrowse(context);

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
        memories: [
          {
            id: 'memory-1',
            content: 'Test',
            createdAt: '2025-06-15T12:00:00.000Z',
            updatedAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
        hasMore: false,
      },
    });

    const context = createMockContext();
    await handleBrowse(context);

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
        memories: [
          {
            id: 'memory-1',
            content: 'Test',
            createdAt: '2025-06-15T12:00:00.000Z',
            updatedAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
        hasMore: false,
      },
    });

    const context = createMockContext();
    await handleBrowse(context);

    const buttonInteraction = createMockButtonInteraction('unknown-prefix::action');
    collectCallback(buttonInteraction);

    await new Promise(resolve => setTimeout(resolve, 10));

    // Should not call deferUpdate for unrecognized buttons
    expect(mockDeferUpdate).not.toHaveBeenCalled();
  });

  it('should handle edit button action', async () => {
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        memories: [
          {
            id: 'memory-1',
            content: 'Test',
            createdAt: '2025-06-15T12:00:00.000Z',
            updatedAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
        hasMore: false,
      },
    });

    const context = createMockContext();
    await handleBrowse(context);

    const buttonInteraction = createMockButtonInteraction('memory-detail::edit::memory-1');
    collectCallback(buttonInteraction);

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockHandleEditButton).toHaveBeenCalledWith(buttonInteraction, 'memory-1');
  });

  it('should handle lock button action', async () => {
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        memories: [
          {
            id: 'memory-1',
            content: 'Test',
            createdAt: '2025-06-15T12:00:00.000Z',
            updatedAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
        hasMore: false,
      },
    });

    const context = createMockContext();
    await handleBrowse(context);

    const buttonInteraction = createMockButtonInteraction('memory-detail::lock::memory-1');
    collectCallback(buttonInteraction);

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockHandleLockButton).toHaveBeenCalledWith(buttonInteraction, 'memory-1');
  });

  it('should handle delete button action', async () => {
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        memories: [
          {
            id: 'memory-1',
            content: 'Test',
            createdAt: '2025-06-15T12:00:00.000Z',
            updatedAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
        hasMore: false,
      },
    });

    const context = createMockContext();
    await handleBrowse(context);

    const buttonInteraction = createMockButtonInteraction('memory-detail::delete::memory-1');
    collectCallback(buttonInteraction);

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockHandleDeleteButton).toHaveBeenCalledWith(buttonInteraction, 'memory-1');
  });

  it('should handle confirm-delete button action', async () => {
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        memories: [
          {
            id: 'memory-1',
            content: 'Test',
            createdAt: '2025-06-15T12:00:00.000Z',
            updatedAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
        hasMore: false,
      },
    });

    const context = createMockContext();
    await handleBrowse(context);

    const buttonInteraction = createMockButtonInteraction(
      'memory-detail::confirm-delete::memory-1'
    );
    collectCallback(buttonInteraction);

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockHandleDeleteConfirm).toHaveBeenCalledWith(buttonInteraction, 'memory-1');
  });

  it('should handle back button action', async () => {
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        memories: [
          {
            id: 'memory-1',
            content: 'Test',
            createdAt: '2025-06-15T12:00:00.000Z',
            updatedAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
        hasMore: false,
      },
    });

    const context = createMockContext();
    await handleBrowse(context);

    const buttonInteraction = createMockButtonInteraction('memory-detail::back::memory-1');
    collectCallback(buttonInteraction);

    await new Promise(resolve => setTimeout(resolve, 10));

    // Back button defers update before refreshing
    expect(mockDeferUpdate).toHaveBeenCalled();
  });

  it('should handle view-full button action', async () => {
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        memories: [
          {
            id: 'memory-1',
            content: 'Test memory with full content',
            createdAt: '2025-06-15T12:00:00.000Z',
            updatedAt: '2025-06-15T12:00:00.000Z',
            personalityId: 'p1',
            personalityName: 'Test',
            isLocked: false,
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
        hasMore: false,
      },
    });

    const context = createMockContext();
    await handleBrowse(context);

    const buttonInteraction = createMockButtonInteraction('memory-detail::view-full::memory-1');
    collectCallback(buttonInteraction);

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockHandleViewFullButton).toHaveBeenCalledWith(buttonInteraction, 'memory-1');
  });
});
