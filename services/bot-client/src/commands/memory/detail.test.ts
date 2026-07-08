/**
 * Tests for Memory Detail View
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildMemoryActionId,
  parseMemoryActionId,
  buildDetailEmbed,
  buildDetailButtons,
  buildDeleteConfirmButtons,
  handleMemorySelect,
  handleLockButton,
  handleDeleteButton,
  handleDeleteConfirm,
  handleViewFullButton,
  MEMORY_DETAIL_PREFIX,
} from './detail.js';
import type { MemoryItem } from '@tzurot/common-types/schemas/api/memory';
import { CUSTOM_ID_DELIMITER } from '../../utils/customIds.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';

vi.mock('@tzurot/common-types/constants/discord', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/constants/discord')>(
    '@tzurot/common-types/constants/discord'
  );
  return {
    ...actual,
    DISCORD_COLORS: {
      BLURPLE: 0x5865f2,
      WARNING: 0xfee75c,
      ERROR: 0xed4245,
    },
  };
});

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

vi.mock('../../utils/customIds.js', () => ({
  CUSTOM_ID_DELIMITER: '::',
}));

interface MemoryClientStub {
  getMemory: ReturnType<typeof vi.fn>;
  setMemoryLock: ReturnType<typeof vi.fn>;
  deleteMemory: ReturnType<typeof vi.fn>;
}

function createStub(): MemoryClientStub {
  return {
    getMemory: vi.fn(),
    setMemoryLock: vi.fn(),
    deleteMemory: vi.fn(),
  };
}

describe('Memory Detail', () => {
  let stub: MemoryClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
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
      expect(id).toBe(`${MEMORY_DETAIL_PREFIX}${CUSTOM_ID_DELIMITER}select`);
    });

    it('should build ID with action and memoryId', () => {
      const id = buildMemoryActionId('edit', 'memory-123');
      expect(id).toBe(
        `${MEMORY_DETAIL_PREFIX}${CUSTOM_ID_DELIMITER}edit${CUSTOM_ID_DELIMITER}memory-123`
      );
    });

    it('should build ID with action, memoryId, and extra', () => {
      const id = buildMemoryActionId('edit', 'memory-123', 'modal');
      expect(id).toBe(
        `${MEMORY_DETAIL_PREFIX}${CUSTOM_ID_DELIMITER}edit${CUSTOM_ID_DELIMITER}memory-123${CUSTOM_ID_DELIMITER}modal`
      );
    });
  });

  describe('parseMemoryActionId', () => {
    it('should parse valid action ID', () => {
      const result = parseMemoryActionId(`${MEMORY_DETAIL_PREFIX}${CUSTOM_ID_DELIMITER}select`);
      expect(result).toEqual({ action: 'select', memoryId: undefined, extra: undefined });
    });

    it('should parse ID with memoryId', () => {
      const result = parseMemoryActionId(
        `${MEMORY_DETAIL_PREFIX}${CUSTOM_ID_DELIMITER}edit${CUSTOM_ID_DELIMITER}memory-123`
      );
      expect(result).toEqual({ action: 'edit', memoryId: 'memory-123', extra: undefined });
    });

    it('should parse ID with extra', () => {
      const result = parseMemoryActionId(
        `${MEMORY_DETAIL_PREFIX}${CUSTOM_ID_DELIMITER}edit${CUSTOM_ID_DELIMITER}memory-123${CUSTOM_ID_DELIMITER}modal`
      );
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

  // Note: buildMemorySelectMenu was deleted in favor of the shared
  // buildBrowseSelectMenu factory in utils/browse/selectMenuBuilder.ts.
  // Coverage of the select menu construction now lives in:
  //   - selectMenuBuilder.test.ts (factory unit tests)
  //   - browse.test.ts / search.test.ts (per-call-site behavior)

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
      const labels = row.components.map(b => (b.data as { label?: string }).label);
      // Emojis are set via .setEmoji(), not embedded in labels
      expect(labels).toContain('Edit');
      expect(labels).toContain('Lock');
      expect(labels).toContain('Back to List');
      expect(labels).toContain('Delete');
      // Delete should be last (standard dashboard order)
      expect(labels[labels.length - 1]).toBe('Delete');
    });

    it('should show unlock button for locked memory', () => {
      const memory = createMockMemory({ isLocked: true });
      const row = buildDetailButtons(memory);

      const labels = row.components.map(b => (b.data as { label?: string }).label);
      expect(labels).toContain('Unlock'); // Emoji set via .setEmoji()
    });

    it('should include View Full button when content is truncated', () => {
      const memory = createMockMemory();
      const row = buildDetailButtons(memory, true);

      expect(row.components).toHaveLength(5);
      const labels = row.components.map(b => (b.data as { label?: string }).label);
      expect(labels).toContain('View Full'); // Emoji set via .setEmoji()
    });

    it('should not include View Full button when content is not truncated', () => {
      const memory = createMockMemory();
      const row = buildDetailButtons(memory, false);

      expect(row.components).toHaveLength(4);
      const labels = row.components.map(b => (b.data as { label?: string }).label);
      expect(labels).not.toContain('View Full');
    });
  });

  describe('buildDeleteConfirmButtons', () => {
    it('should build confirmation buttons', () => {
      const row = buildDeleteConfirmButtons('memory-123');

      expect(row.components).toHaveLength(2);
      const labels = row.components.map(b => (b.data as { label?: string }).label);
      expect(labels).toContain('Cancel');
      expect(labels).toContain('Yes, Delete');
    });
  });

  describe('handleMemorySelect', () => {
    it('should show detail view on select', async () => {
      const memory = createMockMemory();
      stub.getMemory.mockResolvedValue(makeOk({ memory }));

      const mockDeferUpdate = vi.fn();
      const mockFollowUp = vi.fn();
      const mockEditReply = vi.fn();

      const interaction = {
        user: { id: 'user-123', username: 'testuser' },
        values: ['memory-123'],
        deferUpdate: mockDeferUpdate,
        followUp: mockFollowUp,
        editReply: mockEditReply,
      } as unknown as StringSelectMenuInteraction;

      await handleMemorySelect(interaction);

      expect(mockDeferUpdate).toHaveBeenCalled();
      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: expect.any(Array),
        components: expect.any(Array),
      });
    });

    it('should show error if memory not found', async () => {
      stub.getMemory.mockResolvedValue(makeErr(404, 'Not found'));

      const mockDeferUpdate = vi.fn();
      const mockFollowUp = vi.fn();

      const interaction = {
        user: { id: 'user-123', username: 'testuser' },
        values: ['memory-123'],
        deferUpdate: mockDeferUpdate,
        followUp: mockFollowUp,
      } as unknown as StringSelectMenuInteraction;

      await handleMemorySelect(interaction);

      expect(mockFollowUp).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Memory not found'),
        })
      );
    });
  });

  describe('handleLockButton', () => {
    it('should toggle lock and update view', async () => {
      const memory = createMockMemory({ isLocked: true });
      stub.setMemoryLock.mockResolvedValue(makeOk({ memory }));

      const mockDeferUpdate = vi.fn();
      const mockFollowUp = vi.fn();
      const mockEditReply = vi.fn();

      const interaction = {
        user: { id: 'user-123', username: 'testuser' },
        deferUpdate: mockDeferUpdate,
        followUp: mockFollowUp,
        editReply: mockEditReply,
      } as unknown as ButtonInteraction;

      await handleLockButton(interaction, 'memory-123', true);

      expect(mockDeferUpdate).toHaveBeenCalled();
      expect(mockEditReply).toHaveBeenCalled();
    });

    it('surfaces the gateway message when the lock write is rejected (5xx)', async () => {
      stub.setMemoryLock.mockResolvedValue(makeErr(500, 'Lock failed'));

      const mockDeferUpdate = vi.fn();
      const mockFollowUp = vi.fn();

      const interaction = {
        user: { id: 'user-123', username: 'testuser' },
        deferUpdate: mockDeferUpdate,
        followUp: mockFollowUp,
      } as unknown as ButtonInteraction;

      await handleLockButton(interaction, 'memory-123', true);

      expect(mockFollowUp).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Lock failed'),
        })
      );
    });

    it('forwards desiredState=false to setMemoryLock for unlock flow', async () => {
      const memory = createMockMemory({ isLocked: false });
      stub.setMemoryLock.mockResolvedValue(makeOk({ memory }));

      const interaction = {
        user: { id: 'user-123', username: 'testuser' },
        deferUpdate: vi.fn(),
        followUp: vi.fn(),
        editReply: vi.fn(),
      } as unknown as ButtonInteraction;

      await handleLockButton(interaction, 'memory-123', false);

      expect(stub.setMemoryLock).toHaveBeenCalledWith('memory-123', { locked: false });
    });
  });

  describe('handleDeleteButton', () => {
    it('should show delete confirmation', async () => {
      const memory = createMockMemory();
      stub.getMemory.mockResolvedValue(makeOk({ memory }));

      const mockDeferUpdate = vi.fn();
      const mockFollowUp = vi.fn();
      const mockEditReply = vi.fn();

      const interaction = {
        user: { id: 'user-123', username: 'testuser' },
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
      stub.getMemory.mockResolvedValue(makeErr(404, 'Not found'));

      const mockDeferUpdate = vi.fn();
      const mockFollowUp = vi.fn();

      const interaction = {
        user: { id: 'user-123', username: 'testuser' },
        deferUpdate: mockDeferUpdate,
        followUp: mockFollowUp,
      } as unknown as ButtonInteraction;

      await handleDeleteButton(interaction, 'memory-123');

      expect(mockFollowUp).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Memory not found'),
        })
      );
    });
  });

  describe('handleDeleteConfirm', () => {
    it('should delete memory and return true', async () => {
      stub.deleteMemory.mockResolvedValue(makeOk({ success: true }));

      const mockDeferUpdate = vi.fn();
      const mockFollowUp = vi.fn();

      const interaction = {
        user: { id: 'user-123', username: 'testuser' },
        deferUpdate: mockDeferUpdate,
        followUp: mockFollowUp,
      } as unknown as ButtonInteraction;

      const result = await handleDeleteConfirm(interaction, 'memory-123');

      expect(result).toBe(true);
      expect(mockDeferUpdate).toHaveBeenCalled();
    });

    it('classifies a 5xx delete failure and returns false', async () => {
      stub.deleteMemory.mockResolvedValue(makeErr(500, 'Delete failed'));

      const mockDeferUpdate = vi.fn();
      const mockFollowUp = vi.fn();

      const interaction = {
        user: { id: 'user-123', username: 'testuser' },
        deferUpdate: mockDeferUpdate,
        followUp: mockFollowUp,
      } as unknown as ButtonInteraction;

      const result = await handleDeleteConfirm(interaction, 'memory-123');

      expect(result).toBe(false);
      expect(mockFollowUp).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Delete failed'),
        })
      );
    });

    it('skips deferUpdate when the interaction is already deferred', async () => {
      // This guard lets handleButton ack early on the session-dependent
      // path (ack-first rule) without handleDeleteConfirm double-acking.
      // Without the guard, Discord rejects the second deferUpdate and the
      // user sees "This interaction failed."
      stub.deleteMemory.mockResolvedValue(makeOk({ success: true }));

      const mockDeferUpdate = vi.fn();
      const mockFollowUp = vi.fn();

      const interaction = {
        user: { id: 'user-123', username: 'testuser' },
        deferUpdate: mockDeferUpdate,
        followUp: mockFollowUp,
        deferred: true, // ← pre-deferred by caller
        replied: false,
      } as unknown as ButtonInteraction;

      const result = await handleDeleteConfirm(interaction, 'memory-123');

      expect(result).toBe(true);
      expect(mockDeferUpdate).not.toHaveBeenCalled();
    });
  });

  describe('handleViewFullButton', () => {
    it('should send full memory content as file attachment', async () => {
      const longContent = 'x'.repeat(5000);
      const memory = createMockMemory({ content: longContent });
      stub.getMemory.mockResolvedValue(makeOk({ memory }));

      const mockDeferReply = vi.fn();
      const mockEditReply = vi.fn();

      const interaction = {
        user: { id: 'user-123', username: 'testuser' },
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
      stub.getMemory.mockResolvedValue(makeErr(404, 'Not found'));

      const mockDeferReply = vi.fn();
      const mockEditReply = vi.fn();

      const interaction = {
        user: { id: 'user-123', username: 'testuser' },
        deferReply: mockDeferReply,
        editReply: mockEditReply,
        deferred: true,
        replied: false,
      } as unknown as ButtonInteraction;

      await handleViewFullButton(interaction, 'memory-123');

      expect(mockEditReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Memory not found'),
        })
      );
    });
  });
});
