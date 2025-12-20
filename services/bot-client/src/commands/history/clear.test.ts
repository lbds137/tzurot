/**
 * Tests for History Clear Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleClear } from './clear.js';

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
const mockCreateSuccessEmbed = vi.fn(() => ({
  addFields: vi.fn().mockReturnThis(),
}));
vi.mock('../../utils/commandHelpers.js', () => ({
  replyWithError: (...args: unknown[]) => mockReplyWithError(...args),
  handleCommandError: (...args: unknown[]) => mockHandleCommandError(...args),
  createSuccessEmbed: (...args: unknown[]) => mockCreateSuccessEmbed(...args),
}));

describe('handleClear', () => {
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
    } as unknown as Parameters<typeof handleClear>[0];
  }

  it('should clear history successfully', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        success: true,
        epoch: '2025-12-13T10:30:00.000Z',
        canUndo: false,
        message: 'Context cleared',
      },
    });

    const interaction = createMockInteraction();
    await handleClear(interaction);

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/history/clear', {
      userId: '123456789',
      method: 'POST',
      body: { personalitySlug: 'lilith' },
    });
    expect(mockCreateSuccessEmbed).toHaveBeenCalledWith(
      'Context Cleared',
      expect.stringContaining('lilith')
    );
    expect(mockEditReply).toHaveBeenCalledWith({ embeds: [expect.any(Object)] });
  });

  it('should show undo available when canUndo is true', async () => {
    const mockEmbed = { addFields: vi.fn().mockReturnThis() };
    mockCreateSuccessEmbed.mockReturnValue(mockEmbed);

    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        success: true,
        epoch: '2025-12-13T10:30:00.000Z',
        canUndo: true,
        message: 'Context cleared',
      },
    });

    const interaction = createMockInteraction();
    await handleClear(interaction);

    expect(mockEmbed.addFields).toHaveBeenCalledWith({
      name: 'Undo Available',
      value: expect.stringContaining('/history undo'),
      inline: false,
    });
  });

  it('should show first clear message when canUndo is false', async () => {
    const mockEmbed = { addFields: vi.fn().mockReturnThis() };
    mockCreateSuccessEmbed.mockReturnValue(mockEmbed);

    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        success: true,
        epoch: '2025-12-13T10:30:00.000Z',
        canUndo: false,
        message: 'Context cleared',
      },
    });

    const interaction = createMockInteraction();
    await handleClear(interaction);

    expect(mockEmbed.addFields).toHaveBeenCalledWith({
      name: 'Undo Available',
      value: expect.stringContaining('first clear'),
      inline: false,
    });
  });

  it('should handle personality not found (404)', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 404,
      error: 'Not found',
    });

    const interaction = createMockInteraction('unknown');
    await handleClear(interaction);

    expect(mockReplyWithError).toHaveBeenCalledWith(
      interaction,
      'Personality "unknown" not found.'
    );
  });

  it('should handle generic API error', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'Server error',
    });

    const interaction = createMockInteraction();
    await handleClear(interaction);

    expect(mockReplyWithError).toHaveBeenCalledWith(
      interaction,
      'Failed to clear history. Please try again later.'
    );
  });

  it('should handle exceptions', async () => {
    const error = new Error('Network error');
    mockCallGatewayApi.mockRejectedValue(error);

    const interaction = createMockInteraction();
    await handleClear(interaction);

    expect(mockHandleCommandError).toHaveBeenCalledWith(interaction, error, {
      userId: '123456789',
      command: 'History Clear',
    });
  });
});
