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

  function createMockInteraction(query: string, personality: string | null = null) {
    return {
      user: { id: '123456789' },
      options: {
        getString: (name: string, _required?: boolean) => {
          if (name === 'query') return query;
          if (name === 'personality') return personality;
          return null;
        },
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

    const interaction = createMockInteraction('cats');
    await handleSearch(interaction);

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

    const interaction = createMockInteraction('test query', 'lilith');
    await handleSearch(interaction);

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

    const interaction = createMockInteraction('test', 'unknown-personality');
    await handleSearch(interaction);

    expect(mockReplyWithError).toHaveBeenCalledWith(
      interaction,
      expect.stringContaining('not found')
    );
  });

  it('should handle API error', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'Internal error',
    });

    const interaction = createMockInteraction('test query');
    await handleSearch(interaction);

    expect(mockReplyWithError).toHaveBeenCalledWith(
      interaction,
      expect.stringContaining('Failed to search')
    );
  });

  it('should handle empty results gracefully', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { results: [], count: 0, hasMore: false },
    });

    const interaction = createMockInteraction('nonexistent query');
    await handleSearch(interaction);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: [], // No pagination buttons when empty
    });
  });

  it('should handle unexpected errors', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    const interaction = createMockInteraction('test');
    await handleSearch(interaction);

    expect(mockHandleCommandError).toHaveBeenCalledWith(
      interaction,
      expect.any(Error),
      expect.objectContaining({ command: 'Memory Search' })
    );
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

    const interaction = createMockInteraction('test');
    await handleSearch(interaction);

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

    const interaction = createMockInteraction('test');
    await handleSearch(interaction);

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

    const interaction = createMockInteraction('test');
    await handleSearch(interaction);

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

    const interaction = createMockInteraction('test');
    await handleSearch(interaction);

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

    const interaction = createMockInteraction('specific name');
    await handleSearch(interaction);

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

    const interaction = createMockInteraction('test');
    await handleSearch(interaction);

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

    // Create interaction with empty string personality
    const interaction = {
      user: { id: '123456789' },
      options: {
        getString: (name: string) => {
          if (name === 'query') return 'test';
          if (name === 'personality') return '';
          return null;
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleSearch>[0];

    await handleSearch(interaction);

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

    const interaction = createMockInteraction('test');
    await handleSearch(interaction);

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

    const interaction = createMockInteraction('test');
    await handleSearch(interaction);

    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
        components: expect.any(Array),
      })
    );
    expect(mockCreateMessageComponentCollector).toHaveBeenCalled();
  });
});
