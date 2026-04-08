/**
 * Tests for detailActionRouter
 *
 * Tests the shared handleMemoryDetailAction dispatch function,
 * verifying each action type routes to the correct handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ButtonInteraction } from 'discord.js';

// Mock the detail module
const mockParseMemoryActionId = vi.fn();
const mockHandleEditButton = vi.fn();
const mockHandleEditTruncatedButton = vi.fn();
const mockHandleCancelEditButton = vi.fn();
const mockHandleLockButton = vi.fn();
const mockHandleDeleteButton = vi.fn();
const mockHandleDeleteConfirm = vi.fn();
const mockHandleViewFullButton = vi.fn();

vi.mock('./detail.js', () => ({
  parseMemoryActionId: (...args: unknown[]) => mockParseMemoryActionId(...args),
  handleLockButton: (...args: unknown[]) => mockHandleLockButton(...args),
  handleDeleteButton: (...args: unknown[]) => mockHandleDeleteButton(...args),
  handleDeleteConfirm: (...args: unknown[]) => mockHandleDeleteConfirm(...args),
  handleViewFullButton: (...args: unknown[]) => mockHandleViewFullButton(...args),
}));

vi.mock('./detailModals.js', () => ({
  handleEditButton: (...args: unknown[]) => mockHandleEditButton(...args),
  handleEditTruncatedButton: (...args: unknown[]) => mockHandleEditTruncatedButton(...args),
  handleCancelEditButton: (...args: unknown[]) => mockHandleCancelEditButton(...args),
}));

import { handleMemoryDetailAction } from './detailActionRouter.js';

function createMockButtonInteraction(customId: string): ButtonInteraction {
  return {
    customId,
    deferUpdate: vi.fn(),
  } as unknown as ButtonInteraction;
}

describe('handleMemoryDetailAction', () => {
  const mockOnRefresh = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return false when customId is not a memory action', async () => {
    mockParseMemoryActionId.mockReturnValue(null);
    const interaction = createMockButtonInteraction('unrelated::button');

    const result = await handleMemoryDetailAction(interaction, mockOnRefresh);

    expect(result).toBe(false);
  });

  it('should dispatch edit action to handleEditButton', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'edit', memoryId: 'mem-1' });
    const interaction = createMockButtonInteraction('memory-detail::edit::mem-1');

    const result = await handleMemoryDetailAction(interaction, mockOnRefresh);

    expect(result).toBe(true);
    expect(mockHandleEditButton).toHaveBeenCalledWith(interaction, 'mem-1');
  });

  it('should dispatch edit-truncated action', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'edit-truncated', memoryId: 'mem-1' });
    const interaction = createMockButtonInteraction('memory-detail::edit-truncated::mem-1');

    const result = await handleMemoryDetailAction(interaction, mockOnRefresh);

    expect(result).toBe(true);
    expect(mockHandleEditTruncatedButton).toHaveBeenCalledWith(interaction, 'mem-1');
  });

  it('should dispatch cancel-edit action', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'cancel-edit', memoryId: undefined });
    const interaction = createMockButtonInteraction('memory-detail::cancel-edit');

    const result = await handleMemoryDetailAction(interaction, mockOnRefresh);

    expect(result).toBe(true);
    expect(mockHandleCancelEditButton).toHaveBeenCalledWith(interaction);
  });

  it('should dispatch lock action', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'lock', memoryId: 'mem-1' });
    const interaction = createMockButtonInteraction('memory-detail::lock::mem-1');

    const result = await handleMemoryDetailAction(interaction, mockOnRefresh);

    expect(result).toBe(true);
    expect(mockHandleLockButton).toHaveBeenCalledWith(interaction, 'mem-1');
  });

  it('should dispatch delete action', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'delete', memoryId: 'mem-1' });
    const interaction = createMockButtonInteraction('memory-detail::delete::mem-1');

    const result = await handleMemoryDetailAction(interaction, mockOnRefresh);

    expect(result).toBe(true);
    expect(mockHandleDeleteButton).toHaveBeenCalledWith(interaction, 'mem-1');
  });

  it('should dispatch confirm-delete and refresh on success', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'confirm-delete', memoryId: 'mem-1' });
    mockHandleDeleteConfirm.mockResolvedValue(true);
    const interaction = createMockButtonInteraction('memory-detail::confirm-delete::mem-1');

    const result = await handleMemoryDetailAction(interaction, mockOnRefresh);

    expect(result).toBe(true);
    expect(mockHandleDeleteConfirm).toHaveBeenCalledWith(interaction, 'mem-1');
    expect(mockOnRefresh).toHaveBeenCalled();
  });

  it('should dispatch confirm-delete and NOT refresh on failure', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'confirm-delete', memoryId: 'mem-1' });
    mockHandleDeleteConfirm.mockResolvedValue(false);
    const interaction = createMockButtonInteraction('memory-detail::confirm-delete::mem-1');

    const result = await handleMemoryDetailAction(interaction, mockOnRefresh);

    expect(result).toBe(true);
    expect(mockOnRefresh).not.toHaveBeenCalled();
  });

  it('should dispatch view-full action', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'view-full', memoryId: 'mem-1' });
    const interaction = createMockButtonInteraction('memory-detail::view-full::mem-1');

    const result = await handleMemoryDetailAction(interaction, mockOnRefresh);

    expect(result).toBe(true);
    expect(mockHandleViewFullButton).toHaveBeenCalledWith(interaction, 'mem-1');
  });

  it('should dispatch back action with defer and refresh', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'back', memoryId: undefined });
    const interaction = createMockButtonInteraction('memory-detail::back');

    const result = await handleMemoryDetailAction(interaction, mockOnRefresh);

    expect(result).toBe(true);
    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(mockOnRefresh).toHaveBeenCalled();
  });

  it('back action skips deferUpdate when interaction is already deferred', async () => {
    // This guard lets handleButton in interactionHandlers.ts defer early on
    // the session-dependent path (ack-first rule) without double-acking
    // when the 'back' case is subsequently dispatched. Without the guard,
    // Discord rejects the second deferUpdate.
    mockParseMemoryActionId.mockReturnValue({ action: 'back', memoryId: undefined });
    const interaction = {
      customId: 'memory-detail::back',
      deferUpdate: vi.fn(),
      deferred: true,
      replied: false,
    } as unknown as ButtonInteraction;

    const result = await handleMemoryDetailAction(interaction, mockOnRefresh);

    expect(result).toBe(true);
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(mockOnRefresh).toHaveBeenCalled();
  });

  it('should return false for unknown action type', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'unknown', memoryId: undefined });
    const interaction = createMockButtonInteraction('memory-detail::unknown');

    const result = await handleMemoryDetailAction(interaction, mockOnRefresh);

    expect(result).toBe(false);
  });

  it('should return false when memoryId is undefined for id-requiring actions', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'edit', memoryId: undefined });
    const interaction = createMockButtonInteraction('memory-detail::edit');

    const result = await handleMemoryDetailAction(interaction, mockOnRefresh);

    expect(result).toBe(false);
    expect(mockHandleEditButton).not.toHaveBeenCalled();
  });

  // Load-bearing invariant: session-independent actions (edit, lock, view-full,
  // delete, etc.) must NEVER call onRefresh. interactionHandlers.handleButton
  // routes these through handleBrowseDetailAction unconditionally — even when
  // the memory was opened from a search session — because they don't need to
  // refresh the list. If any case below starts calling onRefresh, memories
  // opened from search results will silently fail to refresh (refreshBrowseList
  // bails when session.kind !== 'browse'). See SESSION_INDEPENDENT_ACTIONS in
  // interactionHandlers.ts for the paired routing decision.
  describe('session-independent actions never invoke onRefresh', () => {
    const SESSION_INDEPENDENT_CASES: Array<{
      action: string;
      memoryId: string | undefined;
    }> = [
      { action: 'edit', memoryId: 'mem-1' },
      { action: 'edit-truncated', memoryId: 'mem-1' },
      { action: 'cancel-edit', memoryId: undefined },
      { action: 'lock', memoryId: 'mem-1' },
      { action: 'view-full', memoryId: 'mem-1' },
      { action: 'delete', memoryId: 'mem-1' }, // shows confirmation dialog — no refresh
    ];

    it.each(SESSION_INDEPENDENT_CASES)(
      '$action action does not call onRefresh',
      async ({ action, memoryId }) => {
        mockParseMemoryActionId.mockReturnValue({ action, memoryId });
        const interaction = createMockButtonInteraction(`memory-detail::${action}::${memoryId}`);

        await handleMemoryDetailAction(interaction, mockOnRefresh);

        expect(mockOnRefresh).not.toHaveBeenCalled();
      }
    );
  });
});
