/**
 * Tests for searchDetailActions
 *
 * Verifies that handleSearchDetailAction delegates to the shared
 * handleMemoryDetailAction router with the correct arguments.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ButtonInteraction } from 'discord.js';

const mockHandleMemoryDetailAction = vi.fn();

vi.mock('./detailActionRouter.js', () => ({
  handleMemoryDetailAction: (...args: unknown[]) => mockHandleMemoryDetailAction(...args),
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

  it('should delegate to handleMemoryDetailAction with correct arguments', async () => {
    mockHandleMemoryDetailAction.mockResolvedValue(true);
    const interaction = createMockButtonInteraction('memory-detail::edit::mem-1');

    const result = await handleSearchDetailAction(interaction, mockRefreshSearch);

    expect(result).toBe(true);
    expect(mockHandleMemoryDetailAction).toHaveBeenCalledWith(interaction, mockRefreshSearch);
  });

  it('should return false when shared router returns false', async () => {
    mockHandleMemoryDetailAction.mockResolvedValue(false);
    const interaction = createMockButtonInteraction('unrelated::button');

    const result = await handleSearchDetailAction(interaction, mockRefreshSearch);

    expect(result).toBe(false);
    expect(mockHandleMemoryDetailAction).toHaveBeenCalledWith(interaction, mockRefreshSearch);
  });
});
