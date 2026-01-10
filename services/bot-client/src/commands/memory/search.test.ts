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
const mockCreateInfoEmbed = vi.fn(() => ({
  addFields: vi.fn().mockReturnThis(),
  setDescription: vi.fn().mockReturnThis(),
  setFooter: vi.fn().mockReturnThis(),
}));
vi.mock('../../utils/commandHelpers.js', () => ({
  replyWithError: (...args: unknown[]) => mockReplyWithError(...args),
  handleCommandError: (...args: unknown[]) => mockHandleCommandError(...args),
  createInfoEmbed: (...args: unknown[]) => mockCreateInfoEmbed(...args),
}));

// Mock autocomplete
const mockResolvePersonalityId = vi.fn();
vi.mock('./autocomplete.js', () => ({
  resolvePersonalityId: (...args: unknown[]) => mockResolvePersonalityId(...args),
}));

describe('handleSearch', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockInteraction(
    query: string,
    personality: string | null = null,
    limit: number | null = null
  ) {
    return {
      user: { id: '123456789' },
      options: {
        getString: (name: string, _required?: boolean) => {
          if (name === 'query') return query;
          if (name === 'personality') return personality;
          return null;
        },
        getInteger: (name: string) => {
          if (name === 'limit') return limit;
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
    expect(mockEditReply).toHaveBeenCalledWith({ embeds: expect.any(Array) });
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

  it('should handle service unavailable error', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 503,
      error: 'Service unavailable',
    });

    const interaction = createMockInteraction('test query');
    await handleSearch(interaction);

    expect(mockReplyWithError).toHaveBeenCalledWith(
      interaction,
      expect.stringContaining('not currently available')
    );
  });

  it('should respect limit parameter', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { results: [], count: 0, hasMore: false },
    });

    const interaction = createMockInteraction('test', null, 3);
    await handleSearch(interaction);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/memory/search',
      expect.objectContaining({
        body: expect.objectContaining({
          limit: 3,
        }),
      })
    );
  });

  it('should clamp limit to max 10 for display', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { results: [], count: 0, hasMore: false },
    });

    const interaction = createMockInteraction('test', null, 100);
    await handleSearch(interaction);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/memory/search',
      expect.objectContaining({
        body: expect.objectContaining({
          limit: 10, // Clamped to 10
        }),
      })
    );
  });

  it('should handle empty results gracefully', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { results: [], count: 0, hasMore: false },
    });

    const interaction = createMockInteraction('nonexistent query');
    await handleSearch(interaction);

    expect(mockEditReply).toHaveBeenCalled();
    expect(mockCreateInfoEmbed).toHaveBeenCalled();
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
});
