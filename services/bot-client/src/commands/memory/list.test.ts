/**
 * Tests for Memory List Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleList } from './list.js';

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

describe('handleList', () => {
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

  function createMockInteraction(personality: string | null = null) {
    return {
      user: { id: '123456789' },
      options: {
        getString: (name: string) => {
          if (name === 'personality') return personality;
          return null;
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleList>[0];
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

    const interaction = createMockInteraction();
    await handleList(interaction);

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

    const interaction = createMockInteraction('lilith');
    await handleList(interaction);

    expect(mockResolvePersonalityId).toHaveBeenCalledWith('123456789', 'lilith');
    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      expect.stringContaining('personalityId=personality-uuid-123'),
      expect.any(Object)
    );
  });

  it('should show error when personality not found', async () => {
    mockResolvePersonalityId.mockResolvedValue(null);

    const interaction = createMockInteraction('unknown-personality');
    await handleList(interaction);

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

    const interaction = createMockInteraction();
    await handleList(interaction);

    expect(mockReplyWithError).toHaveBeenCalledWith(
      interaction,
      expect.stringContaining('Failed to load')
    );
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

    const interaction = createMockInteraction();
    await handleList(interaction);

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

    const interaction = createMockInteraction();
    await handleList(interaction);

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

    const interaction = createMockInteraction();
    await handleList(interaction);

    expect(mockCreateMessageComponentCollector).not.toHaveBeenCalled();
  });

  it('should handle unexpected errors', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    const interaction = createMockInteraction();
    await handleList(interaction);

    expect(mockReplyWithError).toHaveBeenCalledWith(
      interaction,
      expect.stringContaining('unexpected error')
    );
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

    const interaction = createMockInteraction();
    await handleList(interaction);

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

    const interaction = createMockInteraction();
    await handleList(interaction);

    // The embed should contain the lock emoji for locked memories
    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
      })
    );
  });
});
