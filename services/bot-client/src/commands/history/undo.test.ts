/**
 * Tests for History Undo Subcommand
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
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
const mockCreateSuccessEmbed = vi.fn(() => ({}));
vi.mock('../../utils/commandHelpers.js', () => ({
  createSuccessEmbed: (...args: unknown[]) => mockCreateSuccessEmbed(...args),
}));

describe('handleUndo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Create a mock DeferredCommandContext for testing.
   */
  function createMockContext(personalitySlug: string = 'lilith'): DeferredCommandContext {
    const mockEditReply = vi.fn().mockResolvedValue(undefined);

    return {
      interaction: {},
      user: { id: '123456789' },
      guild: null,
      member: null,
      channel: null,
      channelId: '111111111111111111',
      guildId: null,
      commandName: 'history',
      isEphemeral: true,
      getOption: vi.fn((name: string) => {
        if (name === 'profile') return null;
        return null;
      }),
      getRequiredOption: vi.fn((name: string) => {
        if (name === 'personality') return personalitySlug;
        throw new Error(`Unknown required option: ${name}`);
      }),
      getSubcommand: () => 'undo',
      getSubcommandGroup: () => null,
      editReply: mockEditReply,
      followUp: vi.fn(),
      deleteReply: vi.fn(),
    } as unknown as DeferredCommandContext;
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

    const context = createMockContext();
    await handleUndo(context);

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/history/undo', {
      userId: '123456789',
      method: 'POST',
      body: { personalitySlug: 'lilith' },
    });
    expect(mockCreateSuccessEmbed).toHaveBeenCalledWith(
      'Context Restored',
      expect.stringContaining('lilith')
    );
    expect(context.editReply).toHaveBeenCalledWith({ embeds: [expect.any(Object)] });
  });

  it('should handle personality not found (404)', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 404,
      error: 'Not found',
    });

    const context = createMockContext('unknown');
    await handleUndo(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: '❌ Personality "unknown" not found.',
    });
  });

  it('should handle no previous context (400)', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 400,
      error: 'No previous context',
    });

    const context = createMockContext();
    await handleUndo(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: '❌ No previous context to restore. Undo is only available after a clear operation.',
    });
  });

  it('should handle generic API error', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'Server error',
    });

    const context = createMockContext();
    await handleUndo(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: '❌ Failed to undo. Please try again later.',
    });
  });

  it('should handle exceptions', async () => {
    const error = new Error('Network error');
    mockCallGatewayApi.mockRejectedValue(error);

    const context = createMockContext();
    await handleUndo(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: '❌ An error occurred. Please try again later.',
    });
  });
});
