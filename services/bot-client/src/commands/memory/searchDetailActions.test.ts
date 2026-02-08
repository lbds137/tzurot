/**
 * Tests for searchDetailActions
 *
 * Tests the handleSearchDetailAction dispatch function directly,
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
  handleEditButton: (...args: unknown[]) => mockHandleEditButton(...args),
  handleEditTruncatedButton: (...args: unknown[]) => mockHandleEditTruncatedButton(...args),
  handleCancelEditButton: (...args: unknown[]) => mockHandleCancelEditButton(...args),
  handleLockButton: (...args: unknown[]) => mockHandleLockButton(...args),
  handleDeleteButton: (...args: unknown[]) => mockHandleDeleteButton(...args),
  handleDeleteConfirm: (...args: unknown[]) => mockHandleDeleteConfirm(...args),
  handleViewFullButton: (...args: unknown[]) => mockHandleViewFullButton(...args),
}));

import { handleSearchDetailAction } from './searchDetailActions.js';

function createMockButtonInteraction(customId: string): ButtonInteraction {
  return {
    customId,
    deferUpdate: vi.fn(),
  } as unknown as ButtonInteraction;
}

describe('handleSearchDetailAction', () => {
  const mockRefreshSearch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return false when customId is not a memory action', async () => {
    mockParseMemoryActionId.mockReturnValue(null);
    const interaction = createMockButtonInteraction('unrelated::button');

    const result = await handleSearchDetailAction(interaction, mockRefreshSearch);

    expect(result).toBe(false);
  });

  it('should dispatch edit action to handleEditButton', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'edit', memoryId: 'mem-1' });
    const interaction = createMockButtonInteraction('memory-detail::edit::mem-1');

    const result = await handleSearchDetailAction(interaction, mockRefreshSearch);

    expect(result).toBe(true);
    expect(mockHandleEditButton).toHaveBeenCalledWith(interaction, 'mem-1');
  });

  it('should dispatch edit-truncated action', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'edit-truncated', memoryId: 'mem-1' });
    const interaction = createMockButtonInteraction('memory-detail::edit-truncated::mem-1');

    const result = await handleSearchDetailAction(interaction, mockRefreshSearch);

    expect(result).toBe(true);
    expect(mockHandleEditTruncatedButton).toHaveBeenCalledWith(interaction, 'mem-1');
  });

  it('should dispatch cancel-edit action', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'cancel-edit', memoryId: undefined });
    const interaction = createMockButtonInteraction('memory-detail::cancel-edit');

    const result = await handleSearchDetailAction(interaction, mockRefreshSearch);

    expect(result).toBe(true);
    expect(mockHandleCancelEditButton).toHaveBeenCalledWith(interaction);
  });

  it('should dispatch lock action', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'lock', memoryId: 'mem-1' });
    const interaction = createMockButtonInteraction('memory-detail::lock::mem-1');

    const result = await handleSearchDetailAction(interaction, mockRefreshSearch);

    expect(result).toBe(true);
    expect(mockHandleLockButton).toHaveBeenCalledWith(interaction, 'mem-1');
  });

  it('should dispatch delete action', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'delete', memoryId: 'mem-1' });
    const interaction = createMockButtonInteraction('memory-detail::delete::mem-1');

    const result = await handleSearchDetailAction(interaction, mockRefreshSearch);

    expect(result).toBe(true);
    expect(mockHandleDeleteButton).toHaveBeenCalledWith(interaction, 'mem-1');
  });

  it('should dispatch confirm-delete and refresh on success', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'confirm-delete', memoryId: 'mem-1' });
    mockHandleDeleteConfirm.mockResolvedValue(true);
    const interaction = createMockButtonInteraction('memory-detail::confirm-delete::mem-1');

    const result = await handleSearchDetailAction(interaction, mockRefreshSearch);

    expect(result).toBe(true);
    expect(mockHandleDeleteConfirm).toHaveBeenCalledWith(interaction, 'mem-1');
    expect(mockRefreshSearch).toHaveBeenCalled();
  });

  it('should dispatch confirm-delete and NOT refresh on failure', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'confirm-delete', memoryId: 'mem-1' });
    mockHandleDeleteConfirm.mockResolvedValue(false);
    const interaction = createMockButtonInteraction('memory-detail::confirm-delete::mem-1');

    const result = await handleSearchDetailAction(interaction, mockRefreshSearch);

    expect(result).toBe(true);
    expect(mockRefreshSearch).not.toHaveBeenCalled();
  });

  it('should dispatch view-full action', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'view-full', memoryId: 'mem-1' });
    const interaction = createMockButtonInteraction('memory-detail::view-full::mem-1');

    const result = await handleSearchDetailAction(interaction, mockRefreshSearch);

    expect(result).toBe(true);
    expect(mockHandleViewFullButton).toHaveBeenCalledWith(interaction, 'mem-1');
  });

  it('should dispatch back action with defer and refresh', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'back', memoryId: undefined });
    const interaction = createMockButtonInteraction('memory-detail::back');

    const result = await handleSearchDetailAction(interaction, mockRefreshSearch);

    expect(result).toBe(true);
    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(mockRefreshSearch).toHaveBeenCalled();
  });

  it('should return false for unknown action type', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'unknown', memoryId: undefined });
    const interaction = createMockButtonInteraction('memory-detail::unknown');

    const result = await handleSearchDetailAction(interaction, mockRefreshSearch);

    expect(result).toBe(false);
  });

  it('should skip handler when memoryId is undefined for id-requiring actions', async () => {
    mockParseMemoryActionId.mockReturnValue({ action: 'edit', memoryId: undefined });
    const interaction = createMockButtonInteraction('memory-detail::edit');

    const result = await handleSearchDetailAction(interaction, mockRefreshSearch);

    expect(result).toBe(true);
    expect(mockHandleEditButton).not.toHaveBeenCalled();
  });
});
