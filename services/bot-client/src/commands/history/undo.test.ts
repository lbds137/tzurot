/**
 * Tests for History Undo Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleUndo } from './undo.js';

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
const mockCreateSuccessEmbed = vi.fn(() => ({}));
vi.mock('../../utils/commandHelpers.js', () => ({
  replyWithError: (...args: unknown[]) => mockReplyWithError(...args),
  handleCommandError: (...args: unknown[]) => mockHandleCommandError(...args),
  createSuccessEmbed: (...args: unknown[]) => mockCreateSuccessEmbed(...args),
}));

describe('handleUndo', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockInteraction(personalitySlug: string = 'lilith') {
    return {
      user: { id: '123456789' },
      options: {
        getString: (name: string, _required?: boolean) => {
          if (name === 'personality') return personalitySlug;
          return null;
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleUndo>[0];
  }

  it('should undo clear successfully', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        success: true,
        restoredEpoch: '2025-12-12T08:00:00.000Z',
        message: 'Context restored',
      },
    });

    const interaction = createMockInteraction();
    await handleUndo(interaction);

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/history/undo', {
      userId: '123456789',
      method: 'POST',
      body: { personalitySlug: 'lilith' },
    });
    expect(mockCreateSuccessEmbed).toHaveBeenCalledWith(
      'Context Restored',
      expect.stringContaining('lilith')
    );
    expect(mockEditReply).toHaveBeenCalledWith({ embeds: [expect.any(Object)] });
  });

  it('should handle personality not found (404)', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 404,
      error: 'Not found',
    });

    const interaction = createMockInteraction('unknown');
    await handleUndo(interaction);

    expect(mockReplyWithError).toHaveBeenCalledWith(
      interaction,
      'Personality "unknown" not found.'
    );
  });

  it('should handle no previous context (400)', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 400,
      error: 'No previous context',
    });

    const interaction = createMockInteraction();
    await handleUndo(interaction);

    expect(mockReplyWithError).toHaveBeenCalledWith(
      interaction,
      'No previous context to restore. Undo is only available after a clear operation.'
    );
  });

  it('should handle generic API error', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'Server error',
    });

    const interaction = createMockInteraction();
    await handleUndo(interaction);

    expect(mockReplyWithError).toHaveBeenCalledWith(
      interaction,
      'Failed to undo. Please try again later.'
    );
  });

  it('should handle exceptions', async () => {
    const error = new Error('Network error');
    mockCallGatewayApi.mockRejectedValue(error);

    const interaction = createMockInteraction();
    await handleUndo(interaction);

    expect(mockHandleCommandError).toHaveBeenCalledWith(interaction, error, {
      userId: '123456789',
      command: 'History Undo',
    });
  });
});
