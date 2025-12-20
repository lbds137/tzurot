/**
 * Tests for Preset Delete Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleDelete } from './delete.js';
import { mockDeleteLlmConfigResponse } from '@tzurot/common-types';

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
const mockCreateSuccessEmbed = vi.fn().mockReturnValue({ data: { title: '🗑️ Preset Deleted' } });
vi.mock('../../utils/commandHelpers.js', () => ({
  replyWithError: (...args: unknown[]) => mockReplyWithError(...args),
  handleCommandError: (...args: unknown[]) => mockHandleCommandError(...args),
  createSuccessEmbed: (...args: unknown[]) => mockCreateSuccessEmbed(...args),
}));

describe('handleDelete', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockInteraction(presetId: string = 'cfg-123') {
    return {
      user: { id: '123456789' },
      options: {
        getString: (name: string) => {
          if (name === 'preset') return presetId;
          return null;
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleDelete>[0];
  }

  it('should delete preset successfully', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: true, data: mockDeleteLlmConfigResponse() });

    const interaction = createMockInteraction('cfg-123');
    await handleDelete(interaction);

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/llm-config/cfg-123', {
      method: 'DELETE',
      userId: '123456789',
    });
    expect(mockCreateSuccessEmbed).toHaveBeenCalledWith(
      '🗑️ Preset Deleted',
      'Your preset has been deleted.'
    );
    expect(mockEditReply).toHaveBeenCalled();
  });

  it('should handle not found error', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 404,
      error: 'Preset not found',
    });

    const interaction = createMockInteraction('non-existent');
    await handleDelete(interaction);

    expect(mockReplyWithError).toHaveBeenCalledWith(
      interaction,
      'Failed to delete preset: Preset not found'
    );
  });

  it('should handle preset in use error', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 400,
      error: 'Cannot delete: preset is in use by 2 personality override(s)',
    });

    const interaction = createMockInteraction('cfg-in-use');
    await handleDelete(interaction);

    expect(mockReplyWithError).toHaveBeenCalledWith(
      interaction,
      expect.stringContaining('preset is in use')
    );
  });

  it('should handle exceptions', async () => {
    const error = new Error('Network error');
    mockCallGatewayApi.mockRejectedValue(error);

    const interaction = createMockInteraction();
    await handleDelete(interaction);

    expect(mockHandleCommandError).toHaveBeenCalledWith(interaction, error, {
      userId: '123456789',
      command: 'Preset Delete',
    });
  });
});
