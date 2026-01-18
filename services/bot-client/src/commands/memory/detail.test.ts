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
  handleMemorySelect,
  handleLockButton,
  handleDeleteButton,
  handleDeleteConfirm,
  handleViewFullButton,
  MEMORY_DETAIL_PREFIX,
  type MemoryItem,
  type ListContext,
} from './detail.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';

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
      const { embed, isTruncated } = buildDetailEmbed(memory);
      const json = embed.toJSON();

      expect(json.title).toBe('Memory Details');
      expect(json.description).toBe('Test memory content');
      expect(json.fields).toBeDefined();
      expect(json.fields?.find(f => f.name === 'Status')?.value).toBe('🔓 Unlocked');
      expect(isTruncated).toBe(false);
    });

    it('should build embed for locked memory', () => {
      const memory = createMockMemory({ isLocked: true });
      const { embed } = buildDetailEmbed(memory);
      const json = embed.toJSON();

      expect(json.title).toBe('🔒 Memory Details');
      expect(json.fields?.find(f => f.name === 'Status')?.value).toBe('🔒 Locked');
    });

    it('should show updated date if different from created', () => {
      const memory = createMockMemory({
        createdAt: '2025-06-15T12:00:00.000Z',
        updatedAt: '2025-06-16T14:00:00.000Z',
      });
      const { embed } = buildDetailEmbed(memory);
      const json = embed.toJSON();

      expect(json.fields?.find(f => f.name === 'Updated')).toBeDefined();
    });

    it('should not show updated date if same as created', () => {
      const memory = createMockMemory();
      const { embed } = buildDetailEmbed(memory);
      const json = embed.toJSON();

      expect(json.fields?.find(f => f.name === 'Updated')).toBeUndefined();
    });

    it('should truncate long content and set isTruncated flag', () => {
      const longContent = 'x'.repeat(4000);
      const memory = createMockMemory({ content: longContent });
      const { embed, isTruncated } = buildDetailEmbed(memory);
      const json = embed.toJSON();

      expect(isTruncated).toBe(true);
      expect(json.description?.length).toBeLessThan(4000);
      expect(json.description).toContain('Content truncated');
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

    it('should include View Full button when content is truncated', () => {
      const memory = createMockMemory();
      const row = buildDetailButtons(memory, true);

      expect(row.components).toHaveLength(5);
      const labels = row.components.map(b => b.data.label);
      expect(labels).toContain('📄 View Full');
    });

    it('should not include View Full button when content is not truncated', () => {
      const memory = createMockMemory();
      const row = buildDetailButtons(memory, false);

      expect(row.components).toHaveLength(4);
      const labels = row.components.map(b => b.data.label);
      expect(labels).not.toContain('📄 View Full');
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

  describe('handleViewFullButton', () => {
    it('should send full memory content as file attachment', async () => {
      const longContent = 'x'.repeat(5000);
      const memory = createMockMemory({ content: longContent });
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { memory },
      });

      const mockDeferReply = vi.fn();
      const mockEditReply = vi.fn();

      const interaction = {
        user: { id: 'user-123' },
        deferReply: mockDeferReply,
        editReply: mockEditReply,
      } as unknown as ButtonInteraction;

      await handleViewFullButton(interaction, 'memory-123');

      expect(mockDeferReply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: expect.anything() })
      );
      expect(mockEditReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Full Memory Content'),
          files: expect.arrayContaining([
            expect.objectContaining({
              name: expect.stringContaining('memory-'),
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

      const mockDeferReply = vi.fn();
      const mockEditReply = vi.fn();

      const interaction = {
        user: { id: 'user-123' },
        deferReply: mockDeferReply,
        editReply: mockEditReply,
      } as unknown as ButtonInteraction;

      await handleViewFullButton(interaction, 'memory-123');

      expect(mockEditReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Failed to load memory'),
        })
      );
    });
  });
});
