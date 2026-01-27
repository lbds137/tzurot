/**
 * Tests for Memory Detail Modal Handlers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildEditModal,
  handleEditButton,
  handleEditModalSubmit,
  MAX_MODAL_CONTENT_LENGTH,
} from './detailModals.js';
import type { MemoryItem } from './detail.js';
import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';

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
    DISCORD_COLORS: {
      BLURPLE: 0x5865f2,
      WARNING: 0xfee75c,
      ERROR: 0xed4245,
    },
  };
});

// Mock userGatewayClient
const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

// Mock customIds
vi.mock('../../utils/customIds.js', () => ({
  CUSTOM_ID_DELIMITER: '::',
}));

describe('Memory Detail Modals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createMockMemory = (overrides: Partial<MemoryItem> = {}): MemoryItem => ({
    id: 'memory-123',
    content: 'Test memory content',
    createdAt: '2025-06-15T12:00:00.000Z',
    updatedAt: '2025-06-15T12:00:00.000Z',
    personalityId: 'personality-456',
    personalityName: 'Lilith',
    isLocked: false,
    ...overrides,
  });

  describe('MAX_MODAL_CONTENT_LENGTH', () => {
    it('should be 2000 to match API validation', () => {
      expect(MAX_MODAL_CONTENT_LENGTH).toBe(2000);
    });
  });

  describe('buildEditModal', () => {
    it('should build edit modal with memory content', () => {
      const memory = createMockMemory({ content: 'Original content' });
      const modal = buildEditModal(memory);

      expect(modal.data.title).toBe('Edit Memory');
      expect(modal.data.custom_id).toContain('edit');
      expect(modal.data.custom_id).toContain(memory.id);
    });
  });

  describe('handleEditButton', () => {
    it('should show modal on edit click', async () => {
      const memory = createMockMemory();
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { memory },
      });

      const mockShowModal = vi.fn();
      const mockReply = vi.fn();

      const interaction = {
        user: { id: 'user-123' },
        showModal: mockShowModal,
        reply: mockReply,
      } as unknown as ButtonInteraction;

      await handleEditButton(interaction, 'memory-123');

      expect(mockShowModal).toHaveBeenCalled();
    });

    it('should show error if memory not found', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Not found',
      });

      const mockShowModal = vi.fn();
      const mockReply = vi.fn();

      const interaction = {
        user: { id: 'user-123' },
        showModal: mockShowModal,
        reply: mockReply,
      } as unknown as ButtonInteraction;

      await handleEditButton(interaction, 'memory-123');

      expect(mockShowModal).not.toHaveBeenCalled();
      expect(mockReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Failed to load'),
        })
      );
    });
  });

  describe('handleEditModalSubmit', () => {
    it('should update memory and show detail view', async () => {
      const memory = createMockMemory({ content: 'Updated content' });
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { memory },
      });

      const mockDeferUpdate = vi.fn();
      const mockFollowUp = vi.fn();
      const mockEditReply = vi.fn();
      const mockGetTextInputValue = vi.fn().mockReturnValue('Updated content');

      const interaction = {
        user: { id: 'user-123' },
        fields: { getTextInputValue: mockGetTextInputValue },
        deferUpdate: mockDeferUpdate,
        followUp: mockFollowUp,
        editReply: mockEditReply,
      } as unknown as ModalSubmitInteraction;

      await handleEditModalSubmit(interaction, 'memory-123');

      expect(mockDeferUpdate).toHaveBeenCalled();
      expect(mockEditReply).toHaveBeenCalled();
    });

    it('should show error on update failure', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Update failed',
      });

      const mockDeferUpdate = vi.fn();
      const mockFollowUp = vi.fn();
      const mockGetTextInputValue = vi.fn().mockReturnValue('Updated content');

      const interaction = {
        user: { id: 'user-123' },
        fields: { getTextInputValue: mockGetTextInputValue },
        deferUpdate: mockDeferUpdate,
        followUp: mockFollowUp,
      } as unknown as ModalSubmitInteraction;

      await handleEditModalSubmit(interaction, 'memory-123');

      expect(mockFollowUp).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Failed to update'),
        })
      );
    });
  });
});
