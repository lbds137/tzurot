/**
 * Tests for Memory Detail View
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildMemoryActionId,
  parseMemoryActionId,
  buildMemorySelectMenu,
  buildDetailEmbed,
  buildDetailButtons,
  buildDeleteConfirmButtons,
  buildEditModal,
  fetchMemory,
  updateMemory,
  toggleMemoryLock,
  deleteMemory,
  handleMemorySelect,
  handleEditButton,
  handleEditModalSubmit,
  handleLockButton,
  handleDeleteButton,
  handleDeleteConfirm,
  MEMORY_DETAIL_PREFIX,
  type MemoryItem,
  type ListContext,
} from './detail.js';
import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
} from 'discord.js';

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
  CUSTOM_ID_DELIMITER: ':',
}));

describe('Memory Detail', () => {
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

  describe('buildMemoryActionId', () => {
    it('should build ID with action only', () => {
      const id = buildMemoryActionId('select');
      expect(id).toBe(`${MEMORY_DETAIL_PREFIX}:select`);
    });

    it('should build ID with action and memoryId', () => {
      const id = buildMemoryActionId('edit', 'memory-123');
      expect(id).toBe(`${MEMORY_DETAIL_PREFIX}:edit:memory-123`);
    });

    it('should build ID with action, memoryId, and extra', () => {
      const id = buildMemoryActionId('edit', 'memory-123', 'modal');
      expect(id).toBe(`${MEMORY_DETAIL_PREFIX}:edit:memory-123:modal`);
    });
  });

  describe('parseMemoryActionId', () => {
    it('should parse valid action ID', () => {
      const result = parseMemoryActionId(`${MEMORY_DETAIL_PREFIX}:select`);
      expect(result).toEqual({ action: 'select', memoryId: undefined, extra: undefined });
    });

    it('should parse ID with memoryId', () => {
      const result = parseMemoryActionId(`${MEMORY_DETAIL_PREFIX}:edit:memory-123`);
      expect(result).toEqual({ action: 'edit', memoryId: 'memory-123', extra: undefined });
    });

    it('should parse ID with extra', () => {
      const result = parseMemoryActionId(`${MEMORY_DETAIL_PREFIX}:edit:memory-123:modal`);
      expect(result).toEqual({ action: 'edit', memoryId: 'memory-123', extra: 'modal' });
    });

    it('should return null for non-matching prefix', () => {
      const result = parseMemoryActionId('other-prefix:action');
      expect(result).toBeNull();
    });

    it('should return null for incomplete ID', () => {
      const result = parseMemoryActionId(MEMORY_DETAIL_PREFIX);
      expect(result).toBeNull();
    });
  });

  describe('buildMemorySelectMenu', () => {
    it('should build select menu with correct custom ID', () => {
      const memories = [
        createMockMemory(),
        createMockMemory({ id: 'memory-456', content: 'Second memory' }),
      ];
      const row = buildMemorySelectMenu(memories, 0, 10);

      expect(row.components).toHaveLength(1);
      const menu = row.components[0];
      expect(menu.data.custom_id).toBe(`${MEMORY_DETAIL_PREFIX}:select`);
    });

    it('should create select menu component', () => {
      const memories = [createMockMemory({ isLocked: true })];
      const row = buildMemorySelectMenu(memories, 0, 10);

      expect(row.components).toHaveLength(1);
      // Verify it's a select menu by checking it has the expected properties
      expect(row.components[0].data.custom_id).toBeDefined();
    });

    it('should handle empty memories array', () => {
      const row = buildMemorySelectMenu([], 0, 10);

      expect(row.components).toHaveLength(1);
      expect(row.components[0].data.custom_id).toBe(`${MEMORY_DETAIL_PREFIX}:select`);
    });

    it('should set placeholder text', () => {
      const memories = [createMockMemory()];
      const row = buildMemorySelectMenu(memories, 0, 10);

      expect(row.components[0].data.placeholder).toBe('Select a memory to manage...');
    });
  });

  describe('buildDetailEmbed', () => {
    it('should build embed for unlocked memory', () => {
      const memory = createMockMemory();
      const embed = buildDetailEmbed(memory);
      const json = embed.toJSON();

      expect(json.title).toBe('Memory Details');
      expect(json.description).toBe('Test memory content');
      expect(json.fields).toBeDefined();
      expect(json.fields?.find(f => f.name === 'Status')?.value).toBe('🔓 Unlocked');
    });

    it('should build embed for locked memory', () => {
      const memory = createMockMemory({ isLocked: true });
      const embed = buildDetailEmbed(memory);
      const json = embed.toJSON();

      expect(json.title).toBe('🔒 Memory Details');
      expect(json.fields?.find(f => f.name === 'Status')?.value).toBe('🔒 Locked');
    });

    it('should show updated date if different from created', () => {
      const memory = createMockMemory({
        createdAt: '2025-06-15T12:00:00.000Z',
        updatedAt: '2025-06-16T14:00:00.000Z',
      });
      const embed = buildDetailEmbed(memory);
      const json = embed.toJSON();

      expect(json.fields?.find(f => f.name === 'Updated')).toBeDefined();
    });

    it('should not show updated date if same as created', () => {
      const memory = createMockMemory();
      const embed = buildDetailEmbed(memory);
      const json = embed.toJSON();

      expect(json.fields?.find(f => f.name === 'Updated')).toBeUndefined();
    });
  });

  describe('buildDetailButtons', () => {
    it('should build action buttons for unlocked memory', () => {
      const memory = createMockMemory();
      const row = buildDetailButtons(memory);

      expect(row.components).toHaveLength(4);
      const labels = row.components.map(b => b.data.label);
      expect(labels).toContain('✏️ Edit');
      expect(labels).toContain('🔒 Lock');
      expect(labels).toContain('🗑️ Delete');
      expect(labels).toContain('↩️ Back to List');
    });

    it('should show unlock button for locked memory', () => {
      const memory = createMockMemory({ isLocked: true });
      const row = buildDetailButtons(memory);

      const labels = row.components.map(b => b.data.label);
      expect(labels).toContain('🔓 Unlock');
    });
  });

  describe('buildDeleteConfirmButtons', () => {
    it('should build confirmation buttons', () => {
      const row = buildDeleteConfirmButtons('memory-123');

      expect(row.components).toHaveLength(2);
      const labels = row.components.map(b => b.data.label);
      expect(labels).toContain('Cancel');
      expect(labels).toContain('Yes, Delete');
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

  describe('fetchMemory', () => {
    it('should fetch memory successfully', async () => {
      const memory = createMockMemory();
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { memory },
      });

      const result = await fetchMemory('user-123', 'memory-123');

      expect(result).toEqual(memory);
      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/memory/memory-123', {
        userId: 'user-123',
        method: 'GET',
      });
    });

    it('should return null on API error', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Not found',
      });

      const result = await fetchMemory('user-123', 'memory-123');

      expect(result).toBeNull();
    });
  });

  describe('updateMemory', () => {
    it('should update memory successfully', async () => {
      const memory = createMockMemory({ content: 'Updated content' });
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { memory },
      });

      const result = await updateMemory('user-123', 'memory-123', 'Updated content');

      expect(result).toEqual(memory);
      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/memory/memory-123', {
        userId: 'user-123',
        method: 'PATCH',
        body: { content: 'Updated content' },
      });
    });

    it('should return null on API error', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Update failed',
      });

      const result = await updateMemory('user-123', 'memory-123', 'New content');

      expect(result).toBeNull();
    });
  });

  describe('toggleMemoryLock', () => {
    it('should toggle lock successfully', async () => {
      const memory = createMockMemory({ isLocked: true });
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { memory },
      });

      const result = await toggleMemoryLock('user-123', 'memory-123');

      expect(result).toEqual(memory);
      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/memory/memory-123/lock', {
        userId: 'user-123',
        method: 'POST',
      });
    });

    it('should return null on API error', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Lock failed',
      });

      const result = await toggleMemoryLock('user-123', 'memory-123');

      expect(result).toBeNull();
    });
  });

  describe('deleteMemory', () => {
    it('should delete memory successfully', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { success: true },
      });

      const result = await deleteMemory('user-123', 'memory-123');

      expect(result).toBe(true);
      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/memory/memory-123', {
        userId: 'user-123',
        method: 'DELETE',
      });
    });

    it('should return false on API error', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Delete failed',
      });

      const result = await deleteMemory('user-123', 'memory-123');

      expect(result).toBe(false);
    });
  });

  describe('handleMemorySelect', () => {
    it('should show detail view on select', async () => {
      const memory = createMockMemory();
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { memory },
      });

      const mockDeferUpdate = vi.fn();
      const mockFollowUp = vi.fn();
      const mockEditReply = vi.fn();

      const interaction = {
        user: { id: 'user-123' },
        values: ['memory-123'],
        deferUpdate: mockDeferUpdate,
        followUp: mockFollowUp,
        editReply: mockEditReply,
      } as unknown as StringSelectMenuInteraction;

      const context: ListContext = { source: 'list', page: 0 };
      await handleMemorySelect(interaction, context);

      expect(mockDeferUpdate).toHaveBeenCalled();
      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: expect.any(Array),
        components: expect.any(Array),
      });
    });

    it('should show error if memory not found', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Not found',
      });

      const mockDeferUpdate = vi.fn();
      const mockFollowUp = vi.fn();

      const interaction = {
        user: { id: 'user-123' },
        values: ['memory-123'],
        deferUpdate: mockDeferUpdate,
        followUp: mockFollowUp,
      } as unknown as StringSelectMenuInteraction;

      const context: ListContext = { source: 'list', page: 0 };
      await handleMemorySelect(interaction, context);

      expect(mockFollowUp).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Failed to load'),
        })
      );
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

  describe('handleLockButton', () => {
    it('should toggle lock and update view', async () => {
      const memory = createMockMemory({ isLocked: true });
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { memory },
      });

      const mockDeferUpdate = vi.fn();
      const mockFollowUp = vi.fn();
      const mockEditReply = vi.fn();

      const interaction = {
        user: { id: 'user-123' },
        deferUpdate: mockDeferUpdate,
        followUp: mockFollowUp,
        editReply: mockEditReply,
      } as unknown as ButtonInteraction;

      await handleLockButton(interaction, 'memory-123');

      expect(mockDeferUpdate).toHaveBeenCalled();
      expect(mockEditReply).toHaveBeenCalled();
    });

    it('should show error on lock failure', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Lock failed',
      });

      const mockDeferUpdate = vi.fn();
      const mockFollowUp = vi.fn();

      const interaction = {
        user: { id: 'user-123' },
        deferUpdate: mockDeferUpdate,
        followUp: mockFollowUp,
      } as unknown as ButtonInteraction;

      await handleLockButton(interaction, 'memory-123');

      expect(mockFollowUp).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Failed to update lock'),
        })
      );
    });
  });

  describe('handleDeleteButton', () => {
    it('should show delete confirmation', async () => {
      const memory = createMockMemory();
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { memory },
      });

      const mockDeferUpdate = vi.fn();
      const mockFollowUp = vi.fn();
      const mockEditReply = vi.fn();

      const interaction = {
        user: { id: 'user-123' },
        deferUpdate: mockDeferUpdate,
        followUp: mockFollowUp,
        editReply: mockEditReply,
      } as unknown as ButtonInteraction;

      await handleDeleteButton(interaction, 'memory-123');

      expect(mockDeferUpdate).toHaveBeenCalled();
      expect(mockEditReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                title: '⚠️ Delete Memory?',
              }),
            }),
          ]),
        })
      );
    });

    it('should show error if memory not found', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Not found',
      });

      const mockDeferUpdate = vi.fn();
      const mockFollowUp = vi.fn();

      const interaction = {
        user: { id: 'user-123' },
        deferUpdate: mockDeferUpdate,
        followUp: mockFollowUp,
      } as unknown as ButtonInteraction;

      await handleDeleteButton(interaction, 'memory-123');

      expect(mockFollowUp).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Failed to load'),
        })
      );
    });
  });

  describe('handleDeleteConfirm', () => {
    it('should delete memory and return true', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { success: true },
      });

      const mockDeferUpdate = vi.fn();
      const mockFollowUp = vi.fn();

      const interaction = {
        user: { id: 'user-123' },
        deferUpdate: mockDeferUpdate,
        followUp: mockFollowUp,
      } as unknown as ButtonInteraction;

      const result = await handleDeleteConfirm(interaction, 'memory-123');

      expect(result).toBe(true);
      expect(mockDeferUpdate).toHaveBeenCalled();
    });

    it('should show error and return false on failure', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Delete failed',
      });

      const mockDeferUpdate = vi.fn();
      const mockFollowUp = vi.fn();

      const interaction = {
        user: { id: 'user-123' },
        deferUpdate: mockDeferUpdate,
        followUp: mockFollowUp,
      } as unknown as ButtonInteraction;

      const result = await handleDeleteConfirm(interaction, 'memory-123');

      expect(result).toBe(false);
      expect(mockFollowUp).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Failed to delete'),
        })
      );
    });
  });
});
