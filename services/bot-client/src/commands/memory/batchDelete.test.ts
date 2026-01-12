/**
 * Tests for Memory Batch Delete Handler
 *
 * Tests /memory delete subcommand:
 * - Preview API call to show what would be deleted
 * - Confirmation dialog with danger button
 * - Actual deletion via API on confirm
 * - Cancel and timeout handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleBatchDelete } from './batchDelete.js';
import type { ChatInputCommandInteraction, ButtonInteraction, Message } from 'discord.js';

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
  createWarningEmbed: vi.fn((_title: string, _description: string) => ({
    toJSON: () => ({ title: 'Test Warning' }),
  })),
  createSuccessEmbed: vi.fn((_title: string, _description: string) => ({
    toJSON: () => ({ title: 'Test Success' }),
  })),
}));

// Mock autocomplete
const mockResolvePersonalityId = vi.fn();
vi.mock('./autocomplete.js', () => ({
  resolvePersonalityId: (...args: unknown[]) => mockResolvePersonalityId(...args),
}));

describe('handleBatchDelete', () => {
  const mockEditReply = vi.fn();
  const mockAwaitMessageComponent = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: editReply returns message with awaitMessageComponent
    mockEditReply.mockResolvedValue({
      awaitMessageComponent: mockAwaitMessageComponent,
    });
  });

  function createMockInteraction(personality = 'lilith', timeframe: string | null = null) {
    return {
      user: { id: 'user-123' },
      options: {
        getString: (name: string, _required?: boolean) => {
          if (name === 'personality') return personality;
          if (name === 'timeframe') return timeframe;
          return null;
        },
      },
      editReply: mockEditReply,
    } as unknown as ChatInputCommandInteraction;
  }

  function createMockButtonInteraction(customId: string, userId = 'user-123') {
    return {
      customId,
      user: { id: userId },
      update: vi.fn().mockResolvedValue(undefined),
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ButtonInteraction & {
      update: ReturnType<typeof vi.fn>;
      deferUpdate: ReturnType<typeof vi.fn>;
      editReply: ReturnType<typeof vi.fn>;
    };
  }

  describe('validation', () => {
    it('should show error when personality not found', async () => {
      mockResolvePersonalityId.mockResolvedValue(null);
      const interaction = createMockInteraction('unknown-personality');

      await handleBatchDelete(interaction);

      expect(mockReplyWithError).toHaveBeenCalledWith(
        interaction,
        expect.stringContaining('not found')
      );
    });

    it('should resolve personality slug to ID', async () => {
      mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          wouldDelete: 0,
          lockedWouldSkip: 0,
          personalityId: 'personality-uuid-123',
          personalityName: 'Lilith',
          timeframe: 'all',
        },
      });

      const interaction = createMockInteraction('lilith');
      await handleBatchDelete(interaction);

      expect(mockResolvePersonalityId).toHaveBeenCalledWith('user-123', 'lilith');
      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        expect.stringContaining('personalityId=personality-uuid-123'),
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('preview', () => {
    beforeEach(() => {
      mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
    });

    it('should show error when preview API fails', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        status: 500,
        error: 'Server error',
      });

      const interaction = createMockInteraction();
      await handleBatchDelete(interaction);

      expect(mockReplyWithError).toHaveBeenCalled();
    });

    it('should show 404 message when personality not found in API', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        status: 404,
        error: 'Not found',
      });

      const interaction = createMockInteraction();
      await handleBatchDelete(interaction);

      expect(mockReplyWithError).toHaveBeenCalledWith(
        interaction,
        expect.stringContaining('not found')
      );
    });

    it('should show "no memories" message when nothing to delete', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          wouldDelete: 0,
          lockedWouldSkip: 0,
          personalityId: 'personality-uuid-123',
          personalityName: 'Lilith',
          timeframe: 'all',
        },
      });

      const interaction = createMockInteraction();
      await handleBatchDelete(interaction);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('No memories found'),
      });
    });

    it('should include timeframe in preview request when provided', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          wouldDelete: 0,
          lockedWouldSkip: 0,
          personalityId: 'personality-uuid-123',
          personalityName: 'Lilith',
          timeframe: '7d',
        },
      });

      const interaction = createMockInteraction('lilith', '7d');
      await handleBatchDelete(interaction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        expect.stringMatching(/timeframe=7d/),
        expect.any(Object)
      );
    });
  });

  describe('confirmation dialog', () => {
    beforeEach(() => {
      mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          wouldDelete: 5,
          lockedWouldSkip: 1,
          personalityId: 'personality-uuid-123',
          personalityName: 'Lilith',
          timeframe: 'all',
        },
      });
    });

    it('should show confirmation embed with memory count', async () => {
      mockAwaitMessageComponent.mockRejectedValue(new Error('timeout'));
      const interaction = createMockInteraction();

      await handleBatchDelete(interaction);

      // Verify editReply was called with embeds and components (buttons)
      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: expect.any(Array),
        components: expect.any(Array),
      });
    });

    it('should cancel when user clicks cancel button', async () => {
      const buttonInteraction = createMockButtonInteraction('memory_batch_delete_cancel');
      mockAwaitMessageComponent.mockResolvedValue(buttonInteraction);

      const interaction = createMockInteraction();
      await handleBatchDelete(interaction);

      expect(buttonInteraction.update).toHaveBeenCalledWith({
        content: 'Deletion cancelled.',
        embeds: [],
        components: [],
      });
    });

    it('should handle confirmation timeout', async () => {
      mockAwaitMessageComponent.mockRejectedValue(new Error('timeout'));

      const interaction = createMockInteraction();
      await handleBatchDelete(interaction);

      // After timeout, should clear the confirmation dialog
      expect(mockEditReply).toHaveBeenLastCalledWith({
        content: 'Deletion cancelled - confirmation timed out.',
        embeds: [],
        components: [],
      });
    });
  });

  describe('deletion', () => {
    beforeEach(() => {
      mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
    });

    it('should perform deletion when user confirms', async () => {
      // Preview response
      mockCallGatewayApi
        .mockResolvedValueOnce({
          ok: true,
          data: {
            wouldDelete: 5,
            lockedWouldSkip: 1,
            personalityId: 'personality-uuid-123',
            personalityName: 'Lilith',
            timeframe: 'all',
          },
        })
        // Delete response
        .mockResolvedValueOnce({
          ok: true,
          data: {
            deletedCount: 5,
            skippedLocked: 1,
            personalityId: 'personality-uuid-123',
            personalityName: 'Lilith',
            message: 'Deleted 5 memories. 1 locked memories were skipped.',
          },
        });

      const buttonInteraction = createMockButtonInteraction('memory_batch_delete_confirm');
      mockAwaitMessageComponent.mockResolvedValue(buttonInteraction);

      const interaction = createMockInteraction();
      await handleBatchDelete(interaction);

      // Verify delete API was called
      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/memory/delete',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            personalityId: 'personality-uuid-123',
          }),
        })
      );

      // Verify success message shown
      expect(buttonInteraction.editReply).toHaveBeenCalledWith({
        embeds: expect.any(Array),
        components: [],
      });
    });

    it('should include timeframe in delete request', async () => {
      mockCallGatewayApi
        .mockResolvedValueOnce({
          ok: true,
          data: {
            wouldDelete: 3,
            lockedWouldSkip: 0,
            personalityId: 'personality-uuid-123',
            personalityName: 'Lilith',
            timeframe: '7d',
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          data: {
            deletedCount: 3,
            skippedLocked: 0,
            personalityId: 'personality-uuid-123',
            personalityName: 'Lilith',
            message: 'Deleted 3 memories.',
          },
        });

      const buttonInteraction = createMockButtonInteraction('memory_batch_delete_confirm');
      mockAwaitMessageComponent.mockResolvedValue(buttonInteraction);

      const interaction = createMockInteraction('lilith', '7d');
      await handleBatchDelete(interaction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/memory/delete',
        expect.objectContaining({
          body: expect.objectContaining({
            timeframe: '7d',
          }),
        })
      );
    });

    it('should show error when delete API fails', async () => {
      mockCallGatewayApi
        .mockResolvedValueOnce({
          ok: true,
          data: {
            wouldDelete: 5,
            lockedWouldSkip: 0,
            personalityId: 'personality-uuid-123',
            personalityName: 'Lilith',
            timeframe: 'all',
          },
        })
        .mockResolvedValueOnce({
          ok: false,
          error: 'Database error',
        });

      const buttonInteraction = createMockButtonInteraction('memory_batch_delete_confirm');
      mockAwaitMessageComponent.mockResolvedValue(buttonInteraction);

      const interaction = createMockInteraction();
      await handleBatchDelete(interaction);

      expect(buttonInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to delete'),
        embeds: [],
        components: [],
      });
    });

    it('should defer update before making API call', async () => {
      mockCallGatewayApi
        .mockResolvedValueOnce({
          ok: true,
          data: {
            wouldDelete: 2,
            lockedWouldSkip: 0,
            personalityId: 'personality-uuid-123',
            personalityName: 'Lilith',
            timeframe: 'all',
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          data: {
            deletedCount: 2,
            skippedLocked: 0,
            personalityId: 'personality-uuid-123',
            personalityName: 'Lilith',
            message: 'Deleted 2 memories.',
          },
        });

      const buttonInteraction = createMockButtonInteraction('memory_batch_delete_confirm');
      mockAwaitMessageComponent.mockResolvedValue(buttonInteraction);

      const interaction = createMockInteraction();
      await handleBatchDelete(interaction);

      // deferUpdate should be called before the delete API
      expect(buttonInteraction.deferUpdate).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle unexpected errors gracefully', async () => {
      mockResolvePersonalityId.mockRejectedValue(new Error('Unexpected error'));

      const interaction = createMockInteraction();
      await handleBatchDelete(interaction);

      expect(mockHandleCommandError).toHaveBeenCalled();
    });
  });
});
