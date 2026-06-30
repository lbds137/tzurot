/**
 * Dashboard Close Handler Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
import { handleDashboardClose, createCloseHandler } from './closeHandler.js';
import { DASHBOARD_MESSAGES } from './messages.js';

// Mock session manager
const mockDelete = vi.fn();
vi.mock('./SessionManager.js', () => ({
  getSessionManager: () => ({
    delete: mockDelete,
  }),
}));

describe('handleDashboardClose', () => {
  const mockDeferUpdate = vi.fn();
  const mockEditReply = vi.fn();

  const createMockInteraction = (): ButtonInteraction =>
    ({
      user: { id: 'user-123' },
      deferUpdate: mockDeferUpdate,
      editReply: mockEditReply,
    }) as unknown as ButtonInteraction;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should ack first, delete session, then show the closed message', async () => {
    const interaction = createMockInteraction();

    await handleDashboardClose(interaction, 'persona', 'persona-123');

    // Ack-first (3-second rule): deferUpdate precedes the Redis delete.
    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith('user-123', 'persona', 'persona-123');
    expect(mockEditReply).toHaveBeenCalledWith({
      content: DASHBOARD_MESSAGES.DASHBOARD_CLOSED,
      embeds: [],
      components: [],
    });
  });

  it('should use custom message when provided', async () => {
    const interaction = createMockInteraction();
    const customMessage = '✅ Preset dashboard closed.';

    await handleDashboardClose(interaction, 'preset', 'preset-456', customMessage);

    expect(mockDelete).toHaveBeenCalledWith('user-123', 'preset', 'preset-456');
    expect(mockEditReply).toHaveBeenCalledWith({
      content: customMessage,
      embeds: [],
      components: [],
    });
  });

  it('should work with different entity types', async () => {
    const interaction = createMockInteraction();

    await handleDashboardClose(interaction, 'character', 'char-slug');

    expect(mockDelete).toHaveBeenCalledWith('user-123', 'character', 'char-slug');
  });
});

describe('createCloseHandler', () => {
  const mockDeferUpdate = vi.fn();
  const mockEditReply = vi.fn();

  const createMockInteraction = (): ButtonInteraction =>
    ({
      user: { id: 'user-456' },
      deferUpdate: mockDeferUpdate,
      editReply: mockEditReply,
    }) as unknown as ButtonInteraction;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a handler for specific entity type', async () => {
    const handleClose = createCloseHandler('preset');
    const interaction = createMockInteraction();

    await handleClose(interaction, 'preset-789');

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith('user-456', 'preset', 'preset-789');
    expect(mockEditReply).toHaveBeenCalledWith({
      content: DASHBOARD_MESSAGES.DASHBOARD_CLOSED,
      embeds: [],
      components: [],
    });
  });

  it('should work with different entity types', async () => {
    const handlePersonaClose = createCloseHandler('persona');
    const handleCharacterClose = createCloseHandler('character');
    const interaction = createMockInteraction();

    await handlePersonaClose(interaction, 'persona-1');
    expect(mockDelete).toHaveBeenLastCalledWith('user-456', 'persona', 'persona-1');

    await handleCharacterClose(interaction, 'char-slug');
    expect(mockDelete).toHaveBeenLastCalledWith('user-456', 'character', 'char-slug');
  });
});
