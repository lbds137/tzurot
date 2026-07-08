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
import type { ButtonInteraction } from 'discord.js';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

vi.mock('../../utils/commandHelpers.js', () => ({
  createWarningEmbed: vi.fn((_title: string, _description: string) => ({
    toJSON: () => ({ title: 'Test Warning' }),
  })),
  createSuccessEmbed: vi.fn((_title: string, _description: string) => ({
    toJSON: () => ({ title: 'Test Success' }),
  })),
}));

const mockResolvePersonalityId = vi.fn();
vi.mock('./autocomplete.js', () => ({
  resolvePersonalityId: (...args: unknown[]) => mockResolvePersonalityId(...args),
}));

interface MemoryClientStub {
  batchDeletePreview: ReturnType<typeof vi.fn>;
  batchDelete: ReturnType<typeof vi.fn>;
}

function createStub(): MemoryClientStub {
  return {
    batchDeletePreview: vi.fn(),
    batchDelete: vi.fn(),
  };
}

describe('handleBatchDelete', () => {
  const mockEditReply = vi.fn();
  const mockAwaitMessageComponent = vi.fn();
  let stub: MemoryClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
    // Default: editReply returns message with awaitMessageComponent
    mockEditReply.mockResolvedValue({
      awaitMessageComponent: mockAwaitMessageComponent,
    });
  });

  function createMockContext(personality = 'lilith', timeframe: string | null = null) {
    return {
      user: { id: 'user-123', username: 'testuser', globalName: 'testuser' },
      interaction: {
        user: { id: 'user-123', username: 'testuser' },
        options: {
          getString: (name: string, _required?: boolean) => {
            if (name === 'character') return personality;
            if (name === 'timeframe') return timeframe;
            return null;
          },
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleBatchDelete>[0];
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
      mockResolvePersonalityId.mockResolvedValue({ kind: 'not-found' });
      const context = createMockContext('unknown-personality');

      await handleBatchDelete(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('not found'),
      });
    });

    it('shows "try again" (unavailable), not "not found", when the personality list is unavailable', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'unavailable' });
      const context = createMockContext('lilith');

      await handleBatchDelete(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Autocomplete was unavailable'),
      });
      expect(stub.batchDeletePreview).not.toHaveBeenCalled();
    });

    it('should resolve personality slug to ID', async () => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid-123' });
      stub.batchDeletePreview.mockResolvedValue(
        makeOk({
          wouldDelete: 0,
          lockedWouldSkip: 0,
          personalityId: 'personality-uuid-123',
          personalityName: 'Lilith',
          timeframe: 'all',
          previewToken: 'preview_test0000test0001',
        })
      );

      const context = createMockContext('lilith');
      await handleBatchDelete(context);

      // Identity carried at the clientsFor boundary; first arg is the bound
      // userClient stub. See gatewayClients.test.ts for the brand-binding contract.
      expect(mockResolvePersonalityId).toHaveBeenCalledWith(expect.any(Object), 'lilith');
      expect(stub.batchDeletePreview).toHaveBeenCalledWith(
        expect.objectContaining({ personalityId: 'personality-uuid-123' })
      );
    });
  });

  describe('preview', () => {
    beforeEach(() => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid-123' });
    });

    it('should show error when preview API fails', async () => {
      stub.batchDeletePreview.mockResolvedValue(makeErr(500, 'Server error'));

      const context = createMockContext();
      await handleBatchDelete(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Server error'),
      });
    });

    it('should show 404 message when personality not found in API', async () => {
      stub.batchDeletePreview.mockResolvedValue(makeErr(404, 'Not found'));

      const context = createMockContext();
      await handleBatchDelete(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('not found'),
      });
    });

    it('should show "no memories" message when nothing to delete', async () => {
      stub.batchDeletePreview.mockResolvedValue(
        makeOk({
          wouldDelete: 0,
          lockedWouldSkip: 0,
          personalityId: 'personality-uuid-123',
          personalityName: 'Lilith',
          timeframe: 'all',
          previewToken: 'preview_test0000test0001',
        })
      );

      const context = createMockContext();
      await handleBatchDelete(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('No memories found'),
      });
    });

    it('should include timeframe in preview request when provided', async () => {
      stub.batchDeletePreview.mockResolvedValue(
        makeOk({
          wouldDelete: 0,
          lockedWouldSkip: 0,
          personalityId: 'personality-uuid-123',
          personalityName: 'Lilith',
          timeframe: '7d',
          previewToken: 'preview_test0000test0002',
        })
      );

      const context = createMockContext('lilith', '7d');
      await handleBatchDelete(context);

      expect(stub.batchDeletePreview).toHaveBeenCalledWith(
        expect.objectContaining({ timeframe: '7d' })
      );
    });
  });

  describe('confirmation dialog', () => {
    beforeEach(() => {
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid-123' });
      stub.batchDeletePreview.mockResolvedValue(
        makeOk({
          wouldDelete: 5,
          lockedWouldSkip: 1,
          personalityId: 'personality-uuid-123',
          personalityName: 'Lilith',
          timeframe: 'all',
          previewToken: 'preview_test0000test0001',
        })
      );
    });

    it('should show confirmation embed with memory count', async () => {
      mockAwaitMessageComponent.mockRejectedValue(new Error('timeout'));
      const context = createMockContext();

      await handleBatchDelete(context);

      // Verify editReply was called with embeds and components (buttons)
      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: expect.any(Array),
        components: expect.any(Array),
      });
    });

    it('should cancel when user clicks cancel button', async () => {
      const buttonInteraction = createMockButtonInteraction('memory-batch-delete::cancel');
      mockAwaitMessageComponent.mockResolvedValue(buttonInteraction);

      const context = createMockContext();
      await handleBatchDelete(context);

      expect(buttonInteraction.update).toHaveBeenCalledWith({
        content: 'Deletion cancelled.',
        embeds: [],
        components: [],
      });
    });

    it('should handle confirmation timeout', async () => {
      mockAwaitMessageComponent.mockRejectedValue(new Error('timeout'));

      const context = createMockContext();
      await handleBatchDelete(context);

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
      mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid-123' });
    });

    it('should perform deletion using the previewToken when user confirms', async () => {
      stub.batchDeletePreview.mockResolvedValue(
        makeOk({
          wouldDelete: 5,
          lockedWouldSkip: 1,
          personalityId: 'personality-uuid-123',
          personalityName: 'Lilith',
          timeframe: 'all',
          previewToken: 'preview_test0000test0001',
        })
      );
      stub.batchDelete.mockResolvedValue(
        makeOk({
          deletedCount: 5,
          skippedLocked: 1,
          personalityId: 'personality-uuid-123',
          personalityName: 'Lilith',
          message: 'Deleted 5 memories. 1 locked memories were skipped.',
        })
      );

      const buttonInteraction = createMockButtonInteraction('memory-batch-delete::confirm');
      mockAwaitMessageComponent.mockResolvedValue(buttonInteraction);

      const context = createMockContext();
      await handleBatchDelete(context);

      // Delete API is invoked with ONLY the previewToken — the filter
      // never crosses the wire on the execute path.
      expect(stub.batchDelete).toHaveBeenCalledWith({ previewToken: 'preview_test0000test0001' });

      expect(buttonInteraction.editReply).toHaveBeenCalledWith({
        embeds: expect.any(Array),
        components: [],
      });
    });

    it('should include timeframe only in the preview body — execute uses the token', async () => {
      stub.batchDeletePreview.mockResolvedValue(
        makeOk({
          wouldDelete: 3,
          lockedWouldSkip: 0,
          personalityId: 'personality-uuid-123',
          personalityName: 'Lilith',
          timeframe: '7d',
          previewToken: 'preview_test0000test0002',
        })
      );
      stub.batchDelete.mockResolvedValue(
        makeOk({
          deletedCount: 3,
          skippedLocked: 0,
          personalityId: 'personality-uuid-123',
          personalityName: 'Lilith',
          message: 'Deleted 3 memories.',
        })
      );

      const buttonInteraction = createMockButtonInteraction('memory-batch-delete::confirm');
      mockAwaitMessageComponent.mockResolvedValue(buttonInteraction);

      const context = createMockContext('lilith', '7d');
      await handleBatchDelete(context);

      // Preview includes timeframe …
      expect(stub.batchDeletePreview).toHaveBeenCalledWith(
        expect.objectContaining({ timeframe: '7d' })
      );
      // … execute is token-only.
      expect(stub.batchDelete).toHaveBeenCalledWith({ previewToken: 'preview_test0000test0002' });
    });

    it('should show error when delete API fails', async () => {
      stub.batchDeletePreview.mockResolvedValue(
        makeOk({
          wouldDelete: 5,
          lockedWouldSkip: 0,
          personalityId: 'personality-uuid-123',
          personalityName: 'Lilith',
          timeframe: 'all',
          previewToken: 'preview_test0000test0001',
        })
      );
      stub.batchDelete.mockResolvedValue(makeErr(500, 'Database error'));

      const buttonInteraction = createMockButtonInteraction('memory-batch-delete::confirm');
      mockAwaitMessageComponent.mockResolvedValue(buttonInteraction);

      const context = createMockContext();
      await handleBatchDelete(context);

      expect(buttonInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('❌ Failed to delete'),
        embeds: [],
        components: [],
      });
    });

    it('should defer update before making API call', async () => {
      stub.batchDeletePreview.mockResolvedValue(
        makeOk({
          wouldDelete: 2,
          lockedWouldSkip: 0,
          personalityId: 'personality-uuid-123',
          personalityName: 'Lilith',
          timeframe: 'all',
          previewToken: 'preview_test0000test0001',
        })
      );
      stub.batchDelete.mockResolvedValue(
        makeOk({
          deletedCount: 2,
          skippedLocked: 0,
          personalityId: 'personality-uuid-123',
          personalityName: 'Lilith',
          message: 'Deleted 2 memories.',
        })
      );

      const buttonInteraction = createMockButtonInteraction('memory-batch-delete::confirm');
      mockAwaitMessageComponent.mockResolvedValue(buttonInteraction);

      const context = createMockContext();
      await handleBatchDelete(context);

      // deferUpdate should be called before the delete API
      expect(buttonInteraction.deferUpdate).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle unexpected errors gracefully', async () => {
      mockResolvePersonalityId.mockRejectedValue(new Error('Unexpected error'));

      const context = createMockContext();
      await handleBatchDelete(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('unexpected error'),
      });
    });

    it('rejects the autocomplete-error sentinel before calling resolver or gateway', async () => {
      const context = createMockContext('__autocomplete_error__');
      await handleBatchDelete(context);

      expect(mockResolvePersonalityId).not.toHaveBeenCalled();
      expect(stub.batchDeletePreview).not.toHaveBeenCalled();
      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Autocomplete was unavailable'),
      });
    });
  });
});
