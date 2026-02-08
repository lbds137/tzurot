/**
 * Tests for Memory Command Interaction Handlers
 *
 * Tests button, modal, and select menu interaction routing.
 * Extracted from index.test.ts alongside interactionHandlers.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { handleButton, handleModal, handleSelectMenu } from './interactionHandlers.js';

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

// Mock detail.js handlers
const mockHandleLockButton = vi.fn();
const mockHandleDeleteButton = vi.fn();
const mockHandleDeleteConfirm = vi.fn();
const mockHandleViewFullButton = vi.fn();
vi.mock('./detail.js', () => ({
  MEMORY_DETAIL_PREFIX: 'mem-detail',
  parseMemoryActionId: (customId: string) => {
    if (!customId.startsWith('mem-detail:')) return null;
    const parts = customId.split(':');
    const memoryId = parts[2];
    return { action: parts[1], memoryId: memoryId.length > 0 ? memoryId : undefined };
  },
  handleLockButton: (...args: unknown[]) => mockHandleLockButton(...args),
  handleDeleteButton: (...args: unknown[]) => mockHandleDeleteButton(...args),
  handleDeleteConfirm: (...args: unknown[]) => mockHandleDeleteConfirm(...args),
  handleViewFullButton: (...args: unknown[]) => mockHandleViewFullButton(...args),
}));

// Mock detailModals.js - edit handlers
const mockHandleEditButton = vi.fn();
const mockHandleEditModalSubmit = vi.fn();
vi.mock('./detailModals.js', () => ({
  handleEditButton: (...args: unknown[]) => mockHandleEditButton(...args),
  handleEditTruncatedButton: vi.fn(),
  handleCancelEditButton: vi.fn(),
  handleEditModalSubmit: (...args: unknown[]) => mockHandleEditModalSubmit(...args),
}));

describe('Memory Interaction Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleButton', () => {
    function createMockButtonInteraction(
      customId: string,
      messageId = 'test-message-id'
    ): ButtonInteraction {
      const mockReply = vi.fn();
      const mockEditReply = vi.fn();
      return {
        customId,
        reply: mockReply,
        editReply: mockEditReply,
        message: { id: messageId },
      } as unknown as ButtonInteraction;
    }

    it('should handle expired pagination (non-memory-detail prefix) when no collector active', async () => {
      const interaction = createMockButtonInteraction(
        'memory-browse:page:0:date',
        'no-collector-msg'
      );

      await handleButton(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('expired'),
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should ignore interaction when active collector exists for message', async () => {
      // Import and use the registry to simulate an active collector
      const { registerActiveCollector, deregisterActiveCollector } =
        await import('../../utils/activeCollectorRegistry.js');

      const messageId = 'active-collector-msg';
      registerActiveCollector(messageId);

      try {
        const interaction = createMockButtonInteraction('memory-browse:page:0:date', messageId);
        await handleButton(interaction);

        // Should NOT call reply - collector handles it
        expect(interaction.reply).not.toHaveBeenCalled();
      } finally {
        // Clean up
        deregisterActiveCollector(messageId);
      }
    });

    it('should route edit action to handleEditButton when no collector active', async () => {
      const interaction = createMockButtonInteraction('mem-detail:edit:memory-123', 'no-collector');

      await handleButton(interaction);

      expect(mockHandleEditButton).toHaveBeenCalledWith(interaction, 'memory-123');
    });

    it('should route edit-truncated action to handleEditTruncatedButton', async () => {
      const { handleEditTruncatedButton } = await import('./detailModals.js');
      const interaction = createMockButtonInteraction(
        'mem-detail:edit-truncated:memory-trunc',
        'no-collector'
      );

      await handleButton(interaction);

      expect(handleEditTruncatedButton).toHaveBeenCalledWith(interaction, 'memory-trunc');
    });

    it('should route cancel-edit action to handleCancelEditButton', async () => {
      const { handleCancelEditButton } = await import('./detailModals.js');
      const interaction = createMockButtonInteraction(
        'mem-detail:cancel-edit:memory-cancel',
        'no-collector'
      );

      await handleButton(interaction);

      expect(handleCancelEditButton).toHaveBeenCalledWith(interaction);
    });

    it('should route lock action to handleLockButton', async () => {
      const interaction = createMockButtonInteraction('mem-detail:lock:memory-456');

      await handleButton(interaction);

      expect(mockHandleLockButton).toHaveBeenCalledWith(interaction, 'memory-456');
    });

    it('should route delete action to handleDeleteButton', async () => {
      const interaction = createMockButtonInteraction('mem-detail:delete:memory-789');

      await handleButton(interaction);

      expect(mockHandleDeleteButton).toHaveBeenCalledWith(interaction, 'memory-789');
    });

    it('should route confirm-delete action and show success on true', async () => {
      mockHandleDeleteConfirm.mockResolvedValue(true);
      const interaction = createMockButtonInteraction('mem-detail:confirm-delete:memory-abc');

      await handleButton(interaction);

      expect(mockHandleDeleteConfirm).toHaveBeenCalledWith(interaction, 'memory-abc');
      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [],
        components: [],
        content: expect.stringContaining('deleted successfully'),
      });
    });

    it('should route confirm-delete action and not show success on false', async () => {
      mockHandleDeleteConfirm.mockResolvedValue(false);
      const interaction = createMockButtonInteraction('mem-detail:confirm-delete:memory-abc');

      await handleButton(interaction);

      expect(mockHandleDeleteConfirm).toHaveBeenCalledWith(interaction, 'memory-abc');
      expect(interaction.editReply).not.toHaveBeenCalled();
    });

    it('should route view-full action to handleViewFullButton', async () => {
      const interaction = createMockButtonInteraction('mem-detail:view-full:memory-full');

      await handleButton(interaction);

      expect(mockHandleViewFullButton).toHaveBeenCalledWith(interaction, 'memory-full');
    });

    it('should show expired message for back action', async () => {
      const interaction = createMockButtonInteraction('mem-detail:back:memory-xyz');

      await handleButton(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('expired'),
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should show error for unknown action', async () => {
      const interaction = createMockButtonInteraction('mem-detail:unknown:memory-xyz');

      await handleButton(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('Unknown action'),
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should not call handler when memoryId is undefined for edit', async () => {
      // Create interaction with action but no memoryId
      const interaction = {
        customId: 'mem-detail:edit:',
        reply: vi.fn(),
        message: { id: 'no-collector-test' },
      } as unknown as ButtonInteraction;

      await handleButton(interaction);

      expect(mockHandleEditButton).not.toHaveBeenCalled();
    });
  });

  describe('handleModal', () => {
    function createMockModalSubmitInteraction(customId: string): ModalSubmitInteraction {
      return {
        customId,
      } as unknown as ModalSubmitInteraction;
    }

    it('should route edit modal to handleEditModalSubmit', async () => {
      const interaction = createMockModalSubmitInteraction('mem-detail:edit:memory-123');

      await handleModal(interaction);

      expect(mockHandleEditModalSubmit).toHaveBeenCalledWith(interaction, 'memory-123');
    });

    it('should ignore non-edit modal actions', async () => {
      const interaction = createMockModalSubmitInteraction('mem-detail:other:memory-123');

      await handleModal(interaction);

      expect(mockHandleEditModalSubmit).not.toHaveBeenCalled();
    });

    it('should ignore modals with unrecognized prefix', async () => {
      const interaction = createMockModalSubmitInteraction('unknown:edit:memory-123');

      await handleModal(interaction);

      expect(mockHandleEditModalSubmit).not.toHaveBeenCalled();
    });

    it('should not call handler when memoryId is undefined', async () => {
      const interaction = createMockModalSubmitInteraction('mem-detail:edit:');

      await handleModal(interaction);

      expect(mockHandleEditModalSubmit).not.toHaveBeenCalled();
    });
  });

  describe('handleSelectMenu', () => {
    function createMockSelectMenuInteraction(
      customId: string,
      messageId = 'test-message-id'
    ): StringSelectMenuInteraction {
      const mockReply = vi.fn();
      return {
        customId,
        reply: mockReply,
        values: ['test-memory-id'],
        message: { id: messageId },
      } as unknown as StringSelectMenuInteraction;
    }

    it('should show expired message when no active collector', async () => {
      const interaction = createMockSelectMenuInteraction('mem-detail:select', 'no-collector-msg');

      await handleSelectMenu(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('expired'),
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should ignore interaction when active collector exists for message', async () => {
      const { registerActiveCollector, deregisterActiveCollector } =
        await import('../../utils/activeCollectorRegistry.js');

      const messageId = 'active-collector-select-msg';
      registerActiveCollector(messageId);

      try {
        const interaction = createMockSelectMenuInteraction('mem-detail:select', messageId);
        await handleSelectMenu(interaction);

        // Should NOT call reply - collector handles it
        expect(interaction.reply).not.toHaveBeenCalled();
      } finally {
        deregisterActiveCollector(messageId);
      }
    });
  });
});
